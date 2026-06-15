'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { createPublicClient, http, parseAbi, formatEther } from 'viem';
import { gnosis } from 'viem/chains';
import { TradeIntentPanel } from '../../../components/TradeIntentPanel';
import SwarmConsensus from '../../../components/SwarmConsensus';
import { GhostHandshakePanel } from '../../../components/GhostHandshakePanel';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

const PANEL_ICONS = {
  identity: 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreibxrtske55ycsfk5pex4htm6b5owyvnd5chxx5mllk2a7tcrtdnyq',
  inbox:    'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreigsbizftt4tysymzdxea62juyhjcoy7xwiqjvalaxnrlkoddy2iae',
  safe:     'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreifflytowpb6kppkmoywvgwfldn4owtetlvjfbhjco2rb3lxq6uw3a',
  erc8004:  'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreic6v7tuwadtaybqxso4itzew4m6ycteuu4zeuyaf3zlttoctma3ui',
};

const CHONK_CONTRACT   = '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9';
const POWNFT_CONTRACT  = '0x9abb7bddc43fa67c76a62d8c016513827f59be1b';
const NORMIE_CONTRACT  = '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB';
const MOONCAT_CONTRACT = '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69';

type ByoType = 'chonk' | 'pownft' | 'normie' | 'mooncat' | 'ens' | null;

function detectByoType(agentName: string): { type: ByoType; tokenId: string | null; contract: string | null; marketLink: string | null } {
  const n = agentName.toLowerCase();
  const chonkM = n.match(/^chonk[._-](\d+)/);
  if (chonkM) return { type: 'chonk', tokenId: chonkM[1], contract: CHONK_CONTRACT, marketLink: `https://www.chonks.xyz/market/chonks/${chonkM[1]}` };
  const pownftM = n.match(/^atom[._-](\d+)/);
  if (pownftM) return { type: 'pownft', tokenId: pownftM[1], contract: POWNFT_CONTRACT, marketLink: `https://pownft.com/atom/${pownftM[1]}` };
  const normieM = n.match(/^normie[._-](\d+)/);
  if (normieM) return { type: 'normie', tokenId: normieM[1], contract: NORMIE_CONTRACT, marketLink: `https://opensea.io/assets/base/${NORMIE_CONTRACT}/${normieM[1]}` };
  const mooncatM = n.match(/^mooncat[._-](\d+)/);
  if (mooncatM) return { type: 'mooncat', tokenId: mooncatM[1], contract: MOONCAT_CONTRACT, marketLink: `https://opensea.io/assets/ethereum/${MOONCAT_CONTRACT}/${mooncatM[1]}` };
  return { type: null, tokenId: null, contract: null, marketLink: null };
}

async function fetchByoNftImage(type: ByoType, tokenId: string): Promise<string | null> {
  if (!tokenId) return null;
  try {
    if (type === 'pownft') {
      const r = await fetch(`/api/nft-preview?type=pownft&tokenId=${tokenId}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json() as { imageUrl?: string | null };
      return d.imageUrl ?? null;
    }
    if (type === 'chonk') {
      const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
      if (!key) return null;
      const r = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${key}/getNFTMetadata?contractAddress=${CHONK_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as any;
      const isVideo = d?.image?.contentType?.startsWith('video/');
      return isVideo ? (d?.image?.pngUrl ?? d?.image?.thumbnailUrl ?? null) : (d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null);
    }
    if (type === 'normie') {
      const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
      if (!key) return null;
      const r = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${key}/getNFTMetadata?contractAddress=${NORMIE_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as any;
      return d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null;
    }
    if (type === 'mooncat') {
      const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
      if (!key) return null;
      const r = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${key}/getNFTMetadata?contractAddress=${MOONCAT_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
      if (!r.ok) return null;
      const d = await r.json() as any;
      return d?.image?.cachedUrl ?? d?.image?.pngUrl ?? null;
    }
  } catch { /* fall through */ }
  return null;
}

const HITL_ABI = parseAbi([
  'function threshold() view returns (uint256)',
  'function emergencyPaused() view returns (bool)',
  'function getPendingCount() view returns (uint256)',
]);

const FACTORY_ABI = parseAbi([
  'function getModule(address safeAddress) view returns (address)',
]);

const FACTORY_ADDRESS = (
  process.env.NEXT_PUBLIC_HITL_FACTORY_ADDRESS ?? '0xB2Ad4C8368c8C02976124a5f75F951Fd24C5631D'
) as `0x${string}`;

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http('https://rpc.gnosischain.com'),
});

interface AgentIdentity {
  name: string;
  email?: string;
  storyIp?: string | null;
  identityNft?: { name: string; tokenId: number; owner: string; tld: string };
  safe?: string;
  tbaAddress?: string | null;
  byoTba?: { tbaAddress: string; sourceChainId: number; nftType: string; tokenId: string } | null;
  erc8004?: {
    gnosis?: { agentId: number; agentURI?: string; chainId?: number };
    base?: { agentId: number; chainId?: number };
    baseSepolia?: { agentId: number };
  };
  links?: { profile?: string; agentCard?: string };
}

const CHAIN_LABEL: Record<number, string> = {
  1:    'Ethereum',
  8453: 'Base',
  84532:'Base Sepolia',
};
const CHAIN_EXPLORER: Record<number, string> = {
  1:    'https://etherscan.io/address/',
  8453: 'https://basescan.org/address/',
  84532:'https://sepolia.basescan.org/address/',
};

interface HITLState {
  threshold: string;
  paused: boolean;
  pending: number;
  moduleAddr: string;
}

const VALID_SLDS = ['agent', 'openclaw', 'molt', 'picoclaw', 'vault', 'nftmail'] as const;
type SldKey = typeof VALID_SLDS[number];

const SLD_COLOR: Record<SldKey, string> = {
  agent:    'text-blue-300',
  openclaw: 'text-rose-300',
  molt:     'text-violet-300',
  picoclaw: 'text-amber-300',
  vault:    'text-emerald-300',
  nftmail:  'text-cyan-300',
};


const TABS = [
  { id: 'overview',  label: '🪪 Overview'    },
  { id: 'trade',     label: '📈 TradeIntent' },
  { id: 'swarm',     label: '🤝 Swarm'       },
  { id: 'tunnel',    label: '🌐 Tunnel'      },
  { id: 'handshake', label: '🔏 Certs'       },
] as const;
type TabId = typeof TABS[number]['id'];

const AGENT_ACTIONS = [
  { key: 'agent-profile', label: 'Agent Profile', href: (n: string) => `/dashboard/agent-profile?agent=${n}`, color: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' },
  { key: 'molt',          label: 'Molt',          href: (n: string) => `/molt?agent=${n}`,                    color: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20' },
  { key: 'ghost-tier',    label: 'Ghost Tier',    href: (n: string) => `/dashboard/settings/ghost?agent=${n}`,color: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20' },
  { key: 'byo-nft',       label: 'Pair NFT',      href: () => 'https://ghostagent.ninja/pair-nft',          color: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' },
  { key: 'erc8048',       label: 'ERC-8048',      href: (n: string) => `/dashboard/erc8048?agent=${n}`,        color: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20' },
  { key: 'swarm',         label: 'Swarm',         href: (n: string) => `/dashboard/swarm?agent=${n}`,         color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
  { key: 'trade',         label: 'Trade Intent',  href: (n: string) => `/dashboard/trade?agent=${n}`,         color: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' },
  { key: 'hitl',          label: 'HITL Gates',    href: (n: string) => `/dashboard/hitl?agent=${n}`,          color: 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' },
  { key: 'ip-portal',     label: 'IP Portal',     href: (n: string) => `/ip-portal?agent=${n}`,               color: 'border-[#7c4dff]/30 bg-[#7c4dff]/10 text-[#a78bfa] hover:bg-[#7c4dff]/20' },
  { key: 'stake-host',   label: 'Stake $HOST',   href: (n: string) => `/host?agent=${n}`,                    color: 'border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] text-[#b0805c] hover:bg-[rgba(176,128,92,0.15)]' },
];

function shortAddr(a: string) { return `${a.slice(0,8)}…${a.slice(-6)}`; }

export default function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const searchParams = useSearchParams();
  const rawSld = searchParams.get('sld') ?? '';
  const sld: SldKey | null = VALID_SLDS.includes(rawSld as SldKey) ? (rawSld as SldKey) : null;
  const sldColor = sld ? SLD_COLOR[sld] : 'text-[var(--muted)]';
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [hitl, setHitl]         = useState<HITLState | null>(null);
  const [safeBalance, setSafeBalance] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [byoImage, setByoImage] = useState<string | null>(null);

  const byo = detectByoType(String(name));

  useEffect(() => {
    if (!name) return;
    setLoading(true);

    // 1. API: getAgentIdentity via server route (avoids exposing worker secret)
    const identityP = fetch(`/api/agent-lookup?q=${name}`)
      .then(r => r.json() as Promise<AgentIdentity & { error?: string }>)
      .then(d => d.error ? null : d)
      .catch(() => null);

    // 2. HITL module: look up via factory for this agent's Safe, then read state
    const hitlP = identityP.then(async id => {
      const safe = id?.safe;
      if (!safe) return null;
      try {
        const moduleAddr = await publicClient.readContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: 'getModule',
          args: [safe as `0x${string}`],
        }) as string;
        if (!moduleAddr || moduleAddr === ZERO_ADDR) return null;
        const [thr, paused, pending] = await Promise.all([
          publicClient.readContract({ address: moduleAddr as `0x${string}`, abi: HITL_ABI, functionName: 'threshold' }),
          publicClient.readContract({ address: moduleAddr as `0x${string}`, abi: HITL_ABI, functionName: 'emergencyPaused' }),
          publicClient.readContract({ address: moduleAddr as `0x${string}`, abi: HITL_ABI, functionName: 'getPendingCount' }),
        ]);
        return {
          threshold: `${formatEther(thr as bigint)} xDAI`,
          paused: paused as boolean,
          pending: Number(pending),
          moduleAddr,
        };
      } catch { return null; }
    });

    Promise.all([identityP, hitlP]).then(([id, h]: [AgentIdentity | null, HITLState | null]) => {
      setIdentity(id);
      setHitl(h);

      // 3. Safe xDAI balance
      const safe = id?.safe;
      if (safe) {
        publicClient.getBalance({ address: safe as `0x${string}` })
          .then(b => setSafeBalance(`${formatEther(b)} xDAI`))
          .catch(() => setSafeBalance(null));
      }

      // 4. BYO NFT image
      const { type: byoType, tokenId: byoTokenId } = detectByoType(String(name));
      if (byoType && byoTokenId) {
        fetchByoNftImage(byoType, byoTokenId).then(img => setByoImage(img));
      }
    }).finally(() => setLoading(false));
  }, [name]);

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Agent image — BYO NFT image if available, else SLD background */}
          <div className="h-32 w-32 shrink-0 rounded-2xl overflow-hidden border border-[rgba(176,128,92,0.2)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={byoImage ?? (sld ? `/sld-images/${sld}.png` : '/ghost-logo.png')}
              alt={byo.type ? `${byo.type} #${byo.tokenId}` : (sld ? `${sld}.gno` : 'GhostAgent')}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">{name}</h1>
              {sld && (
                <span className={`rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold ring-1 ring-current/20 ${sldColor}`}>
                  {sld}.gno
                </span>
              )}
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                OWNER VIEW
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Full agent detail — identity, Safe, ERC-8004, inbox, IP &amp; telemetry</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/agent/${name}`}
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-white"
          >
            Public View ↗
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-white"
          >
            ← Dashboard
          </Link>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-[rgba(176,128,92,0.03)] px-4 py-3 text-[11px] text-[var(--muted)] animate-pulse">
          Loading agent data…
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-[rgba(176,128,92,0.15)] text-[#f2eee4]'
                : 'text-[var(--muted)] hover:text-[#f2eee4]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
      <div className="grid gap-4 md:grid-cols-2">

        {/* Identity */}
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PANEL_ICONS.identity} alt="Identity" className="h-6 w-6 rounded object-contain" />
            <h2 className="text-sm font-semibold text-amber-300">Identity Graph</h2>
          </div>
          <div className="space-y-2">
            {([
              { label: 'Agent Name',       value: identity?.name ?? String(name) },
              { label: 'Namespace',        value: identity?.identityNft?.tld ?? (sld ? `${sld}.gno` : '—') },
              { label: 'Beacon NFT',       value: identity?.identityNft?.name ?? '—' },
              { label: 'Safe Address',     value: identity?.safe ? shortAddr(identity.safe) : '—', href: identity?.safe ? `https://app.safe.global/home?safe=gno:${identity.safe}` : undefined, full: identity?.safe },
              { label: 'ERC-8004 (Gnosis)',value: identity?.erc8004?.gnosis ? `#${identity.erc8004.gnosis.agentId}` : '—' },
              { label: 'ERC-8004 (Base)',  value: identity?.erc8004?.base   ? `#${identity.erc8004.base.agentId}`   : '—' },
              { label: 'Agent URI',        value: identity?.erc8004?.gnosis?.agentURI ? '✓ live' : '—',
                title: 'The ERC-8004 agent-card JSON URI — registered on-chain so other agents can discover capabilities' },
            ] as Array<{ label: string; value: string; href?: string; full?: string; title?: string }>).map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-[var(--muted)] shrink-0" title={row.title}>{row.label}{row.title ? ' ℹ' : ''}</span>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[#b0805c] hover:underline truncate max-w-[160px]" title={row.full}>
                    {row.value} ↗
                  </a>
                ) : (
                  <span className="font-mono text-zinc-300 truncate max-w-[160px]">{row.value}</span>
                )}
              </div>
            ))}
            {/* BYO NFT row — only shown for BYO agents */}
            {byo.type && byo.tokenId && (
              <div className="flex items-center justify-between gap-4 text-[11px] pt-1 border-t border-amber-500/10">
                <span className="text-[var(--muted)] shrink-0 capitalize">{byo.type} NFT</span>
                {byo.marketLink ? (
                  <a href={byo.marketLink} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[#b0805c] hover:underline truncate max-w-[160px]">
                    #{byo.tokenId} ↗
                  </a>
                ) : (
                  <span className="font-mono text-zinc-300">#{byo.tokenId}</span>
                )}
              </div>
            )}
            {/* Source-chain TBA — the ERC-6551 that owns the Safe */}
            {identity?.byoTba && (() => {
              const chainLabel = CHAIN_LABEL[identity.byoTba.sourceChainId] ?? `Chain ${identity.byoTba.sourceChainId}`;
              const explorerBase = CHAIN_EXPLORER[identity.byoTba.sourceChainId];
              const explorerUrl = explorerBase ? `${explorerBase}${identity.byoTba.tbaAddress}` : null;
              return (
                <div className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="text-[var(--muted)] shrink-0">{chainLabel} TBA</span>
                  {explorerUrl ? (
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[#b0805c] hover:underline truncate max-w-[160px]" title={identity.byoTba.tbaAddress}>
                      {identity.byoTba.tbaAddress.slice(0,8)}…{identity.byoTba.tbaAddress.slice(-6)} ↗
                    </a>
                  ) : (
                    <span className="font-mono text-zinc-300 truncate max-w-[160px]" title={identity.byoTba.tbaAddress}>
                      {identity.byoTba.tbaAddress.slice(0,8)}…{identity.byoTba.tbaAddress.slice(-6)}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Safe & HITL */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PANEL_ICONS.safe} alt="Safe" className="h-6 w-6 rounded object-contain" />
            <h2 className="text-sm font-semibold text-emerald-300">Safe &amp; HITL Module</h2>
          </div>
          <div className="space-y-2">
            {([
              { label: 'Safe Balance',      value: safeBalance ?? '…' },
              { label: 'HITL Threshold',    value: hitl?.threshold ?? '…' },
              { label: 'HITL Status',       value: hitl ? (hitl.paused ? '🔴 PAUSED' : '🟢 Active') : '…',
                                            color: hitl?.paused ? 'text-red-300' : 'text-emerald-300' },
              { label: 'Pending Approvals', value: hitl ? String(hitl.pending) : '…',
                                            color: hitl?.pending ? 'text-orange-300' : undefined },
              { label: 'HITL Module',       value: hitl?.moduleAddr ? shortAddr(hitl.moduleAddr) : 'none deployed',
                                            href: hitl?.moduleAddr ? `https://gnosisscan.io/address/${hitl.moduleAddr}` : undefined },
            ] as Array<{ label: string; value: string; color?: string; href?: string }>).map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-[var(--muted)] shrink-0">{row.label}</span>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-[#b0805c] hover:underline">
                    {row.value} ↗
                  </a>
                ) : (
                  <span className={`font-mono truncate ${row.color ?? 'text-zinc-300'}`}>{row.value}</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-emerald-500/10">
            <Link
              href={`/dashboard/hitl?safe=${identity?.safe ?? ''}&agent=${String(name)}`}
              className="text-[10px] text-emerald-400 hover:underline">
              → Manage HITL gates
            </Link>
          </div>
        </div>

        {/* ERC-8004 & Links */}
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PANEL_ICONS.erc8004} alt="ERC-8004" className="h-6 w-6 rounded object-contain" />
            <h2 className="text-sm font-semibold text-violet-300">ERC-8004 &amp; Links</h2>
          </div>
          <div className="space-y-2">
            {([
              { label: 'Agent Card (JSON)',  value: 'View ↗', href: `/api/agent-card?agent=${name}` },
              { label: 'Public Profile',     value: 'View ↗', href: `/agent/${name}` },
              { label: 'ERC-8004 Registry',  value: 'notapaperclip.red ↗', href: `https://notapaperclip.red/?agent=${name}#erc8004` },
              { label: 'Edit Profile',       value: 'Edit ↗', href: `/dashboard/agent-profile?agent=${String(name)}`, internal: true },
              { label: 'NFTMail Inbox',      value: 'Open ↗', href: `https://nftmail.box/inbox/${name}` },
            ] as Array<{ label: string; value: string; href: string; internal?: boolean }>).map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-[var(--muted)] shrink-0">{row.label}</span>
                {row.internal ? (
                  <Link href={row.href} className="font-mono text-amber-400 hover:underline">{row.value}</Link>
                ) : (
                  <a href={row.href} target="_blank" rel="noopener noreferrer"
                    className="font-mono text-violet-400 hover:underline">
                    {row.value}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Inbox & IP */}
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PANEL_ICONS.inbox} alt="Inbox" className="h-6 w-6 rounded object-contain" />
            <h2 className="text-sm font-semibold text-sky-300">Inbox &amp; IP</h2>
          </div>
          <div className="space-y-2 text-[11px]">
            {/* BYO NFT token ID with contract link */}
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">NFT token ID</span>
              {byo.contract && byo.tokenId ? (
                <a href={byo.marketLink ?? '#'} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] text-sky-400 hover:underline truncate max-w-[180px]" title={`${byo.contract}/${byo.tokenId}`}>
                  {byo.contract.slice(0, 8)}…/{byo.tokenId} ↗
                </a>
              ) : (
                <span className="font-mono text-zinc-300">
                  {identity?.identityNft?.tokenId != null ? String(identity.identityNft.tokenId) : '—'}
                </span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">NFT owner</span>
              <span className="font-mono text-zinc-400 text-[10px]" title={identity?.identityNft?.owner}>
                {identity?.identityNft?.owner ? shortAddr(identity.identityNft.owner) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Story IP</span>
              <span className="font-mono text-zinc-500">not registered</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-sky-500/10">
              <span className="text-[var(--muted)]">NFTMail HITL</span>
              <span className="font-mono text-zinc-300 text-[10px]">
                {identity?.email ? identity.email.replace('_@', '@') : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">NFTMail agent</span>
              <span className="font-mono text-zinc-300 text-[10px]">{identity?.email ?? '—'}</span>
            </div>
          </div>
        </div>

      </div>
      )}

      {/* ── TradeIntent tab ── */}
      {activeTab === 'trade' && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
          <TradeIntentPanel
            agentName={String(name)}
            agentId={0}
            safeAddress="0x0000000000000000000000000000000000000000"
          />
          <p className="mt-4 text-[10px] text-[var(--muted)]">
            agentId and safeAddress are populated once your ERC-8004 registration is confirmed.
          </p>
        </div>
      )}

      {/* ── Swarm tab ── */}
      {activeTab === 'swarm' && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
          <SwarmConsensus
            vaultName={String(name).replace(/\.(vault|agent)\.gno$/, '')}
            walletAddress="0x0000000000000000000000000000000000000000"
            xmtpEnabled={false}
            memberCount={3}
          />
        </div>
      )}

      {/* ── Ghost-Tunnel tab ── */}
      {activeTab === 'tunnel' && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
          <GhostHandshakePanel
            agentName={String(name).includes('.vault.gno') ? String(name) : `${String(name)}.vault.gno`}
            safeAddress="0x0000000000000000000000000000000000000000"
          />
        </div>
      )}

      {/* ── Handshakes tab ── */}
      {activeTab === 'handshake' && (
      <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🤝</span>
          <h2 className="text-sm font-semibold text-[#f2eee4]">HandshakeCertificate Log</h2>
          <span className="ml-auto rounded-full bg-zinc-500/10 px-2 py-0.5 text-[9px] text-zinc-500 ring-1 ring-zinc-500/20">EIP-712</span>
        </div>
        <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/30 px-4 py-6 text-center">
          <p className="text-[11px] text-zinc-600">No certificates logged yet.</p>
          <p className="mt-1 text-[10px] text-zinc-700">Run <code className="font-mono">node scripts/erc8004-handshake-certificate.mjs</code> to generate one.</p>
        </div>
      </div>
      )}

      {/* ── Agent Action Bar ── */}
      <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">ACTIONS FOR</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
            {name}
          </span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {AGENT_ACTIONS.map(action => (
            <Link
              key={action.key}
              href={typeof action.href === 'function' ? action.href(String(name)) : action.href}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${action.color}`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
