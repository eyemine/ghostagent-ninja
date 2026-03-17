import { readFileSync, writeFileSync } from 'fs';

const fixes = [
  {
    path: '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/api/send-email/route.ts',
    replacements: [
      [
        'This address does not exist or has expired',
        'This address does not exist',
      ],
    ],
  },
  {
    path: '/Users/richieogorman/CascadeProjects/ghostagent_ninja/apps/nftmailbox/app/components/MintNFTMail.tsx',
    replacements: [
      [
        'Free — 8-day inbox, receive only. Upgrade to Lite to send &amp; molt.',
        'Free — messages clear after 8 days, inbox address permanent. Upgrade to Lite to send &amp; molt.',
      ],
    ],
  },
];

for (const { path, replacements } of fixes) {
  let c = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (c.includes(from)) {
      c = c.replaceAll(from, to);
      console.log(`✓ ${path.split('/').pop()}: ${from.slice(0, 50)}`);
    } else {
      console.log(`✗ NOT FOUND in ${path.split('/').pop()}: ${from.slice(0, 50)}`);
    }
  }
  writeFileSync(path, c, 'utf8');
}

console.log('Done');
