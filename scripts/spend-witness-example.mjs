#!/usr/bin/env node
/**
 * Produces a concrete worked example of the spend-witness preimage and sha256.
 * Share the output with babyblueviper1 to assert byte-identical reconstruction.
 */
import { createHash } from 'crypto';

// ── Canonicalisation (mirrors spend-witness.ts exactly) ────────────────────────

function canonicalJson(inputs) {
  const ordered = {};
  for (const key of Object.keys(inputs).sort()) {
    ordered[key] = inputs[key];
  }
  return JSON.stringify(ordered);
}

function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function deriveNonce(safeAddress, payee, amountWei, sessionId) {
  const raw = `${safeAddress.toLowerCase()}:${payee.toLowerCase()}:${amountWei}:${sessionId}`;
  return '0x' + sha256Hex(raw);
}

// ── Example inputs ──────────────────────────────────────────────────────────────
// Use a placeholder cursorId (real address filled once blockbird deploys on Chiado)
// All addresses: lowercase 0x (not EIP-55 checksummed) for serialisation stability

const safeAddress = '0xb7e493e3d226f8fe722cc9916ff164b793af13f4';
const payee       = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amountWei   = '500000000000000';   // 0.0005 xDAI, decimal string
const sessionId   = 'test-session-001';
const cursorId    = '0x0000000000000000000000000000000000008312'; // placeholder
const chainId     = '10200';             // Chiado testnet, decimal string

const nonce = deriveNonce(safeAddress, payee, amountWei, sessionId);

const inputs = { amountWei, chainId, cursorId, nonce, payee, safeAddress };

const preimage    = canonicalJson(inputs);
const artifactHash = '0x' + sha256Hex(preimage);

console.log('=== Spend Witness Worked Example ===');
console.log('');
console.log('Field set (alphabetical order — this is the sort order in canonical JSON):');
console.log('  amountWei:   ', amountWei,  '  (decimal string, no 0x, no leading zeros)');
console.log('  chainId:     ', chainId,    '  (decimal string)');
console.log('  cursorId:    ', cursorId,   '  (lowercase 0x address)');
console.log('  nonce:       ', nonce,      '  (0x + sha256 hex, lowercase)');
console.log('  payee:       ', payee,      '  (lowercase 0x address)');
console.log('  safeAddress: ', safeAddress,'  (lowercase 0x address)');
console.log('');
console.log('Canonical preimage (JSON.stringify, sorted keys, no whitespace, UTF-8):');
console.log(preimage);
console.log('');
console.log('artifact_hash = sha256(UTF-8(preimage)):');
console.log(artifactHash);
console.log('');
console.log('Nonce derivation (for reference — nonce IS a field in the preimage):');
console.log('  sha256(utf8("safeAddress.toLowerCase():payee.toLowerCase():amountWei:sessionId"))');
console.log('  input string:', `${safeAddress}:${payee}:${amountWei}:${sessionId}`);
console.log('  result:      ', nonce);
