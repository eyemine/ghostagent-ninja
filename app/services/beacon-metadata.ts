/**
 * @module beacon-metadata
 * GhostAgent Beacon Metadata Schema v1.0
 *
 * Generates and pins ERC-721 / ERC-1155 compatible NFT metadata for:
 *   - .nftmail.gno subnames (no-coiner / sovereign)
 *   - .creation.ip Story Protocol assets
 *   - Chonk molt overlay identities
 *
 * Schema follows OpenSea Metadata Standard + GhostAgent extensions:
 *   ghost_agent   — Safe, TBA, email node details
 *   molt_path     — xDAI burned, evolution history, current level
 *   email_aliases — alias overlay records (Chonk, future collections)
 *
 * IPFS pinning via Lighthouse (free tier, no API key needed for small files,
 * but LIGHTHOUSE_API_KEY env var unlocks persistent pinning).
 * Falls back to nft.storage / w3s public gateway if Lighthouse is unavailable.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailAliasMeta {
  aliasEmail: string;          // e.g. "CHONK_123_@nftmail.box"
  collectionName: string;      // e.g. "chonk"
  tokenId: string;             // e.g. "123"
  chainId: number;             // e.g. 8453
  contractAddress: string;     // NFT contract
  beaconNft: string;           // e.g. "chonk.123.nftmail.gno"
  displayEmail: 'primary' | 'alias';
  createdAt: number;           // unix ms
}

export interface MoltEvent {
  fromLevel: string;           // e.g. "larva"
  toLevel: string;             // e.g. "pupa"
  xdaiBurned: number;          // fee paid
  txHash: string;
  timestamp: number;
  chain: string;               // "gnosis" | "base" | "story"
  note?: string;
}

export interface MoltPath {
  currentLevel: string;        // larva | pupa | imago | ghost
  totalXdaiBurned: number;
  history: MoltEvent[];
  nextUnlock?: string;         // description of next tier
}

export interface IPDomainEntry {
  type: 'creation.ip' | 'moltbook.ip';
  cid: string;                 // IPFS CID of this .ip asset's metadata
  minted_at: number;           // unix ms
  domain?: string;             // full domain, e.g. "paymastr.creation.ip"
  txHash?: string;
  ipAccount?: string;          // Story Protocol IP account address
}

export interface GhostAgentMeta {
  version: string;             // schema version, e.g. "1.1"
  agentName: string;           // e.g. "paymastr"
  email_node: string;          // primary email  e.g. "paymastr_@nftmail.box"
  safe_address: string | null;
  tba_address: string | null;
  ownerAddress: string;
  gnosisNft: string;           // e.g. "paymastr.nftmail.gno"
  tld: string;                 // e.g. "nftmail.gno"
  registeredAt: number;        // unix ms
  ip_domains: IPDomainEntry[]; // all minted .ip assets
  ip_primary: string | null;   // points to one entry's type, e.g. 'creation.ip'
  capabilities: string[];      // e.g. ['send', 'safe', 'story-ip']
  molt_path: MoltPath;         // evolution history (nested here in v1.1)
}

export interface BeaconMetadata {
  // ── ERC-721 standard fields ──
  name: string;
  description: string;
  image: string;               // IPFS URI or placeholder SVG data URI
  external_url: string;
  // ── OpenSea attributes ──
  attributes: Array<{ trait_type: string; value: string | number }>;
  // ── GhostAgent extensions ──
  schema_version: '1.1';
  ghost_agent: GhostAgentMeta; // all agent data nested here
  email_aliases: EmailAliasMeta[];
  // ── IPFS provenance ──
  pinned_at?: number;
  ipfs_cid?: string;
}

export interface PinResult {
  cid: string;
  url: string;
  gateway: string;
  pinnedAt: number;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export interface BuildBeaconParams {
  agentName: string;
  ownerAddress: string;
  gnosisNft: string;           // e.g. "paymastr.nftmail.gno"
  tld?: string;
  safeAddress?: string | null;
  tbaAddress?: string | null;
  storyIpDomain?: string | null;  // legacy scalar — still accepted, promoted to ip_domains[]
  ipDomains?: IPDomainEntry[];    // full array (v1.1)
  currentLevel?: string;
  xdaiBurned?: number;
  moltHistory?: MoltEvent[];
  aliases?: EmailAliasMeta[];
  registeredAt?: number;
}

export function buildBeaconMetadata(params: BuildBeaconParams): BeaconMetadata {
  const {
    agentName,
    ownerAddress,
    gnosisNft,
    tld = 'nftmail.gno',
    safeAddress = null,
    tbaAddress = null,
    storyIpDomain = null,
    ipDomains: ipDomainsParam = [],
    currentLevel = 'larva',
    xdaiBurned = 0,
    moltHistory = [],
    aliases = [],
    registeredAt = Date.now(),
  } = params;

  // Merge legacy storyIpDomain scalar into ip_domains array (deduped)
  const now = Date.now();
  const ipDomains: IPDomainEntry[] = [...ipDomainsParam];
  if (storyIpDomain && !ipDomains.find(d => d.domain === storyIpDomain)) {
    const ipType: IPDomainEntry['type'] = storyIpDomain.endsWith('moltbook.ip') ? 'moltbook.ip' : 'creation.ip';
    ipDomains.push({ type: ipType, cid: '', domain: storyIpDomain, minted_at: registeredAt ?? now });
  }
  const ipPrimary = ipDomains.find(d => d.type === 'creation.ip')?.type
    ?? ipDomains[0]?.type
    ?? null;

  // Derive capabilities from current state
  const capabilities: string[] = ['receive'];
  if (currentLevel !== 'larva') capabilities.push('send');
  if (safeAddress) capabilities.push('safe');
  if (ipDomains.length > 0) capabilities.push('story-ip');
  if (currentLevel === 'imago' || currentLevel === 'ghost') capabilities.push('infinite-retention');
  if (currentLevel === 'ghost') capabilities.push('governance');

  const primaryEmail = `${agentName}_@nftmail.box`;

  const levelDescriptions: Record<string, string> = {
    larva: 'Free tier. 8-day history window. Inbox address permanent. Receive only.',
    pupa:  '30-day inbox cycle. Send + receive. Gnosis Safe.',
    imago: 'Infinite retention. Story .ip NFT. Marketplace badge.',
    ghost: 'Sovereign agent. Governance rights. IP revenue share.',
  };

  const nextUnlockMap: Record<string, string> = {
    larva: 'Upgrade to Pupa: send capability + Gnosis Safe body (10 xDAI)',
    pupa:  'Evolve to Imago: infinite retention + Story .ip NFT (14 + 24 xDAI/yr)',
    imago: 'Ascend to Ghost: sovereign governance + IP revenue share',
    ghost: 'Max level reached — sovereign agent',
  };

  const displayAlias = aliases.find(a => a.displayEmail === 'alias');

  const attributes: BeaconMetadata['attributes'] = [
    { trait_type: 'Agent Name',    value: agentName },
    { trait_type: 'Level',         value: currentLevel.charAt(0).toUpperCase() + currentLevel.slice(1) },
    { trait_type: 'Email Node',    value: primaryEmail },
    { trait_type: 'GNS Name',      value: gnosisNft },
    { trait_type: 'TLD',           value: tld },
    { trait_type: 'xDAI Burned',   value: xdaiBurned },
    { trait_type: 'Molt Count',    value: moltHistory.length },
  ];

  if (safeAddress) {
    attributes.push({ trait_type: 'Safe Address', value: safeAddress });
  }
  if (ipDomains.length > 0) {
    attributes.push({ trait_type: 'Story IP Domain', value: ipDomains[0].domain ?? `${agentName}.${ipDomains[0].type}` });
    if (ipDomains.length > 1) {
      attributes.push({ trait_type: 'IP Domains', value: ipDomains.map(d => d.domain ?? d.type).join(', ') });
    }
  } else if (storyIpDomain) {
    attributes.push({ trait_type: 'Story IP Domain', value: storyIpDomain });
  }
  if (displayAlias) {
    attributes.push({ trait_type: 'Chonk Identity', value: displayAlias.aliasEmail });
    attributes.push({ trait_type: 'Chonk Token ID', value: displayAlias.tokenId });
  }

  const identityName = displayAlias
    ? `CHONK_${displayAlias.tokenId} (${agentName})`
    : agentName;

  return {
    name: `GhostAgent: ${identityName}`,
    description: [
      `GhostAgent identity beacon for ${primaryEmail}.`,
      levelDescriptions[currentLevel] ?? '',
      displayAlias
        ? `Chonk identity overlay active: ${displayAlias.aliasEmail} → same inbox.`
        : '',
      storyIpDomain ? `Story Protocol IP asset: ${storyIpDomain}.` : '',
      'Zero lock-in. Fully sovereign. Decentralised email identity.',
    ].filter(Boolean).join(' '),
    image: generateSvgDataUri(agentName, currentLevel, displayAlias),
    external_url: `https://ghostagent.ninja/inbox/${agentName}`,
    attributes,
    schema_version: '1.1',
    ghost_agent: {
      version: '1.1',
      agentName,
      email_node: primaryEmail,
      safe_address: safeAddress,
      tba_address: tbaAddress,
      ownerAddress: ownerAddress.toLowerCase(),
      gnosisNft,
      tld,
      registeredAt,
      ip_domains: ipDomains,
      ip_primary: ipPrimary,
      capabilities,
      molt_path: {
        currentLevel,
        totalXdaiBurned: xdaiBurned,
        history: moltHistory,
        nextUnlock: nextUnlockMap[currentLevel],
      },
    },
    email_aliases: aliases,
  };
}

// ─── SVG placeholder image ─────────────────────────────────────────────────

function generateSvgDataUri(
  agentName: string,
  level: string,
  alias?: EmailAliasMeta | null,
): string {
  const levelColors: Record<string, string> = {
    larva: '#71717a',
    pupa:  '#f59e0b',
    imago: '#a78bfa',
    ghost: '#e879f9',
  };
  const color = levelColors[level] ?? '#71717a';
  const label = alias ? `CHONK_${alias.tokenId}` : agentName;
  const sublabel = alias ? `${agentName}_@nftmail.box` : `${agentName}_@nftmail.box`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#0a0a0a"/>
  <rect x="1" y="1" width="398" height="398" rx="20" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.4"/>
  <circle cx="200" cy="140" r="60" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1" stroke-opacity="0.3"/>
  <text x="200" y="148" text-anchor="middle" font-family="monospace" font-size="48" fill="${color}" opacity="0.9">👻</text>
  <text x="200" y="230" text-anchor="middle" font-family="monospace" font-size="18" font-weight="bold" fill="#f2eee4">${label}</text>
  <text x="200" y="255" text-anchor="middle" font-family="monospace" font-size="10" fill="${color}" opacity="0.8">${sublabel}</text>
  <text x="200" y="280" text-anchor="middle" font-family="monospace" font-size="9" fill="#71717a">${level.toUpperCase()} · nftmail.box</text>
  ${alias ? `<text x="200" y="320" text-anchor="middle" font-family="monospace" font-size="9" fill="#e879f9" opacity="0.7">🦀 CHONK #${alias.tokenId} identity overlay</text>` : ''}
  <text x="200" y="380" text-anchor="middle" font-family="monospace" font-size="8" fill="#3f3f46">GhostAgent Beacon Metadata v1.0</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ─── IPFS Pinning via Lighthouse ──────────────────────────────────────────────

const LIGHTHOUSE_UPLOAD_URL = 'https://node.lighthouse.storage/api/v0/add';
const IPFS_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';

/**
 * Pin JSON metadata to IPFS via Lighthouse.
 * If LIGHTHOUSE_API_KEY is not set, uses the public unauthenticated endpoint
 * (works for small files, no persistence guarantee — use key for production).
 */
export async function pinToIPFS(
  metadata: BeaconMetadata,
  apiKey?: string,
): Promise<PinResult> {
  const json = JSON.stringify(metadata, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const form = new FormData();
  form.append('file', blob, 'beacon-metadata.json');

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(LIGHTHOUSE_UPLOAD_URL, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lighthouse pin failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { Hash?: string; Name?: string };
  const cid = data.Hash;
  if (!cid) {
    throw new Error(`Lighthouse response missing Hash: ${JSON.stringify(data)}`);
  }

  return {
    cid,
    url: `${IPFS_GATEWAY}/${cid}`,
    gateway: 'lighthouse.storage',
    pinnedAt: Date.now(),
  };
}

/**
 * Full pipeline: build metadata → pin → return CID + enriched metadata.
 */
export async function buildAndPin(
  params: BuildBeaconParams,
  lighthouseApiKey?: string,
): Promise<{ metadata: BeaconMetadata; pin: PinResult }> {
  const metadata = buildBeaconMetadata(params);
  const pin = await pinToIPFS(metadata, lighthouseApiKey);

  // Enrich with IPFS provenance
  metadata.pinned_at = pin.pinnedAt;
  metadata.ipfs_cid = pin.cid;

  return { metadata, pin };
}
