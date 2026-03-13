/**
 * Registers eyemine in the worker KV.
 * The NFT eyemine.nftmail.gno was minted on-chain (tokenId 1, new registrar)
 * but has no KV entry — this seeds it.
 */
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url).pathname, 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const SAFE = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4';
const NOW = Date.now();
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

async function kvPut(key, value) {
  const r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'kvPut',
      key,
      value,
      ownerAddress: SAFE.toLowerCase(),
    }),
  });
  return r.json();
}

// Write sovereign record
await kvPut('nftmailgno:eyemine', JSON.stringify({
  controller: SAFE,
  origin_nft: 'eyemine.nftmail.gno',
  legacy_identity: null,
  minted_tokenId: 1,
  registrar: '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  chain: 'gnosis',
  registered_at: NOW,
}));
console.log('nftmailgno:eyemine written');

// Write privacy record
await kvPut('privacy:eyemine', JSON.stringify({ tier: 'private' }));
console.log('privacy:eyemine written');

// Write account tier
await kvPut('acct-tier:eyemine', JSON.stringify({
  tier: 'basic',
  expires_at: NOW + EIGHT_DAYS_MS,
  upgraded_at: null,
  safe: null,
  retention: '8-day',
  story_ip: null,
}));
console.log('acct-tier:eyemine written');

// Write reverse tokenId index
await kvPut('nft-token:nftmail:1', JSON.stringify({
  label: 'eyemine',
  sld: 'nftmail',
  mintedAt: NOW,
}));
console.log('nft-token:nftmail:1 written');

console.log('\nDone — eyemine_@nftmail.box is now registered');
