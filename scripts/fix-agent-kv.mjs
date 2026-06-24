#!/usr/bin/env node
/**
 * One-off KV repair script
 * - Fixes atom.158: tier=lite, tld=molt.gno, originNft=atom-158.molt.gno
 * - Removes chonk-601 FakeNormie duplicate from KV
 * Auto-loads .env / .env.local
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

if (!WORKER_SECRET || !WEBHOOK_SECRET) {
  console.error('WORKER_SECRET and WEBHOOK_SECRET required');
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Worker-Secret': WORKER_SECRET,
  'X-Webhook-Secret': WEBHOOK_SECRET,
};

async function call(body) {
  const res = await fetch(WORKER_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  // ── atom.158 fixes ────────────────────────────────────────────────────────
  console.log('\n=== Fixing atom.158 ===');

  // 1. Tier → lite (displayed as Pro)
  let r = await call({ action: 'setAgentRecord', agentName: 'atom.158', tier: 'lite', secret: WEBHOOK_SECRET });
  console.log('  tier → lite:', r.data?.status ?? r.data?.error ?? r.status);

  // 2. TLD → molt.gno
  r = await call({ action: 'setTld', agentName: 'atom.158', tld: 'molt.gno', secret: WEBHOOK_SECRET });
  console.log('  tld → molt.gno:', r.data?.status ?? r.data?.error ?? r.status);

  // 3. originNft → atom-158.molt.gno (hyphens, matching GNS on-chain subname)
  r = await call({ action: 'setAgentRecord', agentName: 'atom.158', originNft: 'atom-158.molt.gno', secret: WEBHOOK_SECRET });
  console.log('  originNft → atom-158.molt.gno:', r.data?.status ?? r.data?.error ?? r.status);

  // ── chonk-601 FakeNormie duplicate removal ────────────────────────────────
  console.log('\n=== Removing chonk-601 FakeNormie duplicate ===');

  // The FakeNormie duplicate is stored under 'chonk-601' (hyphen) with fakenormie TLD
  // Deleting tld: key removes it from listAgents entirely
  for (const slug of ['chonk-601', 'chonk.601']) {
    // Only delete KV keys if this slug has tld=fakenormie (safe guard)
    const tldRes = await call({ action: 'kvGet', key: `tld:${slug}` });
    const tldVal = tldRes.data?.value ?? null;
    if (!tldVal) { console.log(`  ${slug}: no tld key, skipping`); continue; }
    if (tldVal !== 'fakenormie') { console.log(`  ${slug}: tld="${tldVal}" (not fakenormie), skipping`); continue; }

    console.log(`  ${slug}: tld=fakenormie — deleting KV entries`);
    for (const key of [`tld:${slug}`, `nftmailgno:${slug}`, `acct-tier:${slug}`, `byo-origin-image:${slug}`]) {
      const dr = await call({ action: 'kvDelete', key, webhookSecret: WEBHOOK_SECRET });
      console.log(`    ${key}: ${dr.data?.status ?? dr.data?.error ?? dr.status}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
