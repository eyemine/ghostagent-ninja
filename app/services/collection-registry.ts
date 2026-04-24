/**
 * @module collection-registry
 * Registry of approved NFT collections for identity molting.
 *
 * Two distinct naming conventions:
 *
 * Scenario A — Direct NFT mint (human mints nftmail account from their NFT):
 *   Email:  CHONK.123@nftmail.box       (dot separator, no trailing _)
 *   Beacon: chonk123.nftmail.gno        (no separator)
 *
 * Scenario B — Agent molt (existing agent overlays NFT identity):
 *   Email:  CHONK.123_@nftmail.box      (dot separator + trailing _ = agent)
 *   Beacon: chonk-123.nftmail.gno       (hyphen separator distinguishes from direct)
 *
 * The trailing _ is the universal agent convention across the whole system.
 * The hyphen beacon prevents KV key collisions between direct and molt records.
 */

export interface CollectionConfig {
  id: string;               // unique slug  e.g. 'chonk'
  name: string;             // display name e.g. 'Chonk'
  icon: string;             // emoji
  description: string;
  contract: `0x${string}`;
  chainId: number;
  rpcUrl: string;

  // ── Scenario A: Direct NFT mint ──────────────────────────────────────────
  // Email local part: {PREFIX}.{tokenId}   e.g. CHONK.123
  // Beacon label:     {prefix}{tokenId}    e.g. chonk123
  directEmailPrefix: string;   // e.g. 'CHONK'  → CHONK.123@nftmail.box
  directBeaconPrefix: string;  // e.g. 'chonk'  → chonk123.nftmail.gno

  // ── Scenario B: Agent molt overlay ───────────────────────────────────────
  // Email local part: {PREFIX}.{tokenId}_  e.g. CHONK.123_
  // Beacon label:     {prefix}-{tokenId}   e.g. chonk-123
  moltEmailPrefix: string;     // same as directEmailPrefix (e.g. 'CHONK')
  moltBeaconPrefix: string;    // e.g. 'chonk'  → chonk-123.nftmail.gno

  // ── ENS reserved words (block as primary agent names) ────────────────────
  ensReserved: string[];       // names that would clash with ENS or collection

  accentColor: string;         // tailwind color key for UI theming
  opensea?: string;            // OpenSea collection slug for links
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns the email local part for Scenario A: CHONK.123 */
export function directEmailLocalPart(c: CollectionConfig, tokenId: string): string {
  return `${c.directEmailPrefix}.${tokenId}`;
}

/** Returns the email local part for Scenario B: CHONK.123_ */
export function moltEmailLocalPart(c: CollectionConfig, tokenId: string): string {
  return `${c.moltEmailPrefix}.${tokenId}_`;
}

/** Returns the beacon label for Scenario A: chonk123 */
export function directBeaconLabel(c: CollectionConfig, tokenId: string): string {
  return `${c.directBeaconPrefix}${tokenId}`;
}

/** Returns the beacon label for Scenario B: chonk-123 */
export function moltBeaconLabel(c: CollectionConfig, tokenId: string): string {
  return `${c.moltBeaconPrefix}-${tokenId}`;
}

// ─── Approved Collections ──────────────────────────────────────────────────

export const COLLECTION_REGISTRY: Record<string, CollectionConfig> = {
  chonk: {
    id: 'chonk',
    name: 'Chonk',
    icon: '🦀',
    description: 'Chonk NFT collection on Base — the original ghost agent overlay',
    contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    // A: CHONK.123@nftmail.box  /  chonk123.nftmail.gno
    directEmailPrefix: 'CHONK',
    directBeaconPrefix: 'chonk',
    // B: CHONK.123_@nftmail.box /  chonk-123.nftmail.gno
    moltEmailPrefix: 'CHONK',
    moltBeaconPrefix: 'chonk',
    ensReserved: ['chonk'],
    accentColor: 'fuchsia',
    opensea: 'chonk-nft',
  },

  pownft: {
    id: 'pownft',
    name: 'POWNFT',
    icon: '💥',
    description: 'POWNFT — on-chain generative art on Ethereum',
    contract: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405',
    chainId: 1,
    rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    // A: ATOM.42@nftmail.box    /  atom42.nftmail.gno
    directEmailPrefix: 'ATOM',
    directBeaconPrefix: 'atom',
    // B: ATOM.42_@nftmail.box   /  atom-42.nftmail.gno
    moltEmailPrefix: 'ATOM',
    moltBeaconPrefix: 'atom',
    ensReserved: ['atom', 'pownft', 'pow'],
    accentColor: 'yellow',
    opensea: 'pownft',
  },

  punks: {
    id: 'punks',
    name: 'CryptoPunks',
    icon: '👾',
    description: 'CryptoPunks — the OG NFT collection on Ethereum',
    contract: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB',
    chainId: 1,
    rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    // A: PUNK.7804@nftmail.box  /  punk7804.nftmail.gno
    directEmailPrefix: 'PUNK',
    directBeaconPrefix: 'punk',
    // B: PUNK.7804_@nftmail.box /  punk-7804.nftmail.gno
    moltEmailPrefix: 'PUNK',
    moltBeaconPrefix: 'punk',
    ensReserved: ['punk', 'punks', 'cryptopunks'],
    accentColor: 'cyan',
    opensea: 'cryptopunks',
  },

  normies: {
    id: 'normies',
    name: 'Normies',
    icon: '🙂',
    description: 'Normies NFT collection on Base',
    contract: '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    // A: NORMIE.1@nftmail.box   /  normie1.nftmail.gno
    directEmailPrefix: 'NORMIE',
    directBeaconPrefix: 'normie',
    // B: NORMIE.1_@nftmail.box  /  normie-1.nftmail.gno
    moltEmailPrefix: 'NORMIE',
    moltBeaconPrefix: 'normie',
    ensReserved: ['normie', 'normies'],
    accentColor: 'green',
    opensea: 'normies',
  },

  mooncat: {
    id: 'mooncat',
    name: 'MoonCats',
    icon: '🐱',
    description: 'MoonCats Acclimated — OG on-chain cats on Ethereum',
    contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69',
    chainId: 1,
    rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com',
    // A: MOONCAT.1@nftmail.box   /  mooncat1.nftmail.gno
    directEmailPrefix: 'MOONCAT',
    directBeaconPrefix: 'mooncat',
    // B: MOONCAT.1_@nftmail.box  /  mooncat-1.nftmail.gno
    moltEmailPrefix: 'MOONCAT',
    moltBeaconPrefix: 'mooncat',
    ensReserved: ['mooncat', 'mooncats', 'moon'],
    accentColor: 'emerald',
    opensea: 'acclimatedmooncats',
  },
};

export function getCollection(id: string): CollectionConfig | null {
  return COLLECTION_REGISTRY[id.toLowerCase()] ?? null;
}

export function getAllCollections(): CollectionConfig[] {
  return Object.values(COLLECTION_REGISTRY);
}

// ─── ownerOf ABI call (ERC-721) ────────────────────────────────────────────

export async function verifyNFTOwnership(
  collection: CollectionConfig,
  tokenId: string,
  claimedOwner: string,
): Promise<{ verified: boolean; actualOwner: string | null }> {
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const calldata = '0x6352211e' + tokenIdHex; // ownerOf(uint256)

    // CryptoPunks uses punkIndexToAddress instead of ownerOf
    const isPunks = collection.id === 'punks';
    const punksCalldata = isPunks
      ? '0x58178168' + tokenIdHex  // punkIndexToAddress(uint256)
      : calldata;

    const res = await fetch(collection.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: collection.contract, data: isPunks ? punksCalldata : calldata }, 'latest'],
      }),
    });
    const data = await res.json() as { result?: string; error?: any };
    if (data.error || !data.result || data.result === '0x') {
      return { verified: false, actualOwner: null };
    }
    const actualOwner = ('0x' + data.result.slice(26)).toLowerCase();
    return {
      verified: actualOwner === claimedOwner.toLowerCase(),
      actualOwner,
    };
  } catch {
    return { verified: false, actualOwner: null };
  }
}
