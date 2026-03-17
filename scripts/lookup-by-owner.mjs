/**
 * Looks up nftmail KV entries for a given wallet address.
 * Uses the worker's kvList action if available, otherwise scans known keys.
 */
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url).pathname, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const TARGET = '0x718bbf2fee40bab9d5c6622bee209d0c071ac13f';

async function post(body) {
  const r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// Try kvList to get all keys with prefix nftmailgno:
const listRes = await post({ action: 'kvList', prefix: 'nftmailgno:', ownerAddress: TARGET });
console.log('kvList response:', JSON.stringify(listRes, null, 2));
