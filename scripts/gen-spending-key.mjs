#!/usr/bin/env node
/**
 * Generate a fresh BIP-340 spending key for commit-time Safe delegation.
 *
 * USAGE: node scripts/gen-spending-key.mjs
 *
 * The private key goes into AGENT_SPENDING_KEY env var (never commit it).
 * The x-only public key (px) is shared with blockbird to pin in the ERC-8312
 * cursor leaf at registration time.
 *
 * The Safe authorises this key ONCE at leaf registration. Every spend draw
 * is then signed with this key — recomputable BIP-340, no per-draw Safe query.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { randomBytes } from 'crypto';

const privBytes = randomBytes(32);
const pubBytes  = schnorr.getPublicKey(privBytes);

const privHex = '0x' + privBytes.toString('hex');
const px      = '0x' + Buffer.from(pubBytes).toString('hex');

console.log('─────────────────────────────────────────────────────');
console.log('BIP-340 Spending Key (KEEP PRIVATE)');
console.log('─────────────────────────────────────────────────────');
console.log('Private key (AGENT_SPENDING_KEY):', privHex);
console.log('');
console.log('─────────────────────────────────────────────────────');
console.log('x-only Public Key (px) — SAFE TO SHARE');
console.log('─────────────────────────────────────────────────────');
console.log('issuerKey (px):', px);
console.log('');
console.log('Next steps:');
console.log('1. Add to .env:  AGENT_SPENDING_KEY=' + privHex);
console.log('2. Share px with blockbird to pin in the ERC-8312 cursor leaf');
console.log('3. Have Safe co-sign the leaf registration tx that commits this px');
console.log('4. Add px to ERC-8004 card under issuerKey field');
