/// <reference types="@cloudflare/workers-types" />
/**
 * @module zerog
 * Thin HTTP adapter for 0G Storage archive operations.
 *
 * The Cloudflare Worker cannot use @0glabs/0g-ts-sdk directly because the SDK
 * depends on Node.js `fs` and `crypto` at load time. Instead, the worker calls
 * the Next.js archiver route (running on Node.js) which does the actual upload.
 *
 * Flow:
 *   Worker reads D1 → builds AgentBundle → POSTs to ZEROG_ARCHIVER_URL
 *   → Next.js uses 0g-ts-sdk MemData → returns rootHash
 *   → Worker stores rootHash in D1 agents.zerog_root_hash
 */

export interface AgentBundle {
  schemaVersion: 1;
  exportedAt: number;
  agent: Record<string, unknown>;
  emails: Record<string, unknown>[];
  memory: Record<string, unknown>[];
  identities: Record<string, unknown>[];
}

export interface ZeroGArchiveResult {
  rootHash: string;
  txHash: string;
  size: number;
}

export interface EncryptedEnvelope {
  version: 1;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  tag: string;
  contentHash: string;
}

export interface ZeroGFetchResult {
  envelope: EncryptedEnvelope;
  rootHash: string;
  encrypted: boolean;
}

/**
 * Upload an agent bundle to 0G Storage via the Next.js archiver endpoint.
 * Returns the rootHash on success, null on failure (non-fatal).
 */
export async function archiveBundleToZeroG(
  archiverUrl: string,
  webhookSecret: string,
  bundle: AgentBundle,
  eciesPubkey: string,
): Promise<ZeroGArchiveResult | null> {
  try {
    const res = await fetch(`${archiverUrl}/api/zerog-archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': webhookSecret,
      },
      body: JSON.stringify({ bundle, eciesPubkey }),
    });
    if (!res.ok) {
      console.error('[0G archive] archiver returned', res.status, await res.text());
      return null;
    }
    return await res.json() as ZeroGArchiveResult;
  } catch (e) {
    console.error('[0G archive] upload failed (non-fatal):', e);
    return null;
  }
}

/**
 * Fetch and verify an agent bundle from 0G Storage by rootHash.
 * Returns null on failure.
 */
export async function fetchBundleFromZeroG(
  archiverUrl: string,
  webhookSecret: string,
  rootHash: string,
): Promise<EncryptedEnvelope | null> {
  try {
    const res = await fetch(`${archiverUrl}/api/zerog-archive?rootHash=${encodeURIComponent(rootHash)}`, {
      headers: { 'X-Webhook-Secret': webhookSecret },
    });
    if (!res.ok) {
      console.error('[0G fetch] archiver returned', res.status, await res.text());
      return null;
    }
    const result = await res.json() as ZeroGFetchResult;
    return result.envelope ?? null;
  } catch (e) {
    console.error('[0G fetch] failed (non-fatal):', e);
    return null;
  }
}
