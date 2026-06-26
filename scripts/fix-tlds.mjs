const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

// Canonical TLDs known from source of truth (memory / registrar records)
const KNOWN_TLDS = {
  ghostagent: 'molt.gno',
  eyemine:    'nftmail.gno',
  victor:     'openclaw.gno',
};

// FakeNormies agents — fakenormies/mint and fakenormies/claim hardcode tld:'fakenormie'
const FAKENORMIE_AGENTS = new Set(['super.normie', 'rare.normie', 'chonk-601', 'chonk-9534', 'chonk-697']);

const ALL_AGENTS = [
  'ghostagent', 'eyemine', 'victor', 'chonk676',
  'atom.158', 'chonk.676', 'chonk.681', 'chonk.588',
  'chonk.599', 'chonk.601', 'chonk.606', 'chonk.678',
  'chonk-601', 'chonk-9534', 'chonk-697', 'super.normie',
];

async function getIdentity(name) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
  });
  if (!res.ok) { console.error(`  getIdentity(${name}) failed: ${res.status}`); return null; }
  return res.json();
}

async function setTld(name, tld) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body: JSON.stringify({ action: 'setTld', agentName: name, tld }),
  });
  return res.ok;
}

function tldFromOriginNft(originNft) {
  // "chonk.676.agent.gno"    → "agent.gno"
  // "ghostagent.molt.gno"    → "molt.gno"
  // "atom-158.picoclaw.gno"  → "picoclaw.gno"
  if (!originNft) return null;
  const parts = originNft.split('.');
  return parts.length >= 3 ? parts.slice(-2).join('.') : null;
}

console.log('=== Diagnosing TLDs for all agents ===\n');

const repairs = [];

for (const name of ALL_AGENTS) {
  const identity  = await getIdentity(name);
  const currentTld = identity?.identityNft?.tld ?? null;
  const originNft  = identity?.identityNft?.name ?? null;

  const correctTld = KNOWN_TLDS[name]
    ?? (FAKENORMIE_AGENTS.has(name) ? 'fakenormie' : null)
    ?? tldFromOriginNft(originNft)
    ?? 'agent.gno';  // byo-molt default when no targetTld sent

  const status = currentTld === correctTld ? '✓ OK' : `✗ WRONG (has: ${currentTld ?? 'null'})`;
  console.log(`  ${name.padEnd(14)}  originNft: ${(originNft ?? 'none').padEnd(36)} correct: ${correctTld.padEnd(14)} ${status}`);

  if (currentTld !== correctTld) repairs.push([name, correctTld]);
}

if (repairs.length === 0) {
  console.log('\nAll TLDs correct — nothing to fix.');
} else {
  console.log(`\n=== Fixing ${repairs.length} incorrect TLDs ===\n`);
  for (const [name, tld] of repairs) {
    const ok = await setTld(name, tld);
    console.log(`  ${name} → ${tld}: ${ok ? '✓ fixed' : '✗ FAILED'}`);
  }
  console.log('\nDone.');
}
