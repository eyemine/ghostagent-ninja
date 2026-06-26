const W = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const S = process.env.WORKER_SECRET || '';
if (!S) { console.error('WORKER_SECRET missing'); process.exit(1); }
const dry = process.argv.includes('--dry-run');

async function c(a, b) {
  const r = await fetch(W, { method:'POST', headers:{'Content-Type':'application/json','X-Worker-Secret':S}, body:JSON.stringify({action:a,...b}) });
  return r.ok ? r.json() : { _err: r.status };
}

const agents = [
  ['chonk.601','chonk-601'],['chonk.697','chonk-697'],['chonk.9534','chonk-9534'],
  ['chonk.588','chonk-588'],['chonk.599','chonk-599'],['chonk.606','chonk-606'],
  ['chonk.676','chonk-676'],['chonk.678','chonk-678'],['chonk.681','chonk-681'],
];

console.log(`=== REPAIR ${dry?'DRY RUN':'LIVE'} ===`);
let del = [];

for (const [dot,hyphen] of agents) {
  const [dN,hN,dT,hT] = await Promise.all([
    c('kvGet',{key:`nftmailgno:${dot}`}), c('kvGet',{key:`nftmailgno:${hyphen}`}),
    c('kvGet',{key:`tld:${dot}`}),       c('kvGet',{key:`tld:${hyphen}`}),
  ]);
  const dHas = dN.value && dN.value !== '{}';
  const hHas = hN.value && hN.value !== '{}';

  if (!dHas && dT.value) { del.push(`tld:${dot}`); console.log(`DELETE tld:${dot} (ghost)`); if(!dry)c('kvDelete',{key:`tld:${dot}`}); }
  if (dHas && hHas)      { del.push(`nftmailgno:${dot}`); console.log(`DELETE nftmailgno:${dot} (dup)`); if(!dry)c('kvDelete',{key:`nftmailgno:${dot}`}); }
  if (dHas && hHas && dT.value) { del.push(`tld:${dot}`); console.log(`DELETE tld:${dot} (dup)`); if(!dry)c('kvDelete',{key:`tld:${dot}`}); }
}

// Also check atom.158 (ENS overlay) vs atom-158
for (const [dot,hyphen] of [['atom.158','atom-158']]) {
  const [dN,hN,dT,hT] = await Promise.all([
    c('kvGet',{key:`nftmailgno:${dot}`}), c('kvGet',{key:`nftmailgno:${hyphen}`}),
    c('kvGet',{key:`tld:${dot}`}),       c('kvGet',{key:`tld:${hyphen}`}),
  ]);
  const dHas = dN.value && dN.value !== '{}';
  const hHas = hN.value && hN.value !== '{}';
  if (!dHas && dT.value) { del.push(`tld:${dot}`); console.log(`DELETE tld:${dot} (ghost)`); if(!dry)c('kvDelete',{key:`tld:${dot}`}); }
  if (dHas && hHas)      { del.push(`nftmailgno:${dot}`); console.log(`DELETE nftmailgno:${dot} (dup)`); if(!dry)c('kvDelete',{key:`nftmailgno:${dot}`}); }
}

// Check canonical agents
for (const name of ['ghostagent','eyemine','victor']) {
  const id = await c('getAgentIdentity',{agentName:name});
  const ok = id.onChainOwner || id.principal || id.safeAddress;
  console.log(`${name}: owner=${id.onChainOwner||'-'} safe=${id.safeAddress||'-'} ${ok?'OK':'EMPTY'}`);
}

console.log(`\nDeleted ${del.length} keys: ${del.join(', ')}`);
