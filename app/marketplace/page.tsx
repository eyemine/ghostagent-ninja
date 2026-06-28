'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const FAKENORMIE_CONTRACT  = '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29';
const CHONK_CONTRACT       = '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9';
const ENS_CONTRACT         = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
const POWNFT_CONTRACT      = '0x9abb7bddc43fa67c76a62d8c016513827f59be1b';
const GNOSIS_RPC           = 'https://rpc.gnosischain.com';
const BASE_RPC             = 'https://mainnet.base.org';

const SAFE_TRANSFER_ABI = [{
  name: 'safeTransferFrom',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from',    type: 'address' },
    { name: 'to',      type: 'address' },
    { name: 'tokenId', type: 'uint256' },
  ],
  outputs: [],
}] as const;

// ── Alchemy: get NFTs by contract owned by wallet ───────────────────────────
async function fetchOwnedNFTs(owner: string, contract: string, chain: 'base' | 'eth'): Promise<{ tokenId: number; name: string; imageUrl: string }[]> {
  if (!ALCHEMY_KEY) return [];
  const base = chain === 'base'
    ? `https://base-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}`
    : `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}`;
  const url = `${base}/getNFTsForOwner?owner=${owner}&contractAddresses[]=${contract}&withMetadata=true&pageSize=100`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as {
      ownedNfts?: { tokenId?: string; name?: string; image?: { pngUrl?: string; cachedUrl?: string; contentType?: string; originalUrl?: string }; raw?: { metadata?: { image?: string } } }[];
    };
    return (data.ownedNfts ?? []).map(n => {
      const tokenId = parseInt(n.tokenId ?? '0', 16);
      const isVideo = n.image?.contentType?.startsWith('video/');
      const imageUrl = isVideo
        ? (n.image?.pngUrl ?? n.image?.cachedUrl ?? '')
        : (n.image?.cachedUrl ?? n.image?.pngUrl ?? n.image?.originalUrl ?? n.raw?.metadata?.image ?? '');
      return { tokenId, name: n.name ?? `#${tokenId}`, imageUrl };
    });
  } catch {
    return [];
  }
}

// ── Alchemy: get Chonks owned by wallet ─────────────────────────────────────
const fetchOwnedChonks  = (owner: string) => fetchOwnedNFTs(owner, CHONK_CONTRACT, 'base');
const fetchOwnedEns     = (owner: string) => fetchOwnedNFTs(owner, ENS_CONTRACT, 'eth');
const fetchOwnedPownft  = (owner: string) => fetchOwnedNFTs(owner, POWNFT_CONTRACT, 'eth');


const FAKENORMIE_TOKENS = [0, 1, 2, 3, 4, 5, 6, 7];
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? '';

const NS_COLOR: Record<string, string> = {
  'molt.gno':     'text-violet-300 bg-violet-500/10',
  'nftmail.gno':  'text-cyan-300 bg-cyan-500/10',
  'picoclaw.gno': 'text-amber-300 bg-amber-500/10',
  'vault.gno':    'text-emerald-300 bg-emerald-500/10',
  'agent.gno':    'text-blue-300 bg-blue-500/10',
};

const TIER_RANK: Record<string, number> = {
  premium: 3, pro: 2, lite: 2, ghost: 4, basic: 0,
};

interface OwnedNFT {
  tokenId: number;
  name: string;
  imageUrl: string;
}

interface AgentProfile {
  name: string;
  tld: string;
  tier?: string;
  safeAddress?: string;
  nftImage?: string;
}

interface TransferState {
  contract: string;
  tokenId: number;
  chainId: number;
  label: string;
  imageUrl: string;
}

// ── ERC-721 safeTransferFrom via injected provider ────────────────────────────
async function erc721Transfer(
  contract: string,
  from: string,
  to: string,
  tokenId: number,
  chainId: number,
): Promise<string> {
  const { createWalletClient, createPublicClient, custom, http } = await import('viem');
  const provider = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!provider) throw new Error('No wallet provider detected');

  const chains = await import('viem/chains');
  const chain = chainId === 100 ? chains.gnosis : chainId === 8453 ? chains.base : chains.mainnet;

  const walletClient = createWalletClient({ chain, transport: custom(provider as Parameters<typeof custom>[0]) });
  await walletClient.addChain({ chain }).catch(() => null);
  await walletClient.switchChain({ id: chainId });

  const [account] = await walletClient.requestAddresses();

  const txHash = await walletClient.writeContract({
    address: contract as `0x${string}`,
    abi: SAFE_TRANSFER_ABI,
    functionName: 'safeTransferFrom',
    args: [from as `0x${string}`, to as `0x${string}`, BigInt(tokenId)],
    account,
    chain,
  });

  const rpc = chainId === 100 ? GNOSIS_RPC : chainId === 8453 ? BASE_RPC : 'https://ethereum.publicnode.com';
  const pubClient = createPublicClient({ chain, transport: http(rpc) });
  await pubClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// ── Transfer modal ────────────────────────────────────────────────────────────
function TransferModal({ item, onClose }: { item: TransferState; onClose: () => void }) {
  const [to, setTo]             = useState('');
  const [status, setStatus]     = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [txHash, setTxHash]     = useState('');
  const [error, setError]       = useState('');

  async function handleTransfer() {
    if (!to.match(/^0x[0-9a-fA-F]{40}$/)) { setError('Enter a valid 0x address'); return; }
    setStatus('pending'); setError('');
    try {
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error('No wallet detected');
      const { createWalletClient, custom } = await import('viem');
      const chains = await import('viem/chains');
      const chain = item.chainId === 100 ? chains.gnosis : item.chainId === 8453 ? chains.base : chains.mainnet;
      const wc = createWalletClient({ chain, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [from] = await wc.requestAddresses();
      const hash = await erc721Transfer(item.contract, from, to, item.tokenId, item.chainId);
      setTxHash(hash);
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
      setStatus('error');
    }
  }

  const explorer = item.chainId === 100 ? 'https://gnosisscan.io/tx/' : item.chainId === 8453 ? 'https://basescan.org/tx/' : 'https://etherscan.io/tx/';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[#0f0703] shadow-2xl">
        <div className="border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#f2eee4]">Send / Transfer NFT</h2>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">{item.label} · {item.chainId === 100 ? 'Gnosis' : item.chainId === 8453 ? 'Base' : 'Ethereum'}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* NFT preview */}
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.imageUrl} alt={item.label} className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#f2eee4]">{item.label}</p>
              <p className="text-[10px] text-[var(--muted)]">Token #{item.tokenId}</p>
              <p className="text-[10px] text-emerald-400 font-semibold">Price: FREE (0 xDAI)</p>
            </div>
          </div>

          {status !== 'done' && (
            <>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">Recipient Address</label>
                <input
                  type="text"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  placeholder="0x..."
                  className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2.5 font-mono text-xs text-[#f2eee4] outline-none focus:border-[#b0805c] placeholder:text-[var(--muted)]"
                  disabled={status === 'pending'}
                />
              </div>
              {error && <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">{error}</p>}
              <div className="flex gap-3">
                <button onClick={onClose} disabled={status === 'pending'} className="flex-1 rounded-lg border border-[var(--border)] py-2.5 text-xs text-[var(--muted)] hover:text-white transition">
                  Cancel
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={status === 'pending' || !to}
                  className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-white transition disabled:opacity-40"
                  style={{ background: 'rgba(176,128,92,0.85)' }}
                >
                  {status === 'pending' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Sending…
                    </span>
                  ) : 'Send NFT'}
                </button>
              </div>
            </>
          )}

          {status === 'done' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
                <span className="text-emerald-400 text-lg">✓</span>
                <div>
                  <p className="text-xs font-semibold text-emerald-300">Transfer complete</p>
                  <a href={`${explorer}${txHash}`} target="_blank" rel="noreferrer" className="text-[10px] text-[var(--muted)] hover:text-fuchsia-300 font-mono break-all">
                    {txHash.slice(0, 20)}… ↗
                  </a>
                </div>
              </div>
              <button onClick={onClose} className="w-full rounded-lg border border-[var(--border)] py-2.5 text-xs text-[var(--muted)] hover:text-white transition">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FakeNormie card ───────────────────────────────────────────────────────────
function FakeNormieCard({ tokenId, onTransfer }: { tokenId: number; onTransfer: (t: TransferState) => void }) {
  const padded   = String(tokenId).padStart(2, '0');
  const svgPath  = `/FakeNormies/SVGS/${padded}.svg`;
  const metaUrl  = `/api/nft-metadata/fakenormie/${tokenId}`;
  const [name, setName] = useState(`FakeNormie #${padded}`);

  useEffect(() => {
    fetch(metaUrl).then(r => r.ok ? r.json() : null).then((d: { name?: string } | null) => {
      if (d?.name) setName(d.name);
    }).catch(() => {});
  }, [metaUrl]);

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 transition hover:brightness-110">
      <div>
        <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.2)] bg-black">
          <Image src={svgPath} alt={name} fill className="object-contain p-1" unoptimized />
        </div>
        <p className="mt-2.5 text-center text-xs font-semibold text-[#f2eee4]">{name}</p>
        <p className="text-center text-[10px] text-[var(--muted)]">Token #{tokenId} · Gnosis</p>
        <div className="mt-1.5 flex justify-center">
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300">FakeNormie</span>
        </div>
      </div>
      <button
        onClick={() => onTransfer({ contract: FAKENORMIE_CONTRACT, tokenId, chainId: 100, label: name, imageUrl: svgPath })}
        className="mt-3 w-full rounded-lg border py-2 text-[11px] font-semibold transition"
        style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.08)' }}
      >
        Send / Transfer →
      </button>
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────────────────────
function AgentCard({ agent, onTransfer }: { agent: AgentProfile; onTransfer: (t: TransferState) => void }) {
  const nsColor = NS_COLOR[agent.tld] ?? 'text-zinc-300 bg-zinc-500/10';
  const sld     = agent.tld.split('.')[0];
  const imageUrl = agent.nftImage ?? `/api/genome-image?sld=${sld}&name=${encodeURIComponent(agent.name)}`;

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[rgba(176,128,92,0.2)] bg-black/20 p-4 transition hover:brightness-110">
      <div>
        <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-xl border border-[rgba(176,128,92,0.2)] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={agent.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).src = '/ghost-logo.png'; }} />
        </div>
        <p className="mt-2.5 text-center text-xs font-semibold text-[#f2eee4]">{agent.name}</p>
        <div className="mt-1 flex justify-center gap-1.5 flex-wrap">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${nsColor}`}>{agent.tld}</span>
          {agent.tier && (
            <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[9px] font-semibold text-fuchsia-300 capitalize">{agent.tier}</span>
          )}
        </div>
        {agent.safeAddress && (
          <p className="mt-1 text-center font-mono text-[9px] text-[var(--muted)]">Safe: {agent.safeAddress.slice(0,6)}…{agent.safeAddress.slice(-4)}</p>
        )}
      </div>
      <div className="mt-3 space-y-2">
        <Link
          href={`/agent/${agent.name}`}
          className="block w-full rounded-lg border border-[rgba(176,128,92,0.2)] py-1.5 text-center text-[10px] text-[var(--muted)] transition hover:text-white"
        >
          View Profile →
        </Link>
        <button
          onClick={() => onTransfer({ contract: '', tokenId: 0, chainId: 100, label: `${agent.name}.${agent.tld}`, imageUrl })}
          className="w-full rounded-lg border py-2 text-[11px] font-semibold transition"
          style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.08)' }}
          title="Contact owner to arrange transfer via Gnosis Safe"
        >
          Enquire to Buy →
        </button>
      </div>
    </div>
  );
}

// ── Generic wallet-gated NFT section ─────────────────────────────────────────
interface AccentClass { border: string; bg: string; text: string; dashed: string; pulse: string; }
function WalletNFTSection({
  chainLabel, accentClass, walletAddress, loading, items, collectionLabel, chainId, contract, onConnect, onTransfer,
}: {
  chainLabel: string;
  accentClass: AccentClass;
  walletAddress: string;
  loading: boolean;
  items: OwnedNFT[];
  collectionLabel: string;
  chainId: number;
  contract: string;
  onConnect: () => void;
  onTransfer: (t: TransferState) => void;
}) {
  if (!walletAddress) {
    return (
      <div className={`rounded-2xl border border-dashed ${accentClass.dashed} p-8 text-center space-y-3`}>
        <p className="text-sm text-[var(--muted)]">Connect your wallet to see {collectionLabel}s you own on {chainLabel}</p>
        <button onClick={onConnect} className="rounded-xl border px-5 py-2 text-xs font-semibold transition" style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}>
          Connect Wallet
        </button>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className={`h-48 rounded-2xl border ${accentClass.pulse} bg-black/20 animate-pulse`} />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className={`rounded-2xl border border-dashed ${accentClass.dashed} p-8 text-center space-y-2`}>
        <p className="text-sm text-[var(--muted)]">
          No {collectionLabel}s found at <code className={`text-[10px] ${accentClass.text}`}>{walletAddress.slice(0,6)}…{walletAddress.slice(-4)}</code> on {chainLabel}.
        </p>
        <button onClick={onConnect} className="text-xs text-[#b0805c] hover:underline">Try another wallet →</button>
      </div>
    );
  }
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
      {items.map(item => (
        <div key={item.tokenId} className={`flex flex-col justify-between rounded-2xl border ${accentClass.border} ${accentClass.bg} p-4 transition hover:brightness-110`}>
          <div>
            <div className={`relative mx-auto h-24 w-24 overflow-hidden rounded-xl border ${accentClass.border} bg-black`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).src = '/ghost-logo.png'; }} />
            </div>
            <p className="mt-2.5 text-center text-xs font-semibold text-[#f2eee4]">{item.name}</p>
            <p className="text-center text-[10px] text-[var(--muted)]">Token #{item.tokenId} · {chainLabel}</p>
            <div className="mt-1.5 flex justify-center">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${accentClass.bg} ${accentClass.text}`}>{collectionLabel}</span>
            </div>
          </div>
          <button
            onClick={() => onTransfer({ contract, tokenId: item.tokenId, chainId, label: item.name, imageUrl: item.imageUrl })}
            className="mt-3 w-full rounded-lg border py-2 text-[11px] font-semibold transition"
            style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.08)' }}
          >
            Send / Transfer →
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const [agents, setAgents]           = useState<AgentProfile[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [chonks, setChonks]           = useState<OwnedNFT[]>([]);
  const [chonksLoading, setChonksLoading] = useState(false);
  const [ens, setEns]                 = useState<OwnedNFT[]>([]);
  const [ensLoading, setEnsLoading]   = useState(false);
  const [pownft, setPownft]           = useState<OwnedNFT[]>([]);
  const [pownftLoading, setPownftLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [ethWalletAddress, setEthWalletAddress] = useState('');
  const [transfer, setTransfer]       = useState<TransferState | null>(null);
  const [section, setSection]         = useState<'all' | 'fakenormie' | 'chonk' | 'ens' | 'pownft' | 'agents'>('all');

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listAgents' }),
      });
      if (!res.ok) return;
      const data = await res.json() as { agents?: AgentProfile[] };
      const list = (data.agents ?? []).filter(a =>
        a.tld !== 'openclaw.gno' &&
        (TIER_RANK[a.tier?.toLowerCase() ?? ''] ?? 0) >= 2
      );
      setAgents(list);
    } catch {
      // non-fatal
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => { void loadAgents(); }, [loadAgents]);

  async function connectBaseWallet() {
    const provider = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!provider) { alert('No wallet detected — install MetaMask or use a Web3 browser.'); return; }
    try {
      const { createWalletClient, custom } = await import('viem');
      const { base } = await import('viem/chains');
      const wc = createWalletClient({ chain: base, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [addr] = await wc.requestAddresses();
      setWalletAddress(addr);
      setChonksLoading(true);
      const owned = await fetchOwnedChonks(addr);
      setChonks(owned);
    } catch (e: unknown) {
      console.error('Chonk load failed:', e);
    } finally {
      setChonksLoading(false);
    }
  }

  async function connectEthWallet(setLoader: (b: boolean) => void, setItems: (t: OwnedNFT[]) => void, fetcher: (addr: string) => Promise<OwnedNFT[]>) {
    const provider = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!provider) { alert('No wallet detected — install MetaMask or use a Web3 browser.'); return; }
    try {
      const { createWalletClient, custom } = await import('viem');
      const { mainnet } = await import('viem/chains');
      const wc = createWalletClient({ chain: mainnet, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [addr] = await wc.requestAddresses();
      setEthWalletAddress(addr);
      setLoader(true);
      const owned = await fetcher(addr);
      setItems(owned);
    } catch (e: unknown) {
      console.error('ETH wallet load failed:', e);
    } finally {
      setLoader(false);
    }
  }

  const showFN     = section === 'all' || section === 'fakenormie';
  const showChonks = section === 'all' || section === 'chonk';
  const showEns    = section === 'all' || section === 'ens';
  const showPownft = section === 'all' || section === 'pownft';
  const showAgents = section === 'all' || section === 'agents';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-10">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#f2eee4]">Marketplace</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Send, transfer, or enquire about GhostAgent NFTs. No listing fees — free transfers direct on-chain.
        </p>
      </div>

      {/* Section filter */}
      <div className="flex gap-2 flex-wrap">
        {([['all', 'All'], ['fakenormie', 'FakeNormies'], ['chonk', 'Chonks'], ['ens', 'ENS'], ['pownft', 'POWNFT'], ['agents', 'Agent IDs']] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setSection(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${section === v ? 'bg-[rgba(176,128,92,0.18)] text-[#b0805c]' : 'text-[var(--muted)] hover:text-[#f2eee4]'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── FakeNormies ── */}
      {showFN && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#f2eee4]">FakeNormies</h2>
              <p className="text-[11px] text-[var(--muted)]">ERC-721 on Gnosis · direct on-chain transfer</p>
            </div>
            <span className="rounded-full border border-[rgba(176,128,92,0.2)] px-2.5 py-0.5 text-[10px] text-[var(--muted)]">
              {FAKENORMIE_TOKENS.length} minted
            </span>
          </div>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {FAKENORMIE_TOKENS.map(id => (
              <FakeNormieCard key={id} tokenId={id} onTransfer={setTransfer} />
            ))}
          </div>
        </section>
      )}

      {/* ── Chonks ── */}
      {showChonks && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#f2eee4]">Chonks</h2>
              <p className="text-[11px] text-[var(--muted)]">ERC-721 on Base · governing NFT = agent ownership</p>
            </div>
            {walletAddress && !chonksLoading && (
              <span className="rounded-full border border-fuchsia-500/20 px-2.5 py-0.5 text-[10px] text-fuchsia-300">
                {chonks.length} owned
              </span>
            )}
          </div>
          <WalletNFTSection
            chainLabel="Base"
            accentClass={{ border: 'border-fuchsia-500/20', bg: 'bg-fuchsia-500/5', text: 'text-fuchsia-300', dashed: 'border-fuchsia-500/20', pulse: 'border-fuchsia-500/10' }}
            walletAddress={walletAddress}
            loading={chonksLoading}
            items={chonks}
            collectionLabel="Chonk"
            chainId={8453}
            contract={CHONK_CONTRACT}
            onConnect={() => void connectBaseWallet()}
            onTransfer={setTransfer}
          />
        </section>
      )}

      {/* ── ENS ── */}
      {showEns && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#f2eee4]">ENS Names</h2>
              <p className="text-[11px] text-[var(--muted)]">ERC-721 on Ethereum · .eth names as transferable NFTs</p>
            </div>
            {ethWalletAddress && !ensLoading && (
              <span className="rounded-full border border-blue-500/20 px-2.5 py-0.5 text-[10px] text-blue-300">
                {ens.length} owned
              </span>
            )}
          </div>
          <WalletNFTSection
            chainLabel="Ethereum"
            accentClass={{ border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-300', dashed: 'border-blue-500/20', pulse: 'border-blue-500/10' }}
            walletAddress={ethWalletAddress}
            loading={ensLoading}
            items={ens}
            collectionLabel="ENS"
            chainId={1}
            contract={ENS_CONTRACT}
            onConnect={() => void connectEthWallet(setEnsLoading, setEns, fetchOwnedEns)}
            onTransfer={setTransfer}
          />
        </section>
      )}

      {/* ── POWNFT ── */}
      {showPownft && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#f2eee4]">POWNFT</h2>
              <p className="text-[11px] text-[var(--muted)]">ERC-721 on Ethereum · on-chain generative ATOMs</p>
            </div>
            {ethWalletAddress && !pownftLoading && (
              <span className="rounded-full border border-orange-500/20 px-2.5 py-0.5 text-[10px] text-orange-300">
                {pownft.length} owned
              </span>
            )}
          </div>
          <WalletNFTSection
            chainLabel="Ethereum"
            accentClass={{ border: 'border-orange-500/20', bg: 'bg-orange-500/5', text: 'text-orange-300', dashed: 'border-orange-500/20', pulse: 'border-orange-500/10' }}
            walletAddress={ethWalletAddress}
            loading={pownftLoading}
            items={pownft}
            collectionLabel="ATOM"
            chainId={1}
            contract={POWNFT_CONTRACT}
            onConnect={() => void connectEthWallet(setPownftLoading, setPownft, fetchOwnedPownft)}
            onTransfer={setTransfer}
          />
        </section>
      )}

      {/* ── Agent IDs ── */}
      {showAgents && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#f2eee4]">Agent IDs</h2>
              <p className="text-[11px] text-[var(--muted)]">Pro tier and above · excludes openclaw.gno · enquire to arrange Safe transfer</p>
            </div>
            {!agentsLoading && (
              <span className="rounded-full border border-[rgba(176,128,92,0.2)] px-2.5 py-0.5 text-[10px] text-[var(--muted)]">
                {agents.length} listed
              </span>
            )}
          </div>

          {agentsLoading ? (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-48 rounded-2xl border border-[rgba(176,128,92,0.1)] bg-black/20 animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[rgba(176,128,92,0.25)] p-8 text-center">
              <p className="text-sm text-[var(--muted)]">No Pro+ agents available at this time.</p>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
              {agents.map(a => (
                <AgentCard key={`${a.name}-${a.tld}`} agent={a} onTransfer={setTransfer} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── How it works ── */}
      <div className="rounded-2xl border border-dashed border-[rgba(176,128,92,0.25)] p-6 space-y-2">
        <p className="text-xs font-semibold text-[#f2eee4]">How transfers work</p>
        <ul className="space-y-1 text-[11px] text-[var(--muted)]">
          <li>• <strong className="text-[#f2eee4]">FakeNormies</strong> — ERC-721 <code className="text-[10px] text-[#b0805c]">safeTransferFrom</code> direct on Gnosis. Connect wallet, enter recipient address, confirm.</li>
          <li>• <strong className="text-[#f2eee4]">Chonks</strong> — ERC-721 on Base. Transferring the Chonk transfers the governing NFT and therefore the associated agent identity. Connect wallet → select Chonk → enter recipient.</li>
          <li>• <strong className="text-[#f2eee4]">ENS</strong> — ERC-721 on Ethereum. Your .eth names as transferable NFTs. Connect wallet → select name → send to new owner.</li>
          <li>• <strong className="text-[#f2eee4]">POWNFT</strong> — ERC-721 on Ethereum. On-chain generative ATOMs. Connect wallet → select → transfer.</li>
          <li>• <strong className="text-[#f2eee4]">Agent IDs (.gno subnames)</strong> — transferred via Gnosis Safe signer change. Click &quot;Enquire&quot; to contact the owner via their agent&apos;s nftmail address.</li>
          <li>• All transfers are at 0 xDAI cost by default — price is negotiated off-platform.</li>
        </ul>
      </div>

      {/* Transfer modal */}
      {transfer && <TransferModal item={transfer} onClose={() => setTransfer(null)} />}
    </div>
  );
}
