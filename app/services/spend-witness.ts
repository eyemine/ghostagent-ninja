/**
 * spend-witness.ts
 *
 * Defines the recomputable spend witness used to gate advanceCursor() draws
 * on an ERC-1833 metering cursor.
 *
 * Witness shape (matches babyblueviper1 BIP340Verifier on Sepolia):
 *   - artifact_hash = sha256(canonical_json(bound_inputs))
 *   - BIP-340 (Schnorr) signature over artifact_hash by the agent's issuer key
 *   - On-chain calldata: abi.encode(bytes32 px, bytes32 rx, bytes32 s, bytes preimage)
 *   - verify(px, rx, s, preimage) → (valid: bool, match: bool)
 *
 * The bound inputs are the spend authorization claim — cursor, safe, payee,
 * amount, replay nonce, chainId. Anyone can recompute the hash from public data.
 *
 * The signing key (px) is the agent's execution key x-coordinate, published
 * in the ERC-8004 card under `issuerKey`. The cursor pins this key per cursor leaf.
 *
 * Ref verifier (testnet): BIP340Verifier 0x7c99c52Ed86EcedD65e60482243aa882a50F3b70 (Sepolia)
 * Ref escrow (testnet):   RecoveryEscrow  0x71D8E5a2AD591EEf8541527DFfD705BC69134f59 (Sepolia)
 *
 * NOTE: The Sepolia BIP340.sol has an open independent schnorr-math review.
 *       Do not place mainnet value behind this until that review completes.
 */

import { schnorr }          from '@noble/curves/secp256k1';
import { sha256 }           from '@noble/hashes/sha256';
import { encodeAbiParameters } from 'viem';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The bound inputs that define a single spend draw. All fields are strings
 *  for canonical JSON stability — numbers must NOT be passed as JS numbers. */
export interface SpendWitnessInputs {
  cursorId:    string;   // ERC-1833 cursor contract address (checksummed 0x…)
  safeAddress: string;   // Agent Safe address (checksummed 0x…)
  payee:       string;   // Payment destination address (checksummed 0x…)
  amountWei:   string;   // Decimal string, e.g. "500000000000000"
  nonce:       string;   // 0x-prefixed hex replay nullifier (32 bytes)
  chainId:     string;   // Decimal string, e.g. "100" — string for canonical stability
}

export interface SpendWitness {
  inputs:       SpendWitnessInputs;
  artifactHash: `0x${string}`;    // sha256 of canonical JSON (hex)
  preimage:     Uint8Array;        // UTF-8 bytes of canonical JSON
  /** BIP-340 pubkey x-coordinate of the signing key (32 bytes, hex) */
  px:           `0x${string}`;
  /** BIP-340 signature R.x (32 bytes, hex) */
  rx:           `0x${string}`;
  /** BIP-340 signature s scalar (32 bytes, hex) */
  s:            `0x${string}`;
  /** abi.encode(px, rx, s, preimage) — passed to advanceCursor(witness) */
  calldata:     `0x${string}`;
}

// ── Canonical JSON ─────────────────────────────────────────────────────────────

/**
 * Produce the canonical JSON for the bound inputs.
 * Keys are sorted alphabetically, no whitespace — byte-identical to the
 * off-chain recompute and what the on-chain verifier reads out of the preimage.
 */
export function canonicalJson(inputs: SpendWitnessInputs): string {
  const ordered: Record<string, string> = {};
  for (const key of (Object.keys(inputs) as (keyof SpendWitnessInputs)[]).sort()) {
    ordered[key] = inputs[key];
  }
  return JSON.stringify(ordered);
}

// ── Hashing ────────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

function pad32(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

// ── Core: pack witness ─────────────────────────────────────────────────────────

/**
 * Build a complete SpendWitness from inputs + the agent's BIP-340 private key.
 *
 * The private key is the agent's execution key (TBA/wallet key).
 * Its x-coordinate (px) is published in the ERC-8004 card as `issuerKey`
 * and pinned by the cursor per cursor leaf — no trusted party in the loop.
 *
 * @param inputs      Spend authorization bound inputs
 * @param privateKey  Agent execution key, hex without 0x prefix or with it
 */
export function packSpendWitness(
  inputs: SpendWitnessInputs,
  privateKey: string,
): SpendWitness {
  const privKeyBytes = hexToBytes(privateKey);

  // 1. Canonical preimage
  const json     = canonicalJson(inputs);
  const preimage = new TextEncoder().encode(json);

  // 2. artifact_hash = sha256(preimage)
  const hashBytes   = sha256(preimage);
  const artifactHash: `0x${string}` = bytesToHex(hashBytes);

  // 3. BIP-340 (Schnorr) sign — signs the 32-byte hash directly
  const sigBytes = schnorr.sign(hashBytes, privKeyBytes);
  const rx = bytesToHex(pad32(sigBytes.slice(0, 32)));
  const s  = bytesToHex(pad32(sigBytes.slice(32, 64)));

  // 4. Derive public key x-coordinate (px) — published in ERC-8004 card
  const pubkeyBytes = schnorr.getPublicKey(privKeyBytes); // 32 bytes, x-only
  const px = bytesToHex(pubkeyBytes);

  // 5. ABI-encode for advanceCursor(witness) calldata
  const calldata = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes' }],
    [px as `0x${string}`, rx as `0x${string}`, s as `0x${string}`, preimage],
  );

  return { inputs, artifactHash, preimage, px: px as `0x${string}`, rx: rx as `0x${string}`, s: s as `0x${string}`, calldata };
}

// ── Verify (off-chain recompute) ───────────────────────────────────────────────

/**
 * Off-chain recompute of the witness — mirrors what verify() does on-chain.
 * Anyone can call this with the public preimage to confirm the signature
 * without trusting any oracle.
 *
 * @returns { valid, match } — same shape as on-chain verify() return
 */
export function verifySpendWitness(
  witness: SpendWitness,
  issuerPubkeyHex: string,
): { valid: boolean; match: boolean } {
  const pubkeyBytes  = hexToBytes(issuerPubkeyHex);
  const hashBytes    = sha256(witness.preimage);
  const sigBytes     = new Uint8Array([
    ...hexToBytes(witness.rx),
    ...hexToBytes(witness.s),
  ]);

  let valid = false;
  try {
    valid = schnorr.verify(sigBytes, hashBytes, pubkeyBytes);
  } catch { /* invalid sig bytes → false */ }

  // match: re-derived hash matches the artifact_hash in the witness
  const match = bytesToHex(hashBytes) === witness.artifactHash;

  return { valid, match };
}

// ── Nonce generation ───────────────────────────────────────────────────────────

/**
 * Generate a replay-nullifying nonce for a spend witness.
 * Deterministic from (safeAddress, payee, amountWei, sessionId) — the same
 * x402 session always produces the same nonce, preventing duplicate draws.
 */
export function deriveSpendNonce(
  safeAddress: string,
  payee:       string,
  amountWei:   string,
  sessionId:   string,
): `0x${string}` {
  const input = new TextEncoder().encode(
    `${safeAddress.toLowerCase()}:${payee.toLowerCase()}:${amountWei}:${sessionId}`,
  );
  return bytesToHex(sha256(input));
}

// ── Issuer key extraction ──────────────────────────────────────────────────────

/**
 * Derive the BIP-340 public key x-coordinate from an execution private key.
 * This is the value to publish in the ERC-8004 card under `issuerKey`
 * and to register with the cursor as the pinned signer for this leaf.
 */
export function deriveIssuerKey(privateKey: string): `0x${string}` {
  const privBytes   = hexToBytes(privateKey);
  const pubkeyBytes = schnorr.getPublicKey(privBytes);
  return bytesToHex(pubkeyBytes);
}
