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
  identityNft?: { name: string; tokenId: number; owner: string; tld: string };
  safe?: string;
  erc8004?: {
    gnosis?: { agentId: number; agentURI?: string; chainId?: number };
    base?: { agentId: number; chainId?: number };
    baseSepolia?: { agentId: number };
  };
  links?: { profile?: string; agentCard?: string };
}

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

  useEffect(() => {
    if (!name) return;
    setLoading(true);

    // 1. Worker: getAgentIdentity (response is top-level, not wrapped)
    const identityP = fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
    })
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
    }).finally(() => setLoading(false));
  }, [name]);

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* SLD image at ~200% of card size */}
          <div className="h-32 w-32 shrink-0 rounded-2xl overflow-hidden border border-[rgba(176,128,92,0.2)] bg-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sld ? `/sld-images/${sld}.png` : '/ghost-logo.png'}
              alt={sld ? `${sld}.gno` : 'GhostAgent'}
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
            <span className="text-lg">🪪</span>
            <h2 className="text-sm font-semibold text-amber-300">Identity Graph</h2>
          </div>
          <div className="space-y-2">
            {([
              { label: 'Agent Name',       value: identity?.name ?? String(name) },
              { label: 'Namespace',        value: identity?.identityNft?.tld ?? (sld ? `${sld}.gno` : '—') },
              { label: 'NFT',              value: identity?.identityNft?.name ?? '—' },
              { label: 'Safe Address',     value: identity?.safe ? shortAddr(identity.safe) : '—', href: identity?.safe ? `https://app.safe.global/home?safe=gno:${identity.safe}` : undefined, full: identity?.safe },
              { label: 'ERC-8004 (Gnosis)',value: identity?.erc8004?.gnosis ? `#${identity.erc8004.gnosis.agentId}` : '—' },
              { label: 'ERC-8004 (Base)',  value: identity?.erc8004?.base   ? `#${identity.erc8004.base.agentId}`   : '—' },
              { label: 'Agent URI',        value: identity?.erc8004?.gnosis?.agentURI ? '✓ set' : '—' },
              { label: 'NFTMail',          value: identity?.email ?? '—' },
            ] as Array<{ label: string; value: string; href?: string; full?: string }>).map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-[var(--muted)] shrink-0">{row.label}</span>
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
          </div>
        </div>

        {/* Safe & HITL */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🏦</span>
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
            <span className="text-lg">📡</span>
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
            <span className="text-lg">📬</span>
            <h2 className="text-sm font-semibold text-sky-300">Inbox &amp; IP</h2>
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">NFT token ID</span>
              <span className="font-mono text-zinc-300">{identity?.identityNft?.tokenId ?? '—'}</span>
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
              <span className="text-[var(--muted)]">Safe Modules</span>
              <a href={`https://app.safe.global/settings/modules?safe=gno:${identity?.safe ?? ''}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sky-400 hover:underline">Configure ↗</a>
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

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: '📬 Open Inbox',     href: '#inbox',   },
          { label: '🏛️ IP Portal',      href: '/ip-portal' },
          { label: '🔄 Molt',           href: '/molt' },
          { label: '📡 ERC-8004',       href: '#erc8004' },
          { label: '🏦 Safe Modules',   href: '#safe' },
        ].map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:text-white hover:border-white/20"
          >
            {a.label}
          </Link>
        ))}
      </div>

    </div>
  );
}
