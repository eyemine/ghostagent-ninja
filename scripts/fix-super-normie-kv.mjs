#!/usr/bin/env node
/**
 * One-off KV fix for super.normie:
 *   - Writes erc8004:gnosis:super.normie with agentId=3588
 *   - Verifies the result with getAgentIdentity
 *
 * Usage: node scripts/fix-super-normie-kv.mjs
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

async function call(body) {
  const r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': WORKER_SECRET,
      'X-Webhook-Secret': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

// 1. Set tld:super.normie = agent.gno
console.log('Setting tld:super.normie = agent.gno...');
let res = await call({ action: 'setTld', agentName: 'super.normie', tld: 'agent.gno', webhookSecret: WEBHOOK_SECRET });
console.log('setTld:', JSON.stringify(res));

// 2. Write erc8004:gnosis:super.normie
console.log('Setting erc8004:gnosis:super.normie agentId=3588...');
res = await call({
  action: 'setErc8004AgentId',
  agentName: 'super.normie',
  chain: 'gnosis',
  erc8004AgentId: 3588,
  agentURI: 'https://ghostagent.ninja/api/agent-card?agent=super.normie',
  webhookSecret: WEBHOOK_SECRET,
});
console.log('setErc8004AgentId:', JSON.stringify(res));

// 3. Verify
console.log('\nVerifying with getAgentIdentity...');
res = await call({ action: 'getAgentIdentity', agentName: 'super.normie' });
console.log('getAgentIdentity:', JSON.stringify(res, null, 2));
