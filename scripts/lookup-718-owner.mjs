/**
 * Resolves the nftmail.gno names owned by 0x718Bbf2feE40BAB9d5C6622bEe209d0C071ac13f
 * by fetching SubnameMinted events from the old nftmail registrar on Gnosis.
 * Uses Gnosisscan API to get the transaction input data and decode the label.
 */
import { createPublicClient, http, parseAbiItem } from 'viem';
import { gnosis } from 'viem/chains';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url).pathname, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const client = createPublicClient({ chain: gnosis, transport: http() });
const OLD_NFTMAIL = '0x831ddd71e7c33e16b674099129e6e379da407faf';
const TARGET = '0x718Bbf2feE40BAB9d5C6622bEe209d0C071ac13f'.toLowerCase();

// Fetch SubnameMinted events where owner == TARGET
const logs = await client.getLogs({
  address: OLD_NFTMAIL,
  event: parseAbiItem('event SubnameMinted(bytes32 indexed parentNode, bytes32 indexed labelhash, bytes32 indexed subnode, uint256 tokenId, address owner)'),
  fromBlock: 0n,
  toBlock: 'latest',
});

console.log(`Total SubnameMinted events: ${logs.length}`);

const targetLogs = logs.filter(l => l.args.owner?.toLowerCase() === TARGET);
console.log(`Events for ${TARGET}: ${targetLogs.length}`);

for (const log of targetLogs) {
  console.log(`\n  tokenId: ${log.args.tokenId}`);
  console.log(`  labelhash: ${log.args.labelhash}`);
  console.log(`  txHash: ${log.transactionHash}`);
  console.log(`  blockNumber: ${log.blockNumber}`);
}

// Now fetch the actual tx calldata to decode the label string
const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

for (const log of targetLogs) {
  const tx = await client.getTransaction({ hash: log.transactionHash });
  // mintSubname(string label, address owner, bytes storyData, bytes32 tbaSalt)
  // selector = 0xa253cc39
  // label is first ABI-encoded string param — skip 4 byte selector + 4x32 byte offsets
  const input = tx.input;
  try {
    // After 4-byte selector: offset(32) + address(32) + offset(32) + bytes32(32) = 128 bytes of params
    // Then string length at offset, then string data
    const hex = input.slice(2 + 8); // skip 0x + 4-byte selector
    const labelOffset = parseInt(hex.slice(0, 64), 16) * 2; // in hex chars
    const labelLen = parseInt(hex.slice(labelOffset, labelOffset + 64), 16);
    const labelHex = hex.slice(labelOffset + 64, labelOffset + 64 + labelLen * 2);
    const label = Buffer.from(labelHex, 'hex').toString('utf8');
    console.log(`  >>> label: "${label}" → ${label}.nftmail.gno`);

    // Also try to find the email in KV
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kvGet', key: `nftmailgno:${label}` }),
    });
    const kv = await kvRes.json();
    if (kv.value) {
      const data = JSON.parse(kv.value);
      console.log(`  KV controller: ${data.controller}`);
    } else {
      console.log(`  KV: not found for key nftmailgno:${label}`);
    }
  } catch (e) {
    console.log(`  Could not decode label: ${e.message}`);
  }
}
