import { readFileSync, writeFileSync } from 'fs';

const path = '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/inbox/[name]/page.tsx';
const lines = readFileSync(path, 'utf8').split('\n');

// Replace lines 487-490 (0-indexed: 486-489)
// Old:
//   <p className="text-center text-sm text-[var(--muted)] max-w-md">
//     Your <strong className="text-white">Basic</strong> inbox has decayed. Upgrade to
//     {' '}<strong className="text-amber-300">Lite ($10)</strong> to restore sending,
//     get a <strong className="text-white">Gnosis Safe body</strong>, and extend your account.
//   </p>

const oldSlice = lines.slice(486, 491).join('\n');
console.log('Old lines 487-491:\n', oldSlice);

lines[487] = '              <p className="text-center text-sm text-[var(--muted)] max-w-md">';
lines[488] = '                Your <strong className="text-white">{name}@nftmail.box</strong> is permanent — free tier messages clear after 8 days.';
lines[489] = '                Upgrade to {\'\'}<strong className="text-amber-300">Lite ($10)</strong> for 30-day retention,';
lines[490] = '                sending, and a <strong className="text-white">Gnosis Safe body</strong>.';

writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Body copy updated.');
