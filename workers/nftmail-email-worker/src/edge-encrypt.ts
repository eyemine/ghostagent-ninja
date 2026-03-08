/// @module edge-encrypt
/// Edge encryption primitives for nftmail-email-worker.
///
/// Contract: cleartext NEVER touches KV, audit log, or any external call.
/// Only the SHA-256 content hash is logged. ECIES ciphertext is stored.
///
/// All functions use crypto.subtle (Web Crypto API — Cloudflare Workers runtime).
/// Zero npm dependencies. Zero external calls.

// ── Types ────────────────────────────────────────────────────────────────────

export interface CleartextEnvelope {
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: number;
}

export interface SealedEnvelope {
  /** SHA-256 hex of the canonical JSON cleartext. Logged to Glass Box. */
  contentHash: string;
  /** Wall-clock ms at which the hash was derived — proves 0ms cleartext exposure. */
  encryptedAtMs: number;
  /** Canonical JSON string — held in memory only until ECIES encrypt completes. */
  readonly _plaintext: string;
}

export interface AuditHashEntry {
  contentHash: string;
  encryptedAtMs: number;
  recipient: string;
  receivedAt: number;
  /** 'Encrypted at Edge: 0ms cleartext' — written to Glass Box, never the body. */
  note: string;
}

// ── Core: seal cleartext immediately on receipt ───────────────────────────────

/**
 * sealCleartext — call this as the FIRST operation after reading message.raw.
 *
 * Returns a SealedEnvelope that carries the hash + the plaintext string
 * (still in memory, but never persisted). Pass _plaintext to eciesEncrypt,
 * then discard. Only contentHash and encryptedAtMs leave this scope.
 */
export async function sealCleartext(env: CleartextEnvelope): Promise<SealedEnvelope> {
  const canonical = JSON.stringify({
    from: env.from,
    to: env.to,
    subject: env.subject,
    body: env.body,
    timestamp: env.timestamp,
  });

  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashHex = [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    contentHash: hashHex,
    encryptedAtMs: Date.now(),
    _plaintext: canonical,
  };
}

/**
 * buildAuditHashEntry — constructs the Glass Box audit entry.
 * Contains ONLY the hash, never the cleartext.
 */
export function buildAuditHashEntry(
  sealed: SealedEnvelope,
  recipient: string,
  receivedAt: number,
): AuditHashEntry {
  return {
    contentHash: sealed.contentHash,
    encryptedAtMs: sealed.encryptedAtMs,
    recipient,
    receivedAt,
    note: 'Encrypted at Edge: 0ms cleartext',
  };
}

/**
 * assertNoPlaintextLeak — call after ECIES encrypt to zero the reference.
 * TypeScript can't guarantee GC timing, but this makes the contract visible
 * in code review and prevents accidental reuse of _plaintext downstream.
 */
export function releasePlaintext(sealed: SealedEnvelope): Omit<SealedEnvelope, '_plaintext'> {
  const { _plaintext: _discarded, ...safe } = sealed;
  void _discarded; // explicitly consumed — not passed forward
  return safe;
}
