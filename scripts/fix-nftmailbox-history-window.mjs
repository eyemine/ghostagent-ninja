import { readFileSync, writeFileSync } from 'fs';

const fixes = [
  {
    path: '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/components/MintNFTMail.tsx',
    replacements: [
      ['Free — messages clear after 8 days, inbox address permanent.', 'Free — 8-day history window, inbox address permanent.'],
    ],
  },
  {
    path: '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/inbox/[name]/page.tsx',
    replacements: [
      ['8-day messages cleared — your inbox address is permanent', '8-day history window — inbox address is permanent'],
    ],
  },
];

for (const { path, replacements } of fixes) {
  let c = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (c.includes(from)) {
      c = c.replaceAll(from, to);
      console.log(`✓ ${path.split('/').pop()}: updated`);
    } else {
      console.log(`✗ NOT FOUND in ${path.split('/').pop()}: ${from.slice(0, 60)}`);
    }
  }
  writeFileSync(path, c, 'utf8');
}
console.log('Done');
