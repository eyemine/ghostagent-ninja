/**
 * GET /api/agent-lookup?q=ghostagent_@nftmail.box
 *   or ?q=ghostagent_
 *   or ?q=ghostagent
 *
 * Public reverse-lookup: given any email address or agent name,
 * returns the full on-chain identity graph:
 *   - originNft       (e.g. ghostagent.nftmail.gno)
 *   - onChainOwner    (EOA / Privy wallet that controls the NFT)
 *   - tbaAddress      (ERC-6551 wallet bound to the NFT — from ecies-pubkey key)
 *   - safe            (Gnosis Safe address if deployed)
 *   - storyIp         (Story Protocol IP asset domain)
 *   - accountTier     (basic / lite / premium / ghost)
 *   - tld             (agent.gno / nftmail.gno / etc.)
 *   - beaconCid       (IPFS metadata CID if pinned)
 *   - moltPath        (xDAI burned, surge score, evolution history length)
 *
 * Pulls from worker KV via resolveAddress action (no secret needed — public).
 * Does NOT expose ECIES keys, blind-index contents, or private message data.
 */

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

// ── ERC-6551 TBA derivation ───────────────────────────────────────────────────
// Standard ERC-6551 registry (same address on all EVM chains)
const ERC6551_REGISTRY = '0x000000006551c19487814612e58FE06813775758';
// nftmail.gno registrar (NFT contract) on Gnosis
const NFTMAIL_GNO_REGISTRAR = '0x831ddd71e7c33e16b674099129e6e379da407faf';
// Default TBA implementation (ERC-6551 reference impl, deployed on Gnosis)
const TBA_IMPLEMENTATION  = '0x55266d75D1a14E4572138116aF39863Ed6596E7F';
// Default salt used in mintSubname (all zeros)
const TBA_SALT = '0x0000000000000000000000000000000000000000000000000000000000000000';
const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const GNOSIS_CHAIN_ID = 100;

/**
 * Derive TBA address deterministically from ERC-6551 registry on Gnosis.
 * Calls registry.account(implementation, chainId, tokenContract, tokenId, salt).
 */
async function deriveTbaAddress(tokenId: number): Promise<string | null> {
  try {
    // ABI-encode: account(address impl, uint256 chainId, address tokenContract, uint256 tokenId, uint256 salt)
    // selector: keccak256("account(address,uint256,address,uint256,uint256)")[0:4]
    const selector = '0x246a0069'; // precomputed selector for account()
    const pad = (val: string, bytes = 32) => val.replace('0x', '').padStart(bytes * 2, '0');
    const data =
      selector +
      pad(TBA_IMPLEMENTATION) +               // impl address (padded to 32 bytes)
      pad(GNOSIS_CHAIN_ID.toString(16)) +      // chainId = 100
      pad(NFTMAIL_GNO_REGISTRAR) +             // tokenContract
      pad(tokenId.toString(16)) +              // tokenId
      pad('0');                                // salt = 0

    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: ERC6551_REGISTRY, data }, 'latest'],
      }),
    });
    const json = await res.json() as { result?: string };
    if (!json.result || json.result === '0x') return null;
    // Result is ABI-encoded address (32 bytes) — take last 20 bytes
    const hex = json.result.replace('0x', '');
    const addr = '0x' + hex.slice(-40);
    // Sanity check: non-zero address
    if (addr === '0x0000000000000000000000000000000000000000') return null;
    return addr;
  } catch {
    return null;
  }
}

export interface AgentIdentityGraph {
  // Input normalisation
  inputQuery: string;
  resolvedName: string;           // stripped local-part e.g. "ghostagent"
  emailAddress: string;           // canonical e.g. "ghostagent_@nftmail.box"

  // Existence
  exists: boolean;
  stream: 'agent' | 'sovereign' | 'unknown';

  // On-chain NFT identity
  originNft: string | null;       // e.g. "ghostagent.nftmail.gno"
  mintedTokenId: number | null;
  onChainOwner: string | null;    // EOA wallet address

  // Smart account layer
  tbaAddress: string | null;      // ERC-6551 TBA (derived from ecies key registration)
  safe: string | null;            // Gnosis Safe address
  storyIp: string | null;         // Story Protocol IP domain

  // Tier / capability
  accountTier: string;
  tld: string | null;
  isPublic: boolean;
  canSend: boolean;
  expiresAt: number | null;
  privacyTier: 'exposed' | 'private' | 'hard-privacy';

  // IPFS beacon
  beaconCid: string | null;
  beaconMetadataUrl: string | null;

  // Molt path summary
  moltPath: {
    currentLevel: string | null;
    totalXdaiBurned: number | null;
    surgeReputationScore: number | null;
    evolutionHistoryLength: number | null;
  } | null;

  // Collection overlay (for chonk.123_ style agents)
  collection?: string;
  collectionName?: string;
  tokenId?: string;

  // Availability (if not exists)
  availability?: {
    status: string;
    message: string;
    type?: string;
  };
}

function normaliseQuery(q: string): { name: string; isAgent: boolean } {
  // Strip @nftmail.box suffix if present
  const withoutDomain = q.replace(/@nftmail\.box$/i, '').trim().toLowerCase();
  // Strip trailing underscore to get base name
  const isAgent = withoutDomain.endsWith('_');
  const name = isAgent ? withoutDomain.slice(0, -1) : withoutDomain;
  return { name, isAgent };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';

  if (!q || q.trim().length < 1) {
    return NextResponse.json({ error: 'Missing q parameter (e.g. ?q=ghostagent_)' }, { status: 400 });
  }

  const { name, isAgent } = normaliseQuery(q);

  if (!name) {
    return NextResponse.json({ error: 'Empty name after normalisation' }, { status: 400 });
  }

  // Always resolve as agent_ first (the underscore suffix path)
  const lookupName = `${name}_`;

  try {
    // ── 1. resolveAddress from worker ─────────────────────────────────────
    const resolveRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: lookupName }),
    });

    const resolved = await resolveRes.json() as any;

    // ── 2–4. Parallel: beacon CID + molt path + TBA derivation ───────────
    let beaconCid: string | null = null;
    let beaconMetadataUrl: string | null = null;
    let moltPath: AgentIdentityGraph['moltPath'] = null;
    let tbaAddress: string | null = null;

    if (resolved.exists) {
      const mintedTokenId: number | null = resolved.mintedTokenId ?? null;

      const [beaconResult, moltResult, tbaResult] = await Promise.allSettled([
        // Beacon
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getBeacon', name }),
        }).then(r => r.json()),

        // Molt path
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getMoltPath', name }),
        }).then(r => r.json()),

        // TBA derivation — only possible if we have a tokenId
        mintedTokenId != null ? deriveTbaAddress(mintedTokenId) : Promise.resolve(null),
      ]);

      if (beaconResult.status === 'fulfilled') {
        const bd = beaconResult.value as any;
        if (bd?.exists) { beaconCid = bd.cid ?? null; beaconMetadataUrl = bd.metadataUrl ?? null; }
      }

      if (moltResult.status === 'fulfilled') {
        const md = moltResult.value as any;
        if (md?.exists && md?.record) {
          const r = md.record;
          moltPath = {
            currentLevel: r.currentLevel ?? null,
            totalXdaiBurned: r.totalXdaiBurned ?? null,
            surgeReputationScore: r.surgeReputationScore ?? null,
            evolutionHistoryLength: r.evolutionHistory?.length ?? null,
          };
        }
      }

      if (tbaResult.status === 'fulfilled') {
        tbaAddress = tbaResult.value as string | null;
      }
    }

    // ── 5. Assemble identity graph ────────────────────────────────────────
    const graph: AgentIdentityGraph = {
      inputQuery: q,
      resolvedName: name,
      emailAddress: `${name}_@nftmail.box`,

      exists: resolved.exists ?? false,
      stream: resolved.stream ?? 'agent',

      originNft: resolved.originNft ?? null,
      mintedTokenId: resolved.mintedTokenId ?? null,
      onChainOwner: resolved.onChainOwner ?? null,

      tbaAddress,
      safe: resolved.safe ?? null,
      storyIp: resolved.storyIp ?? null,

      accountTier: resolved.accountTier ?? 'basic',
      tld: resolved.tld ?? null,
      isPublic: resolved.isPublic ?? false,
      canSend: resolved.canSend ?? false,
      expiresAt: resolved.expiresAt ?? null,
      privacyTier: resolved.privacyTier ?? 'exposed',

      beaconCid,
      beaconMetadataUrl,
      moltPath,

      ...(resolved.collection ? {
        collection: resolved.collection,
        collectionName: resolved.collectionName,
        tokenId: resolved.tokenId,
      } : {}),

      ...(resolved.availability ? { availability: resolved.availability } : {}),
    };

    return NextResponse.json(graph);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Lookup failed' }, { status: 500 });
  }
}
