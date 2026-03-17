import { readFileSync, writeFileSync } from 'fs';

const path = '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/inbox/[name]/page.tsx';
let c = readFileSync(path, 'utf8');

const fixes = [
  // 1. Section comment
  [
    '// ─── EXPIRED BASIC TIER: account dormant, show renewal prompt ───',
    '// ─── MESSAGES CLEARED (basic tier): identity permanent, inbox address active ───',
  ],
  // 2. Condition — was checking !exists + expired, now checks exists + messagesCleared
  [
    'if (resolved && !resolved.exists && resolved.expired) {',
    'if (resolved && resolved.exists && resolved.messagesCleared) {',
  ],
  // 3. EXPIRED badge
  [
    'bg-amber-500/10 text-amber-300 ring-amber-500/20">EXPIRED</span>',
    'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20">MESSAGES CLEARED</span>',
  ],
  // 4. Status line
  [
    'Basic tier expired — 8-day inbox window closed',
    '8-day messages cleared — your inbox address is permanent',
  ],
  // 5. Amber dot → zinc
  [
    '<div className="h-3 w-3 rounded-full bg-amber-400" />',
    '<div className="h-3 w-3 rounded-full bg-zinc-400" />',
  ],
  // 6. Body copy
  [
    'Your <strong className="text-white">Basic</strong> inbox has decayed. Upgrade to\n                {\'\'}<strong className="text-amber-300">Lite ($10)</strong> to restore sending,\n                get a <strong className="text-white">Gnosis Safe body</strong>, and extend your account.',
    'Your <strong className="text-white">{name}@nftmail.box</strong> is permanent — free tier messages clear after 8 days.\n                Upgrade to {\'\'}<strong className="text-amber-300">Lite ($10)</strong> for 30-day retention,\n                sending, and a <strong className="text-white">Gnosis Safe body</strong>.',
  ],
];

for (const [from, to] of fixes) {
  if (c.includes(from)) {
    c = c.replaceAll(from, to);
    console.log(`✓ Fixed: ${from.slice(0, 60)}`);
  } else {
    console.log(`✗ Not found: ${from.slice(0, 60)}`);
  }
}

writeFileSync(path, c, 'utf8');
console.log('Done');
