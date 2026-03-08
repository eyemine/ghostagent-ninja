/// @module alias-router
/// Email alias system for NFT collection molt identities.
///
/// Architecture:
///   Primary address:  paymastr_@nftmail.box   (agent brain — never changes)
///   Alias address:    CHONK_123_@nftmail.box  (Chonk NFT identity)
///   Both addresses route to the same KV inbox / Safe.
///
/// KV keys:
///   alias:primary:{primaryName}  → AliasRecord (JSON)
///   alias:reverse:{aliasLocal}   → primaryName  (string, for inbound routing)
///
/// Inbound email flow:
///   1. Email arrives at CHONK_123_@nftmail.box
///   2. alias-router.resolveAlias('chonk_123_') → 'paymastr' (primaryName)
///   3. Worker stores email under primaryName's KV inbox as normal
///   4. Blind index updated under primaryName
///
/// Display logic:
///   - Marketplace / public profile: reads AliasRecord.displayEmail
///     → shows alias address if displayEmail === 'alias'
///   - Agent brain: always reads/writes using primaryName_@nftmail.box

import type { KVNamespace } from '@cloudflare/workers-types';

export interface AliasRecord {
  primaryName: string;       // bare name, no _  e.g. "paymastr"
  aliasLocalPart: string;    // with trailing _   e.g. "CHONK_123_"
  collectionName: string;    // lowercase          e.g. "chonk"
  tokenId: string;           //                   e.g. "123"
  ownerAddress: string;      // lowercase EVM address
  displayEmail: 'primary' | 'alias';
  createdAt: number;
  updatedAt: number;
}

// ── KV key helpers ─────────────────────────────────────────────────────────

export function aliasPrimaryKey(primaryName: string): string {
  return `alias:primary:${primaryName.toLowerCase()}`;
}

export function aliasReverseKey(aliasLocalPart: string): string {
  return `alias:reverse:${aliasLocalPart.toLowerCase()}`;
}

// ── Read ───────────────────────────────────────────────────────────────────

export async function getAlias(
  kv: KVNamespace,
  primaryName: string,
): Promise<AliasRecord | null> {
  const raw = await kv.get(aliasPrimaryKey(primaryName));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AliasRecord;
  } catch {
    return null;
  }
}

/**
 * Given an inbound alias local-part (e.g. "chonk_123_"), return the
 * primaryName it maps to (e.g. "paymastr"), or null if no alias exists.
 */
export async function resolveAlias(
  kv: KVNamespace,
  aliasLocalPart: string,
): Promise<string | null> {
  return kv.get(aliasReverseKey(aliasLocalPart));
}

// ── Write ──────────────────────────────────────────────────────────────────

export interface CreateAliasParams {
  primaryName: string;
  aliasLocalPart: string;    // e.g. "CHONK_123_"
  collectionName: string;
  tokenId: string;
  ownerAddress: string;
  displayEmail?: 'primary' | 'alias';
}

export interface CreateAliasResult {
  status: 'created' | 'updated';
  record: AliasRecord;
}

export async function createAlias(
  kv: KVNamespace,
  params: CreateAliasParams,
): Promise<CreateAliasResult> {
  const {
    primaryName,
    aliasLocalPart,
    collectionName,
    tokenId,
    ownerAddress,
    displayEmail = 'primary',
  } = params;

  const existing = await getAlias(kv, primaryName);
  const now = Date.now();

  const record: AliasRecord = {
    primaryName: primaryName.toLowerCase(),
    aliasLocalPart,
    collectionName: collectionName.toLowerCase(),
    tokenId,
    ownerAddress: ownerAddress.toLowerCase(),
    displayEmail,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // Forward mapping: primaryName → AliasRecord
  await kv.put(aliasPrimaryKey(primaryName), JSON.stringify(record));

  // Reverse mapping: aliasLocalPart → primaryName (for inbound routing)
  await kv.put(aliasReverseKey(aliasLocalPart), primaryName.toLowerCase());

  // If there was a previous alias with a different local-part, clean up the
  // old reverse key so stale aliases don't route to this primary.
  if (existing && existing.aliasLocalPart !== aliasLocalPart) {
    await kv.delete(aliasReverseKey(existing.aliasLocalPart));
  }

  return { status: existing ? 'updated' : 'created', record };
}

/**
 * Toggle which address is shown as the public display address.
 * Does NOT affect routing — both always route to the primary inbox.
 */
export async function setAliasDisplay(
  kv: KVNamespace,
  primaryName: string,
  displayEmail: 'primary' | 'alias',
): Promise<AliasRecord | null> {
  const record = await getAlias(kv, primaryName);
  if (!record) return null;

  const updated: AliasRecord = { ...record, displayEmail, updatedAt: Date.now() };
  await kv.put(aliasPrimaryKey(primaryName), JSON.stringify(updated));
  return updated;
}

/**
 * Delete alias — removes both forward and reverse KV keys.
 */
export async function deleteAlias(
  kv: KVNamespace,
  primaryName: string,
): Promise<boolean> {
  const record = await getAlias(kv, primaryName);
  if (!record) return false;

  await Promise.all([
    kv.delete(aliasPrimaryKey(primaryName)),
    kv.delete(aliasReverseKey(record.aliasLocalPart)),
  ]);
  return true;
}

// ── Action handler (called from worker fetch handler) ─────────────────────

export interface AliasActionPayload {
  action: 'getAlias' | 'createAlias' | 'setAliasDisplay' | 'deleteAlias';
  primaryName?: string;
  aliasLocalPart?: string;
  collectionName?: string;
  tokenId?: string;
  ownerAddress?: string;
  displayEmail?: 'primary' | 'alias';
}

export async function handleAliasAction(
  kv: KVNamespace,
  payload: AliasActionPayload,
  request: Request,
): Promise<Response> {
  const corsOrigin = request.headers.get('Origin') || '*';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
  };

  const { action, primaryName } = payload;

  if (!primaryName) {
    return new Response(JSON.stringify({ error: 'Missing primaryName' }), { status: 400, headers });
  }

  // ── getAlias ──
  if (action === 'getAlias') {
    const record = await getAlias(kv, primaryName);
    if (!record) {
      return new Response(JSON.stringify({ exists: false, primaryName }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ exists: true, ...record }), { status: 200, headers });
  }

  // ── createAlias ──
  if (action === 'createAlias') {
    const { aliasLocalPart, collectionName, tokenId, ownerAddress, displayEmail } = payload;
    if (!aliasLocalPart || !collectionName || !tokenId || !ownerAddress) {
      return new Response(
        JSON.stringify({ error: 'Missing fields: aliasLocalPart, collectionName, tokenId, ownerAddress' }),
        { status: 400, headers }
      );
    }
    const result = await createAlias(kv, {
      primaryName,
      aliasLocalPart,
      collectionName,
      tokenId,
      ownerAddress,
      displayEmail,
    });
    return new Response(JSON.stringify({ status: result.status, ...result.record }), { status: 200, headers });
  }

  // ── setAliasDisplay ──
  if (action === 'setAliasDisplay') {
    const { displayEmail } = payload;
    if (!displayEmail || !['primary', 'alias'].includes(displayEmail)) {
      return new Response(
        JSON.stringify({ error: 'displayEmail must be "primary" or "alias"' }),
        { status: 400, headers }
      );
    }
    const updated = await setAliasDisplay(kv, primaryName, displayEmail);
    if (!updated) {
      return new Response(JSON.stringify({ error: 'No alias found for this primary' }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ status: 'ok', ...updated }), { status: 200, headers });
  }

  // ── deleteAlias ──
  if (action === 'deleteAlias') {
    const deleted = await deleteAlias(kv, primaryName);
    if (!deleted) {
      return new Response(JSON.stringify({ error: 'No alias found' }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ status: 'deleted', primaryName }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: `Unknown alias action: ${action}` }), { status: 400, headers });
}
