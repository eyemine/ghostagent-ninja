import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url).pathname, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const SECRET = env.NFTMAIL_WEBHOOK_SECRET;

async function kvGet(key) {
  const r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'kvGet', key, secret: SECRET }),
  });
  const d = await r.json();
  return d.value || null;
}

const keys = [
  'nftmailgno:eyemine_',
  'nftmailgno:eyemine',
  'acct-tier:eyemine_',
  'acct-tier:eyemine',
  'privacy:eyemine_',
  'privacy:eyemine',
  'erc8004:eyemine',
];

for (const k of keys) {
  const v = await kvGet(k);
  console.log(v ? `FOUND  ${k}: ${v}` : `       ${k}: not found`);
}
