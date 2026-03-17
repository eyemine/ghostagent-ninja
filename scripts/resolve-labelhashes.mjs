import { keccak256, toHex } from 'viem';
import { readFileSync } from 'fs';

const unmatched = [
  '0xc09d40ff50ac7048fae41d65ec6f3ad2e9f6ef4c9c136475f55e6062a670ea04',
  '0xfb6777f06da5e6bde639b2c63f412c0722ef581d5a431635d106494e4c84a0b4',
];

// Brute-force candidates — common names, tech terms, etc.
const candidates = [
  // Names / words
  'eyemine', 'eye.mine', 'eye-mine',
  'satoshi', 'vitalik', 'gavin', 'buterin',
  'alice', 'bob', 'charlie', 'dave', 'eve',
  'hello', 'world', 'test', 'demo', 'dev', 'admin',
  'user', 'user1', 'user2', 'wallet',
  'richie', 'richard', 'richieogorman', 'rich',
  'ogorman', 'gorman',
  // NFT / crypto handles
  'degen', 'whale', 'ape', 'pepe', 'wojak',
  'moon', 'lambo', 'hodl', 'ngmi', 'wagmi',
  'gm', 'gn', 'ser', 'fren',
  // Common email-style handles
  'john', 'jane', 'mike', 'sam', 'alex', 'chris', 'dan',
  'tom', 'tim', 'jim', 'joe', 'kim',
  // Numbers / combos
  '0', '1', '2', '3', '42', '100', '420', '1337', '9999',
  // Possible test names
  'nftmail', 'vault', 'molt', 'picoclaw', 'openclaw', 'agent',
  'ghostagent', 'ghost', 'ninja',
  // Possible real user names from context
  'slaving', 'mac', 'slave', 'macslave',
  'banksy', 'rgb', 'rgbanksy',
  'fresh', 'boy', 'freshboy',
  'angelo', 'richard.angelo',
  // chonk / pownft overlap
  'chonk', 'pownft', 'atom', 'punk',
  'normie', 'normies',
];

let found = 0;
for (const label of candidates) {
  const h = keccak256(toHex(label));
  if (unmatched.includes(h)) {
    console.log(`MATCH: "${label}" => ${h}`);
    found++;
  }
}

if (found === 0) console.log('No matches found from candidate list');

// Also check KV lookup for these token owners
console.log('\nOwner: 0x718Bbf2feE40BAB9d5C6622bEe209d0C071ac13f holds tokenId 8 and 9');
console.log('Labelhash 8:', unmatched[0]);
console.log('Labelhash 9:', unmatched[1]);
