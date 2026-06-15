#!/usr/bin/env node
/**
 * Local backfill script — run with your .env.local loaded:
 *   node --env-file=.env.local scripts/backfill-erc8004.mjs
 *   node --env-file=.env.local scripts/backfill-erc8004.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-erc8004.mjs --agents super-normie,rare-normie
 */

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const TREASURY_ADDRESS = '0xf251ca37a80200f7afeff398da0338f4c1f01249';
const RPC_URL = process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com';

const dryRun = process.argv.includes('--dry-run');
const debugMode = process.argv.includes('--debug');
const agentsArg = process.argv.find(a => a.startsWith('--agents='));
const specificAgents = agentsArg ? agentsArg.replace('--agents=', '').split(',') : null;

console.log('WORKER_SECRET length:', WORKER_SECRET.length);
console.log('Dry run:', dryRun);
console.log('Target agents:', specificAgents ?? 'all (scan 3199-3700)');
console.log('');

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

function encodeTokenURI(agentId) {
  // tokenURI(uint256) = 0xc87b56dd
  const hex = BigInt(agentId).toString(16).padStart(64, '0');
  return '0xc87b56dd' + hex;
}

function encodeOwnerOf(agentId) {
  // ownerOf(uint256) = 0x6352211e
  const hex = BigInt(agentId).toString(16).padStart(64, '0');
  return '0x6352211e' + hex;
}

function decodeString(hex) {
  if (!hex || hex === '0x') return '';
  // ABI-decode dynamic string: offset (32 bytes) + length (32 bytes) + data
  const raw = hex.slice(2);
  const offset = parseInt(raw.slice(0, 64), 16) * 2;
  const len = parseInt(raw.slice(offset, offset + 64), 16);
  const strHex = raw.slice(offset + 64, offset + 64 + len * 2);
  return Buffer.from(strHex, 'hex').toString('utf8');
}

function decodeAddress(hex) {
  if (!hex || hex === '0x') return null;
  const raw = hex.slice(2);
  // First return value is address (padded to 32 bytes)
  return '0x' + raw.slice(24, 64);
}

async function scanChain() {
  const found = [];
  const start = 3199;
  const end = 3700;
  const BATCH = 20; // parallel RPC calls at a time

  console.log(`Scanning agentIds ${start}-${end} in batches of ${BATCH}...`);

  for (let batch = start; batch <= end; batch += BATCH) {
    const ids = Array.from({ length: Math.min(BATCH, end - batch + 1) }, (_, i) => batch + i);
    const results = await Promise.allSettled(
      ids.map(id => rpcCall('eth_call', [{ to: IDENTITY_REGISTRY, data: encodeTokenURI(id) }, 'latest'])
        .then(uriHex => ({ id, uriHex })))
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { id, uriHex } = result.value;
      const uri = decodeString(uriHex);
      if (!uri || (!uri.includes('ghostagent.ninja') && !uri.includes('agent='))) continue;

      const match = uri.match(/agent=([^&\s]+)/);
      if (!match) continue;

      found.push({ name: match[1], agentId: id, owner: '', uri });
      console.log(`  Found: ${match[1]} — agentId #${id}`);
    }

    process.stdout.write(`  Scanned up to ${Math.min(batch + BATCH - 1, end)}/${end}\r`);
  }
  console.log('');
  return found;
}

async function getKvId(name) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'getAgentIdentity', name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // erc8004AgentId can be top-level or nested under erc8004.gnosis.agentId
    return data.erc8004AgentId ?? data.erc8004?.gnosis?.agentId ?? null;
  } catch { return null; }
}

async function setKvId(name, agentId, owner, uri) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
    body: JSON.stringify({ action: 'setErc8004AgentId', agentName: name, erc8004AgentId: agentId, agentURI: uri, chainId: 100, safeOwner: owner }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`         ERROR ${res.status}: ${text}`);
  }
  return res.ok;
}

async function debugTest() {
  console.log('=== DEBUG: testing agentId 3199 (ghostagent, known to exist) ===');
  const testId = 3199;
  const uriCalldata = encodeTokenURI(testId);
  const ownerCalldata = encodeOwnerOf(testId);
  console.log('tokenURI calldata:', uriCalldata);
  console.log('ownerOf calldata:', ownerCalldata);

  const uriHex = await rpcCall('eth_call', [{ to: IDENTITY_REGISTRY, data: uriCalldata }, 'latest']);
  console.log('tokenURI raw hex:', uriHex?.slice(0, 130), '...');
  console.log('tokenURI decoded:', decodeString(uriHex));

  const agentHex = await rpcCall('eth_call', [{ to: IDENTITY_REGISTRY, data: ownerCalldata }, 'latest']);
  console.log('ownerOf raw hex:', agentHex?.slice(0, 130), '...');
  console.log('owner decoded:', decodeAddress(agentHex));
  console.log('TREASURY_ADDRESS:', TREASURY_ADDRESS);
  console.log('Match:', decodeAddress(agentHex)?.toLowerCase() === TREASURY_ADDRESS);
}

async function main() {
  if (!WORKER_SECRET) {
    console.error('ERROR: WORKER_SECRET or WEBHOOK_SECRET env var required');
    process.exit(1);
  }

  if (debugMode) {
    await debugTest();
    return;
  }

  let agents = await scanChain();
  if (specificAgents) agents = agents.filter(a => specificAgents.includes(a.name));

  // Deduplicate: keep only the LOWEST agentId per name (first/canonical registration)
  const deduped = new Map();
  for (const agent of agents) {
    const existing = deduped.get(agent.name);
    if (!existing || agent.agentId < existing.agentId) deduped.set(agent.name, agent);
  }
  agents = [...deduped.values()];
  console.log(`After dedup: ${agents.length} unique agents\n`);

  if (agents.length === 0) {
    console.log('No matching agents found on chain.');
    return;
  }

  console.log(`Found ${agents.length} agents owned by treasury wallet:\n`);

  for (const agent of agents) {
    console.log(`  ${dryRun ? 'DRY    ' : 'WRITE  '} ${agent.name} — agentId #${agent.agentId}`);

    if (!dryRun) {
      const ok = await setKvId(agent.name, agent.agentId, agent.owner, agent.uri);
      console.log(`         → ${ok ? '✓ stored' : '✗ FAILED'}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
