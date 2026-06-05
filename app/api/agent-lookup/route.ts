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
import { WORKER_URL } from '../../utils/config';
import { getAgentBySafe } from '../../services/envio';


// ── ERC-6551 TBA derivation ───────────────────────────────────────────────────
const ERC6551_REGISTRY    = '0x000000006551c19487814612e58FE06813775758';
const GNOSIS_RPC          = 'https://rpc.gnosischain.com';
const GNOSIS_CHAIN_ID     = 100;

// Shared ERC-6551 account implementation on Gnosis mainnet
// Same address used by all GNO registrars (MinimalERC6551Account from RedeployAll.s.sol)
const FALLBACK_ERC6551_IMPL = '0x878E703A93b6e0aaD92f9907332c68fb09765697';

// Known NFT token IDs for existing agents (fallback when KV lacks mintedTokenId)
const KNOWN_TOKEN_IDS: Record<string, { sld: string; tokenId: number }> = {
  ghostagent: { sld: 'molt',     tokenId: 2 },
  eyemine:    { sld: 'nftmail',  tokenId: 1 },
  victor:     { sld: 'openclaw', tokenId: 1 },
};

// Current registrar (NFT contract) addresses per SLD on Gnosis mainnet
const SLD_REGISTRARS: Record<string, string> = {
  nftmail:  '0x831ddd71e7c33e16b674099129e6e379da407faf',
  molt:     '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  openclaw: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  picoclaw: '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
  agent:    '0x73f2f2ef73dc512cac0f5b0372f1d58a84ed13e6', // GhostRegistry v1
};

// Old registrar versions — agents minted on these before redeployment
// The TBA is tied to the registrar at mint time, not the current one
const OLD_REGISTRARS: Record<string, string[]> = {
  molt:    ['0xd2c8d961e0bbb9c5324709c145f3dc8dd7615dcf'],
  nftmail: ['0x46c37365572c9994812aaa41fd04eb56d05469d0'],
};

/**
 * Read the ERC-6551 account implementation address from a registrar contract.
 * Each registrar stores its own impl address — no hardcoding needed.
 */
async function readRegistrarImpl(registrarAddress: string): Promise<string> {
  try {
    // erc6551AccountImplementation() selector
    const selector = '0x918372de';
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: registrarAddress, data: selector }, 'latest'],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json() as { result?: string };
    if (json.result && json.result !== '0x' && json.result.length >= 42) {
      const addr = '0x' + json.result.replace('0x', '').slice(-40);
      if (addr !== '0x0000000000000000000000000000000000000000') return addr;
    }
  } catch {}
  // All GNO registrars share the same MinimalERC6551Account impl
  return FALLBACK_ERC6551_IMPL;
}

/**
 * Derive TBA address deterministically from ERC-6551 v0.3 registry on Gnosis.
 * Calls registry.account(address impl, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId).
 * Reads the implementation address from the registrar contract on-chain.
 */
async function deriveTbaAddress(tokenId: number, tokenContract: string): Promise<string | null> {
  try {
    const impl = await readRegistrarImpl(tokenContract); // never returns null now

    // ERC-6551 v0.3: account(address,bytes32,uint256,address,uint256)
    const selector = '0x246a0021';
    const pad = (val: string, bytes = 32) => val.replace('0x', '').padStart(bytes * 2, '0');
    const data =
      selector +
      pad(impl) +                              // implementation address
      pad('0') +                               // salt (bytes32 zero)
      pad(GNOSIS_CHAIN_ID.toString(16)) +      // chainId = 100
      pad(tokenContract) +                     // tokenContract (registrar)
      pad(tokenId.toString(16));               // tokenId

    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: ERC6551_REGISTRY, data }, 'latest'],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json() as { result?: string };
    if (!json.result || json.result === '0x') return null;
    const hex = json.result.replace('0x', '');
    const addr = '0x' + hex.slice(-40);
    if (addr === '0x0000000000000000000000000000000000000000') return null;
    return addr;
  } catch {
    return null;
  }
}

/**
 * Try deriving TBA from current registrar first, then fall back to old registrar versions.
 * Agents minted on old registrars have TBAs bound to those contracts.
 */
async function deriveTbaWithFallback(tokenId: number, currentRegistrar: string, sld: string): Promise<string | null> {
  // Try current registrar first
  const tba = await deriveTbaAddress(tokenId, currentRegistrar);
  if (tba) {
    // Verify it's actually deployed (has code)
    try {
      const codeRes = await fetch(GNOSIS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getCode', params: [tba, 'latest'] }),
        signal: AbortSignal.timeout(3000),
      });
      const codeJson = await codeRes.json() as { result?: string };
      if (codeJson.result && codeJson.result !== '0x') return tba;
    } catch {}
  }

  // Try old registrar versions for this SLD
  const oldAddrs = OLD_REGISTRARS[sld] || [];
  for (const oldAddr of oldAddrs) {
    const oldTba = await deriveTbaAddress(tokenId, oldAddr);
    if (oldTba) {
      try {
        const codeRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_getCode', params: [oldTba, 'latest'] }),
          signal: AbortSignal.timeout(3000),
        });
        const codeJson = await codeRes.json() as { result?: string };
        if (codeJson.result && codeJson.result !== '0x') return oldTba;
      } catch {}
    }
  }

  // Return the computed address even if not deployed (deterministic, can be deployed later)
  return tba;
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

  // Canonical GNS name (e.g. ghostagent.agent.gno for native, atom-158.agent.gno for BYO)
  gnsName: string | null;

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

// Detect if input uses BYO dot format (e.g., chonk.697) vs native format (ghostagent_)
function isByoDotFormat(q: string): boolean {
  const withoutDomain = q.replace(/@nftmail\.box$/i, '').trim().toLowerCase();
  const withoutTld = withoutDomain.replace(/\.(agent|molt|nftmail|openclaw|picoclaw|vault)\.gno$/i, '');
  return withoutTld.includes('.') && /^(chonk|atom|normie|mooncat)\./.test(withoutTld);
}

// Check if normalized name is a BYO agent (e.g., chonk-697, atom-1234)
function isByoName(name: string): boolean {
  return /^(chonk|atom|normie|mooncat)-/.test(name);
}

function normaliseQuery(q: string): { name: string; isAgent: boolean } {
  // Strip @nftmail.box suffix if present
  const withoutDomain = q.replace(/@nftmail\.box$/i, '').trim().toLowerCase();
  // Strip TLD suffixes (.agent.gno, .molt.gno, .nftmail.gno, .openclaw.gno, .picoclaw.gno, .vault.gno)
  const withoutTld = withoutDomain.replace(/\.(agent|molt|nftmail|openclaw|picoclaw|vault)\.gno$/i, '');
  // Convert dots to hyphens to match KV storage format (chonk.676 → chonk-676)
  const normalized = withoutTld.replace(/\./g, '-');
  // Strip trailing underscore to get base name
  const isAgent = normalized.endsWith('_');
  const name = isAgent ? normalized.slice(0, -1) : normalized;
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
      signal: AbortSignal.timeout(6000),
    });

    if (!resolveRes.ok) {
      return NextResponse.json({ error: `Worker error: ${resolveRes.status}` }, { status: 502 });
    }

    const resolved = await resolveRes.json() as any;

    // ── 2–4. Parallel: beacon CID + molt path + TBA derivation ───────────
    let beaconCid: string | null = null;
    let beaconMetadataUrl: string | null = null;
    let moltPath: AgentIdentityGraph['moltPath'] = null;
    let tbaAddress: string | null = resolved.tba ?? null; // prefer KV-stored TBA

    if (resolved.exists) {
      // Try Envio first for TBA lookup (indexed data, no RPC)
      if (tbaAddress === null && resolved.safe) {
        try {
          const envioData = await getAgentBySafe(resolved.safe);
          if (envioData?.ghostAgent?.tba) {
            tbaAddress = envioData.ghostAgent.tba;
          }
        } catch { /* non-fatal, fall back to RPC */ }
      }

      // mintedTokenId from KV; fall back to KNOWN_TOKEN_IDS for pre-seeded agents
      let mintedTokenId: number | null = resolved.mintedTokenId ?? null;
      if (mintedTokenId === null && KNOWN_TOKEN_IDS[name]) {
        mintedTokenId = KNOWN_TOKEN_IDS[name].tokenId;
      }

      const needsTbaDerivation = tbaAddress === null && mintedTokenId !== null;

      const [beaconResult, moltResult, tbaResult, tbaKvResult] = await Promise.allSettled([
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

        // TBA derivation — read impl from registrar on-chain, try old registrars if needed
        needsTbaDerivation ? (() => {
          const sld = (resolved.tld as string | undefined)?.split('.')?.[0] ?? 'nftmail';
          const registrar = SLD_REGISTRARS[sld] ?? SLD_REGISTRARS['nftmail'];
          return deriveTbaWithFallback(mintedTokenId!, registrar, sld);
        })() : Promise.resolve(null),

        // BYO mirror TBA — stored in tba:{name} KV by byo-molt for Gnosis mirror TBA
        tbaAddress === null ? fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kvGet', key: `tba:${name}` }),
          signal: AbortSignal.timeout(3000),
        }).then(r => r.json()).catch(() => null) : Promise.resolve(null),
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

      if (tbaResult.status === 'fulfilled' && tbaResult.value !== null) {
        tbaAddress = tbaResult.value as string | null;
      }

      // BYO mirror TBA fallback — use tba:{name} KV if still not found
      if (tbaAddress === null && tbaKvResult.status === 'fulfilled' && tbaKvResult.value) {
        try {
          const kvVal = (tbaKvResult.value as any)?.value;
          if (kvVal) {
            const parsed = JSON.parse(kvVal) as { tbaAddress?: string };
            if (parsed.tbaAddress) tbaAddress = parsed.tbaAddress;
          }
        } catch { /* non-fatal */ }
      }
    }

    // ── 5. Assemble identity graph ────────────────────────────────────────
    const graph: AgentIdentityGraph = {
      inputQuery: q,
      resolvedName: name,
      emailAddress: (isByoDotFormat(q) || isByoName(name)) ? `${name.replace(/-/g, '.')}_@nftmail.box` : `${name}_@nftmail.box`,

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
      // BYO dot-format agents: GNS name is the beacon NFT (e.g. atom-158.agent.gno)
      // Native agents: name.tld (e.g. ghostagent.agent.gno)
      gnsName: name.includes('.')
        ? (resolved.originNft ?? null)
        : (resolved.tld ? `${name}.${resolved.tld}` : null),
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
