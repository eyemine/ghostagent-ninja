const W = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const S = process.env.WORKER_SECRET || '';
if (!S) { console.error('WORKER_SECRET missing'); process.exit(1); }

async function c(a, b) {
  const r = await fetch(W, { method:'POST', headers:{'Content-Type':'application/json','X-Worker-Secret':S}, body:JSON.stringify({action:a,...b}) });
  return r.ok ? r.json() : { _err: r.status };
}

function ctrlOf(kvResult) {
  if (!kvResult.value) return 'MISSING';
  try { const g = JSON.parse(kvResult.value); return g.controller || 'no-controller'; } catch { return 'parse-err'; }
}

const chonks = ['601','697','9534','588','599','606','676','678','681'];

console.log('agent       | nftmailgno:DOT          | nftmailgno:HYPHEN       | tld:DOT | tld:HYPHEN | lookup(dot→hyphen)resolves?');
console.log('------------|-------------------------|-------------------------|---------|------------|----------------------------');

for (const id of chonks) {
  const dot = `chonk.${id}`, hyp = `chonk-${id}`;
  const [dN, hN, dT, hT, resolveHyp, resolveDot] = await Promise.all([
    c('kvGet',{key:`nftmailgno:${dot}`}),
    c('kvGet',{key:`nftmailgno:${hyp}`}),
    c('kvGet',{key:`tld:${dot}`}),
    c('kvGet',{key:`tld:${hyp}`}),
    c('resolveAddress',{name:`${hyp}_`}),  // what agent-lookup actually calls
    c('resolveAddress',{name:`${dot}_`}),  // what it SHOULD call
  ]);
  console.log(
    `${dot.padEnd(11)} | ${ctrlOf(dN).slice(0,23).padEnd(23)} | ${ctrlOf(hN).slice(0,23).padEnd(23)} | ${(dT.value||'-').slice(0,7).padEnd(7)} | ${(hT.value||'-').slice(0,10).padEnd(10)} | hyp:${resolveHyp.exists?'YES':'no'} dot:${resolveDot.exists?'YES':'no'}`
  );
}
