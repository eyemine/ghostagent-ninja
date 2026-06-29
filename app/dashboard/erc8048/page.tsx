'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { fetchSovereignSidecarMatrix, fetchTokenIdsForWallet } from '../../services/envio';
import { encodeStringValue, decodeStringValue, KNOWN_KEYS, MANDATE_OPTIONS, getSubCapFromMandate, CURSOR_CONTRACT, CURSOR_CHIADO_RPC, CURSOR_ISSUER, CURSOR_ABI, REGISTRY_ABI } from '../../services/erc8048-publisher';
import type { TokenSidecarState } from '../../types/indexer';

const REGISTRY = process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE';
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? '';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// ── Verified legacy NFT collections eligible for ERC-8048 sidecars ──────────
const VERIFIED_COLLECTIONS: Record<string, {
  label: string;
  contract: `0x${string}`;
  chain: 'base' | 'ethereum' | 'gnosis';
  pattern: RegExp;
  imageUrl: (tokenId: string) => string;
}> = {
  chonk: {
    label: 'Base Chonk',
    contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9',
    chain: 'base',
    pattern: /^chonk[._](\d+)/i,
    imageUrl: (id) => `https://api.chonks.carbonlocks.xyz/images/${id}.png`,
  },
  pownft: {
    label: 'POW NFT',
    contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b',
    chain: 'ethereum',
    pattern: /^atom[._](\d+)/i,
    imageUrl: (id) => `/api/nft-preview?type=pownft&tokenId=${id}`,
  },
  normie: {
    label: 'Normie',
    contract: '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB',
    chain: 'base',
    // Matches both old-style normie.123 and new-style shadow-trader.normie (slug.normie)
    pattern: /(?:^normie[._](\d+)|[._]normie$)/i,
    imageUrl: (id) => `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB&tokenId=${id}`,
  },
  mooncat: {
    label: 'MoonCat',
    contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69',
    chain: 'ethereum',
    pattern: /^mooncat[._](\d+)/i,
    imageUrl: (id) => `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=0xc3f733ca98e0dad0386979eb96fb1722a1a05e69&tokenId=${id}`,
  },
  dxterminal: {
    label: 'DX Terminal',
    contract: '0x41dc69132cce31fcbf6755c84538ca268520246f',
    chain: 'base',
    pattern: /^dxterm[._](\d+)/i,
    imageUrl: (id) => `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=0x41dc69132cce31fcbf6755c84538ca268520246f&tokenId=${id}`,
  },
  fakenormie: {
    label: 'FakeNormie',
    contract: '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29',
    chain: 'gnosis',
    pattern: /^__never__$/,
    imageUrl: (id) => `/FakeNormies/SVGS/${String(parseInt(id)).padStart(2, '0')}.svg`,
  },
};

type VerifiedCollectionKey = keyof typeof VERIFIED_COLLECTIONS;

function detectPairedNft(agentName: string): { key: VerifiedCollectionKey; tokenId: string; collection: typeof VERIFIED_COLLECTIONS[VerifiedCollectionKey] } | null {
  const n = agentName.toLowerCase();
  for (const [key, col] of Object.entries(VERIFIED_COLLECTIONS)) {
    const m = n.match(col.pattern);
    if (m) return { key: key as VerifiedCollectionKey, tokenId: m[1], collection: col };
  }
  return null;
}

async function fetchNftImage(key: VerifiedCollectionKey, tokenId: string): Promise<string | null> {
  try {
    if (key === 'pownft') {
      const r = await fetch(`/api/nft-preview?type=pownft&tokenId=${tokenId}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json() as { imageUrl?: string | null };
      return d.imageUrl ?? null;
    }
    if (key === 'chonk' && ALCHEMY_KEY) {
      const r = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=${VERIFIED_COLLECTIONS.chonk.contract}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as { image?: { cachedUrl?: string; pngUrl?: string; thumbnailUrl?: string; contentType?: string } };
      const isVideo = d?.image?.contentType?.startsWith('video/');
      return isVideo ? (d?.image?.pngUrl ?? d?.image?.thumbnailUrl ?? null) : (d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null);
    }
    if ((key === 'normie') && ALCHEMY_KEY) {
      const r = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=${VERIFIED_COLLECTIONS.normie.contract}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as { image?: { cachedUrl?: string; pngUrl?: string } };
      return d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null;
    }
    if (key === 'mooncat' && ALCHEMY_KEY) {
      const r = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=${VERIFIED_COLLECTIONS.mooncat.contract}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as { image?: { cachedUrl?: string; pngUrl?: string } };
      return d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null;
    }
    if (key === 'dxterminal' && ALCHEMY_KEY) {
      const r = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTMetadata?contractAddress=${VERIFIED_COLLECTIONS.dxterminal.contract}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as { image?: { cachedUrl?: string; pngUrl?: string; contentType?: string } };
      return d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null;
    }
    if (key === 'fakenormie') {
      return `/FakeNormies/SVGS/${String(parseInt(tokenId)).padStart(2, '0')}.svg`;
    }
  } catch { /* fall through */ }
  return null;
}

function short(v: string, l = 10, r = 6) {
  return v.length <= l + r + 3 ? v : `${v.slice(0, l)}...${v.slice(-r)}`;
}

export default function Erc8048Dashboard() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  const agentParam      = searchParams.get('agent')      ?? '';
  const collectionParam = searchParams.get('collection') ?? '';
  const tokenIdParam    = searchParams.get('tokenId')    ?? '';

  const pairedNft = useMemo(() => {
    // Agent name pattern takes priority (e.g. chonk.9534 → Chonk collection)
    const detected = detectPairedNft(agentParam);
    if (detected) return detected;
    // Fall back to explicit collection param (e.g. ENS agents with ?collection=fakenormie)
    if (collectionParam && VERIFIED_COLLECTIONS[collectionParam]) {
      return { key: collectionParam as VerifiedCollectionKey, tokenId: tokenIdParam, collection: VERIFIED_COLLECTIONS[collectionParam] };
    }
    return null;
  }, [agentParam, collectionParam, tokenIdParam]);

  const [nftImage, setNftImage] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string>(agentParam);

  const [sidecars, setSidecars] = useState<TokenSidecarState[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tokenIdInput, setTokenIdInput] = useState(pairedNft?.tokenId ?? '');
  const [metaKey, setMetaKey] = useState<string>(KNOWN_KEYS[0].key);
  const [metaValue, setMetaValue] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [cursorMandate, setCursorMandate] = useState<string>('');
  const [pendingMandate, setPendingMandate] = useState<string>('worker');
  const [leafSpent, setLeafSpent] = useState<bigint | null>(null);
  const [cursorRegistered, setCursorRegistered] = useState(false);
  const [loadingCursor, setLoadingCursor] = useState(false);
  const [applyingCeiling, setApplyingCeiling] = useState(false);
  const [ceilingStatus, setCeilingStatus] = useState<string | null>(null);
  const [ceilingError, setCeilingError] = useState<string | null>(null);

  const userAddress = useMemo(() => wallets[0]?.address ?? '', [wallets]);

  const loadCursorState = useCallback(async () => {
    if (!pairedNft || !tokenIdInput) return;
    setLoadingCursor(true);
    try {
      const { createPublicClient, http, keccak256 } = await import('viem');
      const { gnosis } = await import('viem/chains');
      const chiado = {
        id: 10200, name: 'Gnosis Chiado',
        nativeCurrency: { name: 'Chiado xDAI', symbol: 'xDAI', decimals: 18 },
        rpcUrls: { default: { http: [CURSOR_CHIADO_RPC] } },
      } as const;
      const gnosisClient = createPublicClient({ chain: gnosis, transport: http() });
      const chiadoClient = createPublicClient({ chain: chiado, transport: http(CURSOR_CHIADO_RPC) });
      const mandateBytes = await gnosisClient.readContract({
        address: REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: 'metadata',
        args: [BigInt(tokenIdInput), 'cursor[mandate]'],
      }).catch(() => '0x' as `0x${string}`);
      const mandate = mandateBytes && mandateBytes !== '0x' ? decodeStringValue(mandateBytes as string) : '';
      setCursorMandate(mandate);
      if (mandate) setPendingMandate(mandate);
      const scopeKey = `erc8048:${pairedNft.key}:${tokenIdInput}`;
      const scopeBytes = new TextEncoder().encode(scopeKey);
      const cursorScopeId = keccak256(scopeBytes) as `0x${string}`;
      const [capRoot, spent] = await Promise.all([
        chiadoClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'capabilityRoot', args: [cursorScopeId] }).catch(() => '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
        chiadoClient.readContract({ address: CURSOR_CONTRACT, abi: CURSOR_ABI, functionName: 'leafSpent',      args: [cursorScopeId] }).catch(() => 0n),
      ]);
      const nullRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';
      setCursorRegistered(capRoot !== nullRoot);
      setLeafSpent(spent as bigint);
    } catch { /* non-fatal */ } finally {
      setLoadingCursor(false);
    }
  }, [pairedNft, tokenIdInput]);

  useEffect(() => {
    if (!authenticated || !tokenIdInput || !pairedNft) return;
    void loadCursorState();
  }, [authenticated, tokenIdInput, pairedNft, loadCursorState]);

  async function handleApplyCeiling() {
    if (!pairedNft || !tokenIdInput) return;
    setApplyingCeiling(true);
    setCeilingStatus(null);
    setCeilingError(null);
    try {
      const { createWalletClient, createPublicClient, custom, keccak256, encodeAbiParameters, http } = await import('viem');
      const chiado = {
        id: 10200, name: 'Gnosis Chiado',
        nativeCurrency: { name: 'Chiado xDAI', symbol: 'xDAI', decimals: 18 },
        rpcUrls: { default: { http: [CURSOR_CHIADO_RPC] } },
      } as const;
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error('No wallet provider');
      const walletClient = createWalletClient({ chain: chiado, transport: custom(provider as Parameters<typeof custom>[0]) });
      await walletClient.addChain({ chain: chiado }).catch(() => null);
      await walletClient.switchChain({ id: 10200 });
      const [account] = await walletClient.requestAddresses();
      const subCap = getSubCapFromMandate(pendingMandate);
      const leafScopeId = keccak256(new TextEncoder().encode('default')) as `0x${string}`;
      const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const leafEncoded = encodeAbiParameters(
        [{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'}],
        [leafScopeId, subCap, ZERO_ADDR, CURSOR_ISSUER],
      );
      const capRoot = keccak256(leafEncoded) as `0x${string}`;
      const scopeKey = `erc8048:${pairedNft.key}:${tokenIdInput}`;
      const cursorScopeId = keccak256(new TextEncoder().encode(scopeKey)) as `0x${string}`;
      const txHash = await walletClient.writeContract({
        address: CURSOR_CONTRACT, abi: CURSOR_ABI,
        functionName: 'register', args: [cursorScopeId, capRoot],
        account, chain: chiado,
      });
      setCeilingStatus(`Registered: ${txHash}`);
      const pubClient = createPublicClient({ chain: chiado, transport: http(CURSOR_CHIADO_RPC) });
      await pubClient.waitForTransactionReceipt({ hash: txHash });
      void loadCursorState();
    } catch (err) {
      setCeilingError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setApplyingCeiling(false);
    }
  }

  // Resolve display name from worker
  useEffect(() => {
    if (!agentParam) return;
    fetch(`/api/agent-lookup?q=${agentParam}`)
      .then(r => r.json() as Promise<{ name?: string }>)
      .then(d => { if (d.name) setAgentName(d.name); })
      .catch(() => null);
  }, [agentParam]);

  // Load NFT image — for fakenormie use tokenIdInput (URL param may be empty)
  useEffect(() => {
    if (!pairedNft) return;
    const id = pairedNft.key === 'fakenormie' ? tokenIdInput : pairedNft.tokenId;
    if (!id && id !== '0') return;
    fetchNftImage(pairedNft.key, id).then(img => setNftImage(img));
  }, [pairedNft, tokenIdInput]);

  const loadMatrix = useCallback(async () => {
    if (!pairedNft || !userAddress) return;
    setLoading(true);
    setLoadError(null);
    try {
      const contract = pairedNft.collection.contract;
      const rpc = pairedNft.collection.chain === 'gnosis'
        ? 'https://rpc.gnosischain.com'
        : pairedNft.collection.chain === 'base'
        ? 'https://mainnet.base.org'
        : 'https://eth.llamarpc.com';
      let ids: number[];
      if (pairedNft.key === 'fakenormie') {
        // FakeNormies is ERC721 (not Enumerable) — check ownerOf for known token IDs 0-6
        const FAKENORMIE_IDS = [0, 1, 2, 3, 4, 5, 6];
        const checks = await Promise.allSettled(FAKENORMIE_IDS.map(async (id) => {
          const padded = id.toString(16).padStart(64, '0');
          const res = await fetch(rpc, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x6352211e' + padded }, 'latest'] }),
          });
          const data = await res.json() as { result?: string };
          if (!data.result || data.result === '0x') return null;
          const owner = ('0x' + data.result.slice(26)).toLowerCase();
          return owner === userAddress.toLowerCase() ? id : null;
        }));
        const ownedIds = checks
          .map(r => r.status === 'fulfilled' ? r.value : null)
          .filter((v): v is number => v !== null);
        // If none found (e.g. Safe-owned), show all tokens so user can browse + select
        ids = ownedIds.length > 0 ? ownedIds : FAKENORMIE_IDS;
      } else {
        ids = await fetchTokenIdsForWallet(userAddress, contract, rpc);
      }
      if (ids.length === 0) {
        setSidecars([]);
      } else {
        const matrix = await fetchSovereignSidecarMatrix(contract, ids, pairedNft.key);
        setSidecars(matrix);
        // Auto-select first token (owned first, or first in list)
        if (ids.length > 0) setTokenIdInput(prev => prev || String(ids[0]));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load sidecar matrix');
    } finally {
      setLoading(false);
    }
  }, [userAddress, pairedNft]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void loadMatrix();
  }, [ready, authenticated, loadMatrix]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenIdInput || !metaKey || !metaValue) return;
    setPublishing(true);
    setPublishStatus(null);
    setPublishError(null);
    try {
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error('No wallet provider found');
      const { createWalletClient, custom, encodeFunctionData } = await import('viem');
      const { gnosis } = await import('viem/chains');
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [account] = await walletClient.requestAddresses();
      const data = encodeFunctionData({
        abi: [{
          name: 'setMetadata',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'key', type: 'string' }, { name: 'value', type: 'bytes' }],
          outputs: [],
        }] as const,
        functionName: 'setMetadata',
        args: [BigInt(tokenIdInput), metaKey, encodeStringValue(metaValue) as `0x${string}`],
      });
      const txHash = await walletClient.sendTransaction({ account, to: REGISTRY as `0x${string}`, data, chain: gnosis });
      setPublishStatus(`Broadcast: ${txHash}`);
      void loadMatrix();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setPublishing(false);
    }
  }

  if (!ready) return null;

  // ── Gate: only paired legacy NFT agents may use this page ────────────────
  if (agentParam && !pairedNft) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white lg:p-8">
        <Link href={`/dashboard/agent/${agentParam}`} className="text-xs text-slate-500 transition hover:text-slate-300">← {agentParam}</Link>
        <div className="mt-8 max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
          <div className="mb-3 text-base font-bold text-amber-300">ERC-8048 Sidecars: Paired NFTs Only</div>
          <p className="text-sm leading-relaxed text-amber-100/80">
            ERC-8048 sidecars are exclusively available for verified legacy NFT collections paired to a GhostAgent.
            Platform-native agents use native contract storage — no sidecar required.
          </p>
          <div className="mt-4 border-t border-amber-500/20 pt-4">
            <div className="mb-2 font-mono text-xs text-slate-400">Verified collections:</div>
            <div className="flex flex-wrap gap-2">
              {Object.values(VERIFIED_COLLECTIONS).map(c => (
                <span key={c.label} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">{c.label}</span>
              ))}
            </div>
          </div>
          <Link href="/pair-nft" className="mt-5 inline-block rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500">
            Pair a Legacy NFT →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white lg:p-8">

      {/* ── Agent Sidecar Header ── */}
      <div className="mb-6">
        <Link href={agentParam ? `/dashboard/agent/${agentParam}` : '/dashboard'} className="text-xs text-slate-500 transition hover:text-slate-300">
          ← {agentParam || 'Dashboard'}
        </Link>
        <div className="mt-4 flex items-center gap-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-700 bg-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={nftImage ?? '/ghost-logo.png'}
              alt={pairedNft ? `${pairedNft.collection.label} #${pairedNft.tokenId}` : agentName}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight">{agentName || agentParam}</h1>
              {pairedNft && (
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-xs text-cyan-400">
                  {pairedNft.collection.label} #{pairedNft.tokenId}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-slate-400">Agent Sidecar · ERC-8048 Metadata Registry</p>
            <p className="mt-0.5 font-mono text-xs text-slate-600">{short(REGISTRY)}</p>
          </div>
        </div>
      </div>

      {/* ── Awakening Required banner (Normies without ERC-8004 name) ── */}
      {pairedNft?.key === 'normie' && /^\d+\.normie$/i.test(agentParam) && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/8 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base">⚡</span>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-amber-300">Awakening Required for Named Identity</p>
              <p className="text-xs leading-relaxed text-amber-100/70">
                This Normie is using a token-ID fallback handle (<span className="font-mono text-amber-200">{agentParam}</span>).
                To claim a named identity like <span className="font-mono text-amber-200">shadow-trader.normie@nftmail.box</span>,
                the NFT must first be Awakened — i.e. publish an <strong className="text-amber-200">ERC-8004 Agent Card</strong> with a custom name field.
              </p>
              <p className="text-xs text-amber-100/50">
                Once Awakened, pair your Normie again on the Pair NFT page to lock in the canonical handle. The sidecar below can still be enrolled now — it will be migrated automatically on Awakening.
              </p>
              <a href="/pair-nft" className="mt-1 inline-block rounded border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25">
                Pair with Named Identity →
              </a>
            </div>
          </div>
        </div>
      )}

      {pairedNft && authenticated && (
        <div className="mb-6 rounded-xl border border-violet-500/30 bg-violet-500/8 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-mono text-sm font-bold text-violet-300">ERC-8312 Spending Mandate</h2>
              <p className="mt-0.5 font-mono text-xs text-slate-500">On-chain session ceiling · Chiado testnet</p>
            </div>
            <button onClick={() => void loadCursorState()} disabled={loadingCursor} className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-50">
              {loadingCursor ? 'Reading...' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Current state */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs">
              <div className="mb-3 text-slate-400">Current cursor state</div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-slate-500">Mandate:</span>
                {cursorMandate
                  ? <span className="rounded bg-violet-900/60 px-2 py-0.5 text-violet-300">{MANDATE_OPTIONS.find(m => m.value === cursorMandate)?.label ?? cursorMandate}</span>
                  : <span className="text-slate-600">Not declared</span>}
              </div>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-slate-500">Leaf:</span>
                {cursorRegistered
                  ? <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-400">registered</span>
                  : <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-500">unregistered</span>}
              </div>
              {cursorRegistered && leafSpent !== null && cursorMandate && (() => {
                const subCap = getSubCapFromMandate(cursorMandate);
                const pct = subCap > 0n ? Number((leafSpent * 10000n) / subCap) / 100 : 0;
                const spentEth = (Number(leafSpent) / 1e18).toFixed(6);
                const capEth   = (Number(subCap)    / 1e18).toFixed(3);
                return (
                  <div>
                    <div className="mb-1 flex justify-between text-slate-400">
                      <span>{spentEth} xDAI spent</span>
                      <span>{capEth} xDAI ceiling</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div className="mt-1 text-right text-slate-600">{pct.toFixed(1)}% consumed</div>
                  </div>
                );
              })()}
            </div>

            {/* Apply new ceiling */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs">
              <div className="mb-3 text-slate-400">Register new ceiling on Chiado</div>
              <div className="mb-3">
                <label className="mb-1 block text-slate-500">Select mandate</label>
                <select
                  value={pendingMandate}
                  onChange={e => setPendingMandate(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-violet-500"
                >
                  {MANDATE_OPTIONS.map(m => (
                    <option key={m.value} value={m.value}>{m.label} — {m.subCapLabel}</option>
                  ))}
                </select>
              </div>
              <div className="mb-3 border-t border-slate-800 pt-3 text-slate-600">
                <div>Contract: <span className="text-slate-500">{CURSOR_CONTRACT.slice(0,10)}…</span></div>
                <div>Chain: <span className="text-slate-500">Chiado (10200)</span></div>
                <div className="mt-1 text-amber-600/80">Registers immutable leaf — wallet switches to Chiado</div>
              </div>
              <button
                onClick={() => void handleApplyCeiling()}
                disabled={applyingCeiling}
                className="w-full rounded bg-violet-700 py-2 font-bold text-white transition hover:bg-violet-600 disabled:opacity-50"
              >
                {applyingCeiling ? 'Registering...' : 'Apply Ceiling'}
              </button>
              {ceilingStatus && <div className="mt-3 break-all rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">{ceilingStatus}</div>}
              {ceilingError  && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{ceilingError}</div>}
            </div>
          </div>

          <div className="mt-3 border-t border-slate-800 pt-3 font-mono text-xs text-slate-600">
            To declare your mandate on-chain: use the Sidecar Registry Toolkit above to commit <span className="text-slate-500">cursor[mandate]</span>, then click Apply Ceiling to register the immutable spending leaf.
          </div>
        </div>
      )}

      {!authenticated ? (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-6">
          <p className="text-sm text-indigo-100">Connect your wallet to inspect sidecar state and publish metadata keys.</p>
          <button onClick={login} className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* ── Left: Sidecar Matrix Viewer ── */}
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-slate-500">Indexed Sidecar State</h2>
              <button onClick={() => void loadMatrix()} disabled={loading} className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-50">
                {loading ? 'Scanning...' : 'Refresh'}
              </button>
            </div>

            {loadError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-xs text-red-300">{loadError}</div>
            )}

            {!loading && !loadError && sidecars.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-6 font-mono text-xs text-slate-500">
                No sidecar metadata indexed for your {pairedNft?.collection.label ?? 'NFT'} tokens yet.<br />
                <span className="text-slate-600">Use the toolkit to initialise a sidecar key on-chain.</span>
              </div>
            )}

            {sidecars.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {sidecars.map((sc) => (
                  <div key={sc.tokenId} onClick={() => setTokenIdInput(String(sc.tokenId))} className={`rounded-lg border bg-slate-900/50 p-4 font-mono text-xs cursor-pointer transition hover:border-indigo-500/50 ${String(sc.tokenId) === tokenIdInput ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-slate-800'}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-bold text-slate-200">{sc.name}</span>
                      {sc.hasSidecarState
                        ? <span className="rounded bg-emerald-900/60 px-2 py-0.5 text-emerald-400">indexed</span>
                        : <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-500">empty</span>}
                    </div>
                    <div className="space-y-1 text-slate-400">
                      {pairedNft?.key === 'fakenormie' ? (
                        <>
                          <div><span className="text-violet-400">cursor[mandate]:</span> {sc.cursorMandate ?? <span className="text-slate-600">None</span>}</div>
                          <div><span className="text-violet-400">cursor[agreement_hash]:</span> {sc.cursorAgreementHash ? short(sc.cursorAgreementHash) : <span className="text-slate-600">None</span>}</div>
                        </>
                      ) : (
                        <>
                          <div><span className="text-indigo-400">story[ip_id]:</span> {sc.storyIpId ? short(sc.storyIpId) : 'None'}</div>
                          <div><span className="text-indigo-400">story[license_id]:</span> {sc.storyLicenseId ?? 'None'}</div>
                          <div><span className="text-indigo-400">cdr[vault_id]:</span> {sc.cdrVaultId ?? 'None'}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Publish Toolkit + Explainer ── */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 font-mono text-xs">
              <h2 className="mb-4 border-b border-slate-800 pb-3 text-sm font-bold text-slate-200">Sidecar Registry Toolkit</h2>
              <form onSubmit={(e) => void handlePublish(e)} className="space-y-4">
                <div>
                  <label className="mb-1 block text-slate-400">Token ID</label>
                  <input
                    type="number"
                    value={tokenIdInput}
                    onChange={e => setTokenIdInput(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                    placeholder="e.g. 676"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">Metadata Key</label>
                  <select
                    value={metaKey}
                    onChange={e => setMetaKey(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                  >
                    {KNOWN_KEYS.map(k => (
                      <option key={k.key} value={k.key}>{k.key} — {k.label}</option>
                    ))}
                    <option value="story[ip_id]">story[ip_id] — Story IPA</option>
                    <option value="story[license_id]">story[license_id] — License</option>
                    <option value="cdr[vault_id]">cdr[vault_id] — Data Rail</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-slate-400">Value</label>
                  <input
                    type="text"
                    value={metaValue}
                    onChange={e => setMetaValue(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-indigo-500"
                    placeholder={KNOWN_KEYS.find(k => k.key === metaKey)?.hint ?? 'Enter value'}
                  />
                </div>
                <div className="border-t border-slate-800 pt-3 text-slate-500">
                  <div>Registry: <span className="text-slate-400">{short(REGISTRY)}</span></div>
                  <div>Chain: <span className="text-slate-400">Gnosis (100)</span></div>
                </div>
                <button
                  type="submit"
                  disabled={publishing || !tokenIdInput || !metaValue}
                  className="w-full rounded bg-indigo-600 py-2 font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  {publishing ? 'Broadcasting...' : 'Commit Sidecar Key'}
                </button>
              </form>

              {publishStatus && (
                <div className="mt-3 break-all rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">{publishStatus}</div>
              )}
              {publishError && (
                <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{publishError}</div>
              )}
            </div>

            {/* ── Explainer Panel ── */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 font-mono text-xs text-slate-400">
              <div className="mb-3 font-bold text-slate-200 text-sm">What is an Agent Sidecar?</div>
              <p className="leading-relaxed mb-3">
                Legacy NFTs have immutable bytecode — their metadata engines are permanently fixed at mint time. An ERC-8048 sidecar retrofits any verified NFT with a live, evolving on-chain metadata layer <span className="text-slate-300">without touching the original contract.</span>
              </p>
              <div className="space-y-2 border-t border-slate-800 pt-3">
                <div className="flex gap-2"><span className="text-indigo-400">endpoint[a2a]</span><span>— Agent-to-agent mailbox address</span></div>
                <div className="flex gap-2"><span className="text-indigo-400">endpoint[mcp]</span><span>— MCP tool server URL</span></div>
                <div className="flex gap-2"><span className="text-indigo-400">story[ip_id]</span><span>— Story Protocol IP Asset ID</span></div>
                <div className="flex gap-2"><span className="text-indigo-400">cdr[vault_id]</span><span>— Confidential Data Rail vault</span></div>
              </div>
              <div className="mt-3 border-t border-slate-800 pt-3 text-slate-500">
                State is indexed in real-time by Envio HyperIndex and queryable across the GhostAgent ecosystem.
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
