/**
 * Agent Identity Router
 * Sanitizes ERC-8004 agent names into deterministic, collision-free GhostAgent handles.
 *
 * Priority hierarchy for Normie (and future ecosystem NFTs):
 *   1. ERC-8004 Agent Card "name" field (Awakened agents)
 *   2. Fallback: tokenId
 *
 * Output pattern: [slug].[collection]@nftmail.box
 */

export interface AgentSourceMetadata {
  tokenId: number;
  /** Resolved from the ERC-8004 Agent Card JSON "name" field, if the NFT is Awakened */
  erc8004Name?: string | null;
  /** Raw NFT collection name from the NFT contract metadata (lower priority than erc8004Name) */
  nftName?: string | null;
  /** Collection suffix: 'normie', 'dxterm', 'chonk', etc. */
  collection: string;
}

export interface AgentHandles {
  /** GhostAgent beacon name: e.g. shadow-trader-normie or 42-normie */
  ghostAgentName: string;
  /** NFTmail address: e.g. shadow-trader.normie@nftmail.box or 42.normie@nftmail.box */
  nftMailboxAddress: string;
  /** Just the slug portion: e.g. shadow-trader */
  slug: string;
  /** Whether this came from an ERC-8004 name (Awakened) or fell back to tokenId */
  source: 'erc8004' | 'nft-name' | 'token-id';
}

/**
 * Sanitize a raw string into a safe slug.
 * - Lowercase
 * - Strip all non-alphanumeric characters except spaces and hyphens
 * - Collapse whitespace/underscores/hyphens to single hyphens
 * - Trim leading/trailing hyphens
 * - Max 32 chars
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, '')   // strip specials
    .replace(/[\s_]+/g, '-')           // spaces/underscores → hyphens
    .replace(/-{2,}/g, '-')            // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')           // trim
    .slice(0, 32);
}

/**
 * Generate canonical GhostAgent handles for an ecosystem NFT.
 *
 * For Awakened Normies the ERC-8004 name takes priority.
 * Example results:
 *   { erc8004Name: "Shadow Trader" } → slug: shadow-trader, ghost: shadow-trader-normie, mail: shadow-trader.normie@nftmail.box
 *   { nftName: "Normie #42" }       → slug: normie-42,     ghost: normie-42-normie,     mail: normie-42.normie@nftmail.box
 *   { tokenId: 42 }                 → slug: 42,             ghost: 42-normie,             mail: 42.normie@nftmail.box
 */
export function generateAgentHandles(meta: AgentSourceMetadata): AgentHandles {
  const { tokenId, erc8004Name, nftName, collection } = meta;

  let slug: string;
  let source: AgentHandles['source'];

  if (erc8004Name && erc8004Name.trim().length > 0) {
    slug = sanitizeSlug(erc8004Name);
    source = 'erc8004';
  } else if (nftName && nftName.trim().length > 0) {
    slug = sanitizeSlug(nftName);
    source = 'nft-name';
  } else {
    slug = String(tokenId);
    source = 'token-id';
  }

  if (!slug) {
    slug = String(tokenId);
    source = 'token-id';
  }

  return {
    slug,
    ghostAgentName: `${slug}-${collection}`,
    nftMailboxAddress: `${slug}.${collection}@nftmail.box`,
    source,
  };
}

/**
 * Convenience: generate handles specifically for a Normie.
 */
export function generateNormieHandles(tokenId: number, erc8004Name?: string | null, nftName?: string | null): AgentHandles {
  return generateAgentHandles({ tokenId, erc8004Name, nftName, collection: 'normie' });
}
