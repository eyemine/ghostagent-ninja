#!/usr/bin/env node
/**
 * Derives the BIP-340 x-only public key (px) from the agent's execution private key.
 * This is the value to publish in the ERC-8004 card under `issuerKey`
 * and to register with babyblueviper1's reference cursor as the pinned issuer per leaf.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { config }  from 'dotenv';
config();

const raw = process.env.AGENT_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY;
if (!raw) { console.error('No AGENT_PRIVATE_KEY or TREASURY_PRIVATE_KEY in env'); process.exit(1); }

const privHex  = raw.startsWith('0x') ? raw.slice(2) : raw;
const privBytes = Buffer.from(privHex, 'hex');
const pubBytes  = schnorr.getPublicKey(privBytes);
const px        = '0x' + Buffer.from(pubBytes).toString('hex');

console.log('issuerKey (px):', px);
console.log('');
console.log('Use this as:');
console.log('  - ERC-8004 card field:  issuerKey:', px);
console.log('  - cursor leaf pinning:  pinnedIssuer =', px);
console.log('  - env var:              AGENT_ISSUER_KEY=' + px);
