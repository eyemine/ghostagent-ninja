#!/usr/bin/env node
/**
 * Write safe/tld/erc8004 to KV for core ecosystem agents (ghostagent, eyemine, victor)
 * so agent-card enrichment can return safe + tier correctly.
 *
 * Usage: node scripts/fix-ecosystem-agents-kv.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.local'));

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

if (!WORKER_SECRET) { console.error('WORKER_SECRET missing'); process.exit(1); }

const H = {
  'Content-Type': 'application/json',
  'X-Worker-Secret': WORKER_SECRET,
  'X-Webhook-Secret': WEBHOOK_SECRET,
};

async function call(body) {
  const r = await fetch(WORKER_URL, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

const AGENTS = [
  {
    name: 'ghostagent',
    tld: 'molt.gno',
    safe: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    agentId: 3199,
    chain: 'gnosis',
  },
  {
    name: 'eyemine',
    tld: 'nftmail.gno',
    safe: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    agentId: 3205,
    chain: 'gnosis',
  },
  {
    name: 'victor',
    tld: 'openclaw.gno',
    safe: '0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70',
    agentId: 3206,
    chain: 'gnosis',
  },
];

for (const agent of AGENTS) {
  console.log(`\n── ${agent.name} ──`);

  // 1. Set tld
  let r = await call({ action: 'setTld', agentName: agent.name, tld: agent.tld, webhookSecret: WEBHOOK_SECRET });
  console.log(`  setTld → ${agent.tld}:`, r.data?.status ?? r.data);

  // 2. Set safe in KV via kvPut
  r = await call({ action: 'kvPut', key: `safeAddress:${agent.name}`, value: agent.safe, ownerAddress: agent.safe, webhookSecret: WEBHOOK_SECRET });
  console.log(`  safeAddress → ${agent.safe}:`, r.data?.status ?? r.data);

  // 3. Ensure erc8004:gnosis entry exists
  r = await call({
    action: 'setErc8004AgentId',
    agentName: agent.name,
    chain: agent.chain,
    erc8004AgentId: agent.agentId,
    agentURI: `https://ghostagent.ninja/api/agent-card?agent=${agent.name}`,
    webhookSecret: WEBHOOK_SECRET,
  });
  console.log(`  setErc8004AgentId → #${agent.agentId}:`, r.data?.status ?? r.data);
}

console.log('\nVerifying eyemine identity...');
const check = await call({ action: 'getAgentIdentity', agentName: 'eyemine' });
console.log(JSON.stringify(check.data, null, 2));
