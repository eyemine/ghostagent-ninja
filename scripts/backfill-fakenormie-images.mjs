/**
 * Backfills byo-origin-image: KV keys for FakeNormies agents.
 * These agents were registered via fakenormies/claim — that route stores tokenId
 * and contractAddress but never writes byo-origin-image:, so the agent card shows
 * the "FAKENORMIE" placeholder. This script fetches the real NFT image on-chain
 * and writes it to KV so the dashboard shows the correct image.
 */

const WORKER_URL    = 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const GNO_RPC       = 'https://rpc.gnosischain.com';

// FakeNormies contract on Gnosis chain
const FAKENORMIES_CONTRACT = '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29';

// agentName → tokenId
const AGENTS = {
  'chonk-601':  601,
  'chonk-697':  697,
  'chonk-9534': 9534,
};

// tokenURI(uint256) selector
const TOKEN_URI_SELECTOR = '0xc87b56dd';

function encodeTokenUri(tokenId) {
  return TOKEN_URI_SELECTOR + BigInt(tokenId).toString(16).padStart(64, '0');
}

function decodeString(hex) {
  // Strip 0x and leading zeros / ABI encoding offset + length
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
  // ABI-encoded string: 32 bytes offset, 32 bytes length, then data
  if (raw.length < 128) return null;
  const lengthHex = raw.slice(64, 128);
  const length = parseInt(lengthHex, 16);
  const dataHex = raw.slice(128, 128 + length * 2);
  return Buffer.from(dataHex, 'hex').toString('utf8');
}

async function callTokenURI(tokenId) {
  const res = await fetch(GNO_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: FAKENORMIES_CONTRACT, data: encodeTokenUri(tokenId) }, 'latest'],
    }),
  });
  const { result } = await res.json();
  return result ? decodeString(result) : null;
}

async function extractImage(tokenURI) {
  if (!tokenURI) return null;

  // data:application/json;base64,... (on-chain stored metadata)
  if (tokenURI.startsWith('data:application/json;base64,')) {
    const json = JSON.parse(Buffer.from(tokenURI.slice(29), 'base64').toString('utf8'));
    return json.image ?? null;
  }

  // data:application/json,...  (URL-encoded)
  if (tokenURI.startsWith('data:application/json,')) {
    const json = JSON.parse(decodeURIComponent(tokenURI.slice(22)));
    return json.image ?? null;
  }

  // IPFS or HTTPS URI pointing to JSON metadata
  const fetchUri = tokenURI.startsWith('ipfs://')
    ? tokenURI.replace('ipfs://', 'https://gateway.lighthouse.storage/ipfs/')
    : tokenURI;
  const metaRes = await fetch(fetchUri, { signal: AbortSignal.timeout(10000) });
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  return meta.image ?? meta.image_url ?? null;
}

async function storeImage(agentName, imageUrl) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body: JSON.stringify({
      action: 'kvPut',
      key: `byo-origin-image:${agentName}`,
      value: JSON.stringify({ imageUrl, nftType: 'fakenormie', storedAt: Date.now() }),
    }),
  });
  return res.ok;
}

console.log('=== Backfilling FakeNormie images ===\n');

for (const [agentName, tokenId] of Object.entries(AGENTS)) {
  console.log(`  ${agentName} (token #${tokenId})`);

  const tokenURI = await callTokenURI(tokenId);
  console.log(`    tokenURI: ${tokenURI ? tokenURI.slice(0, 80) + '...' : 'null'}`);

  const imageUrl = await extractImage(tokenURI);
  console.log(`    image:    ${imageUrl ? imageUrl.slice(0, 80) : 'null'}`);

  if (!imageUrl) {
    console.log(`    → SKIP (no image found)\n`);
    continue;
  }

  const ok = await storeImage(agentName, imageUrl);
  console.log(`    → byo-origin-image: ${ok ? '✓ stored' : '✗ FAILED'}\n`);
}

console.log('Done.');
