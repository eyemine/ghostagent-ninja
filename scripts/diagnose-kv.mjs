const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
if (!WORKER_SECRET) { console.error('ERROR: WORKER_SECRET not set'); process.exit(1); }

async function call(action, body) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) return { _error: `${res.status}` };
  return res.json();
}

const agents = [
  ['ghostagent','molt.gno'],
  ['eyemine','nftmail.gno'],
  ['victor','openclaw.gno'],
  ['chonk-601',null],
  ['chonk-697',null],
  ['chonk-9534',null],
  ['super.normie',null],
  ['rare.normie',null],
];

console.log('=== KV DIAGNOSTIC ===\n');
for (const [name, expectedTld] of agents) {
  const id = await call('getAgentIdentity', { agentName: name });
  const resolve = await call('resolveAddress', { name });
  const tldRaw = await call('kvGet', { key: `tld:${name}` });
  const nftmailRaw = await call('kvGet', { key: `nftmailgno:${name}` });

  console.log(`${name}:`);
  console.log(`  identity.tld:    ${id.identityNft?.tld ?? 'null'} ${id.identityNft?.tld === expectedTld ? 'OK' : 'MISMATCH'}`);
  console.log(`  identity.name:   ${id.identityNft?.name ?? 'null'}`);
  console.log(`  identity.owner:  ${id.onChainOwner ?? 'null'}`);
  console.log(`  identity.safe:   ${id.safeAddress ?? 'null'}`);
  console.log(`  identity.tba:    ${id.tbaAddress ?? 'null'}`);
  console.log(`  resolve.ctrl:    ${resolve.controller ?? 'null'}`);
  console.log(`  resolve.owner:   ${resolve.onChainOwner ?? 'null'}`);
  console.log(`  resolve.safe:    ${resolve.safeAddress ?? 'null'}`);
  console.log(`  resolve.exists:  ${resolve.exists}`);
  console.log(`  kv.tld:          ${tldRaw.value ?? 'null'}`);
  console.log(`  kv.nftmailgno:   ${nftmailRaw.value ? 'PRESENT' : 'MISSING'}`);
  if (nftmailRaw.value) {
    try { const g = JSON.parse(nftmailRaw.value); console.log(`    controller=${g.controller||'null'}, origin_nft=${g.origin_nft||'null'}, tokenId=${g.minted_tokenId||'null'}`); } catch {}
  }
  console.log('');
}

// List ALL agents from D1+KV
console.log('=== ALL LISTED AGENTS ===');
const list = await call('listAgents', {});
if (list.agents) {
  for (const a of list.agents) {
    console.log(`  ${a.name} | tld=${a.tld ?? 'null'} | erc8004=${a.erc8004?.agentId ?? 'null'}`);
  }
}

// List by treasury controller
console.log('\n=== BY CONTROLLER (treasury) ===');
const treasury = '0xf251Ca37a80200f7AfefF398DA0338f4C1f01249';
const byCtrl = await call('listNftmailByController', { controller: treasury });
if (byCtrl.names) {
  for (const n of byCtrl.names) {
    console.log(`  ${n.name} | email=${n.email} | controller matched`);
  }
}

// List by safe
console.log('\n=== BY SAFE (treasury safe) ===');
const safe = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4';
const bySafe = await call('listNftmailByController', { controller: safe });
if (bySafe.names) {
  for (const n of bySafe.names) {
    console.log(`  ${n.name} | email=${n.email} | safe matched`);
  }
}

console.log('\nDone.');
