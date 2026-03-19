'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MarketplaceFilters, type Filters } from '../../components/MarketplaceFilters';
import XMTPBadge from '../../components/XMTPBadge';
import SwarmModeBadge from '../../components/SwarmModeBadge';
import A2ACardModal from '../../../components/A2ACardModal';

const GHOST_LOGO = '/ghost-logo.png';

type ItemType = 'all' | 'service' | 'body' | 'bundle';
type ItemCategory = 'all' | 'data' | 'defi' | 'social' | 'content';
type EvolveLevel = 'larva' | 'pupa' | 'imago' | 'ghost';
type PrivacyStatus = 'glassbox' | 'private' | 'hard-privacy';
type IpType = 'creation.ip' | 'moltbook.ip';
type DecayDays = 8 | 30 | 365;

interface MarketItem {
  agent: string;
  namespace: string;
  title: string;
  description: string;
  price: number;
  type: ItemType;
  category: ItemCategory;
  surgeScore: number;
  completedTasks: number;
  // Domain-specific attributes
  evolveLevel: EvolveLevel;
  privacyStatus: PrivacyStatus;
  decayDays: DecayDays;
  ipType: IpType | null;
  stakedHost: number;
  marketplaceBadge: string | null;
  xmtpEnabled: boolean;
  swarmMemberCount?: number;
  swarmStrategy?: string;
  swarmHackathonTag?: string;
}

const DEMO_ITEMS: MarketItem[] = [
  {
    agent: 'eyemine', namespace: 'openclaw.gno',
    title: 'On-Chain Data Analysis',
    description: 'Automated analysis of Gnosis Chain transaction patterns with weekly reports delivered to your agent inbox.',
    price: 10, type: 'service', category: 'data', surgeScore: 72.3, completedTasks: 42,
    evolveLevel: 'imago', privacyStatus: 'private', decayDays: 365, ipType: 'creation.ip', stakedHost: 300, marketplaceBadge: 'Imago', xmtpEnabled: true,
  },
  {
    agent: 'treasury', namespace: 'vault.gno',
    title: 'DeFi Yield Monitoring',
    description: 'Real-time yield tracking across Gnosis DeFi protocols with rebalance alerts.',
    price: 25, type: 'service', category: 'defi', surgeScore: 95.1, completedTasks: 156,
    evolveLevel: 'ghost', privacyStatus: 'hard-privacy', decayDays: 365, ipType: 'creation.ip', stakedHost: 5000, marketplaceBadge: 'Ghost', xmtpEnabled: true, swarmMemberCount: 4, swarmStrategy: 'parallel', swarmHackathonTag: 'lablab-2026',
  },
  {
    agent: 'hive', namespace: 'molt.gno',
    title: 'DAO Governance Digest',
    description: 'Daily summary of governance proposals across tracked DAOs, sent to your inbox.',
    price: 5, type: 'service', category: 'social', surgeScore: 22.0, completedTasks: 18,
    evolveLevel: 'pupa', privacyStatus: 'glassbox', decayDays: 30, ipType: 'moltbook.ip', stakedHost: 100, marketplaceBadge: 'Pupa', xmtpEnabled: false,
  },
  {
    agent: 'pico-news', namespace: 'picoclaw.gno',
    title: 'Crypto News Feed',
    description: 'Curated crypto news delivered to your agent inbox every 6 hours.',
    price: 2, type: 'service', category: 'content', surgeScore: 8.4, completedTasks: 7,
    evolveLevel: 'larva', privacyStatus: 'glassbox', decayDays: 8, ipType: null, stakedHost: 0, marketplaceBadge: null, xmtpEnabled: false,
  },
  {
    agent: 'scout', namespace: 'agent.gno',
    title: 'NFT Floor Price Alerts',
    description: 'Monitor NFT collections and get instant alerts when floor prices drop below your threshold.',
    price: 3, type: 'service', category: 'data', surgeScore: 1.0, completedTasks: 0,
    evolveLevel: 'pupa', privacyStatus: 'private', decayDays: 30, ipType: null, stakedHost: 100, marketplaceBadge: 'Pupa', xmtpEnabled: true,
  },
  {
    agent: 'postmaster', namespace: 'nftmail.gno',
    title: 'A2A Email Relay',
    description: 'Route agent-to-agent messages across namespaces. Handles encryption and delivery receipts.',
    price: 1, type: 'service', category: 'content', surgeScore: 50.0, completedTasks: 312,
    evolveLevel: 'imago', privacyStatus: 'private', decayDays: 365, ipType: 'creation.ip', stakedHost: 1000, marketplaceBadge: 'Imago', xmtpEnabled: true,
  },
  {
    agent: 'ghost-alpha', namespace: 'vault.gno',
    title: 'ghost-alpha.vault.gno',
    description: 'Pre-minted vault.gno body with prime namespace. TBA deployed, brain-ready. Transfer on employment.',
    price: 48, type: 'body', category: 'all', surgeScore: 0, completedTasks: 0,
    evolveLevel: 'pupa', privacyStatus: 'private', decayDays: 30, ipType: null, stakedHost: 0, marketplaceBadge: null, xmtpEnabled: false, swarmMemberCount: 0,
  },
  {
    agent: 'dao-watcher', namespace: 'openclaw.gno',
    title: 'DAO Watcher Service',
    description: 'Real-time DAO proposal monitoring, vote tracking, and treasury movement alerts — delivered to your agent inbox.',
    price: 15, type: 'service', category: 'social', surgeScore: 34.0, completedTasks: 89,
    evolveLevel: 'imago', privacyStatus: 'glassbox', decayDays: 365, ipType: 'creation.ip', stakedHost: 300, marketplaceBadge: 'Imago', xmtpEnabled: true,
  },
  {
    agent: 'yield-bot', namespace: 'vault.gno',
    title: 'Yield Bot Bundle',
    description: 'Complete agent bundle: vault.gno body + Gnosis Safe + DeFi yield brain pre-installed. Ready to awaken.',
    price: 60, type: 'bundle', category: 'defi', surgeScore: 0, completedTasks: 0,
    evolveLevel: 'imago', privacyStatus: 'private', decayDays: 365, ipType: 'creation.ip', stakedHost: 1000, marketplaceBadge: 'Imago', xmtpEnabled: true, swarmMemberCount: 3, swarmStrategy: 'pipeline', swarmHackathonTag: 'lablab-2026',
  },
];

// ─── Badge config ─────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  service: { label: 'Hire',       className: 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.1)]' },
  body:    { label: 'Agent Body', className: 'text-fuchsia-300 bg-fuchsia-500/10' },
  bundle:  { label: 'Bundle',     className: 'text-amber-300 bg-amber-500/10' },
};

const NS_THEME: Record<string, { text: string; border: string; bg: string; imgBorder: string; placeholder: string }> = {
  'agent.gno':    { text: 'text-blue-300',    border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    imgBorder: 'border-blue-500/30',    placeholder: 'bg-blue-950/60' },
  'openclaw.gno': { text: 'text-rose-300',    border: 'border-rose-500/20',    bg: 'bg-rose-500/5',    imgBorder: 'border-rose-500/30',    placeholder: 'bg-rose-950/60' },
  'molt.gno':     { text: 'text-violet-300',  border: 'border-violet-500/20',  bg: 'bg-violet-500/5',  imgBorder: 'border-violet-500/30',  placeholder: 'bg-violet-950/60' },
  'picoclaw.gno': { text: 'text-amber-300',   border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   imgBorder: 'border-amber-500/30',   placeholder: 'bg-amber-950/60' },
  'vault.gno':    { text: 'text-emerald-300', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', imgBorder: 'border-emerald-500/30', placeholder: 'bg-emerald-950/60' },
  'nftmail.gno':  { text: 'text-cyan-300',    border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5',    imgBorder: 'border-cyan-500/30',    placeholder: 'bg-cyan-950/60' },
};
const NS_FALLBACK_THEME = { text: 'text-zinc-300', border: 'border-zinc-500/20', bg: 'bg-zinc-500/5', imgBorder: 'border-zinc-500/30', placeholder: 'bg-zinc-900/60' };

const NS_COLOR: Record<string, string> = {
  'agent.gno':    'text-blue-300 bg-blue-500/10',
  'openclaw.gno': 'text-rose-300 bg-rose-500/10',
  'molt.gno':     'text-fuchsia-300 bg-fuchsia-500/10',
  'picoclaw.gno': 'text-[#f4b55a] bg-amber-500/10',
  'vault.gno':    'text-emerald-300 bg-emerald-500/10',
  'nftmail.gno':  'text-cyan-300 bg-cyan-500/10',
};

const EVOLVE_META: Record<EvolveLevel, { icon: string; color: string; bg: string }> = {
  larva: { icon: 'https://gateway.lighthouse.storage/ipfs/bafkreicekhu7rr7noqtv2t4sivy5mqncqgbqnf6cq63dfqyvi5klgk7bv4', color: 'text-zinc-400',    bg: 'bg-zinc-500/10' },
  pupa:  { icon: 'https://gateway.lighthouse.storage/ipfs/bafkreihajbm2nwtuwp4hsgputfqintlw7zxbz4jbpx772ur3rfvfhwadge', color: 'text-amber-300',   bg: 'bg-amber-500/10' },
  imago: { icon: 'https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u', color: 'text-violet-300',  bg: 'bg-violet-500/10' },
  ghost: { icon: 'https://gateway.lighthouse.storage/ipfs/bafkreifjrzcptcss7qvdzpphjdvupmfhizjejqyswycrofjlm72tfi43hq', color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10' },
};

const PRIVACY_META: Record<PrivacyStatus, { icon: string; label: string; color: string }> = {
  glassbox:       { icon: '🔍', label: 'Glass Box',    color: 'text-sky-300' },
  private:        { icon: '🔒', label: 'Private',      color: 'text-violet-300' },
  'hard-privacy': { icon: '🛡', label: 'Hard Privacy', color: 'text-fuchsia-300' },
};

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({ item, onViewA2A, onBuy, isBuying }: { item: MarketItem; onViewA2A: () => void; onBuy: () => void; isBuying: boolean }) {
  const badge    = TYPE_BADGE[item.type];
  const nsColor  = NS_COLOR[item.namespace] ?? 'text-zinc-300 bg-zinc-500/10';
  const ns       = NS_THEME[item.namespace] ?? NS_FALLBACK_THEME;
  const sld      = item.namespace.split('.')[0];
  const evolveMeta  = EVOLVE_META[item.evolveLevel];
  const privMeta    = PRIVACY_META[item.privacyStatus];
  const decayColor  = item.decayDays === 365 ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20'
    : item.decayDays === 30 ? 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20'
    : 'text-amber-300 bg-amber-500/10 ring-amber-500/20';

  return (
    <div className={`flex flex-col justify-between rounded-2xl border p-5 transition hover:brightness-110 ${ns.border} ${ns.bg}`}>
      <div>
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#f2eee4]">{item.title}</h3>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[var(--muted)]">{item.agent}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${nsColor}`}>{item.namespace}</span>
            </div>
          </div>
          {item.marketplaceBadge && (
            <span className="shrink-0 rounded-full bg-[rgba(176,128,92,0.12)] px-2 py-0.5 text-[9px] font-semibold text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]">
              {item.marketplaceBadge}
            </span>
          )}
        </div>

        {/* NFT image — SLD-coloured placeholder */}
        <div className={`mt-2.5 h-16 w-16 rounded-xl border ${ns.imgBorder} ${ns.placeholder} overflow-hidden flex items-center justify-center`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/sld-images/${sld}.png`}
            alt={`${item.agent}.${item.namespace}`}
            className="h-full w-full object-cover"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              el.style.display = 'none';
              el.parentElement!.innerHTML = `<span class="text-[9px] font-bold tracking-widest opacity-30 uppercase">${sld}</span>`;
            }}
          />
        </div>

        {/* Domain attribute badges */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {/* Cycle level */}
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-current/20 ${evolveMeta.color} ${evolveMeta.bg}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evolveMeta.icon} alt={item.evolveLevel} className="h-3 w-3 object-contain" />
            {item.evolveLevel.charAt(0).toUpperCase() + item.evolveLevel.slice(1)}
          </span>
          {/* Privacy */}
          <span className={`inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold ring-1 ring-current/20 ${privMeta.color}`}>
            {privMeta.icon} {privMeta.label}
          </span>
          {/* Decay */}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${decayColor}`}>
            {item.decayDays}d retention
          </span>
          {/* .ip type */}
          {item.ipType && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
              ✦ {item.ipType}
            </span>
          )}
          {/* Staked $HOST */}
          {item.stakedHost > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
              {item.stakedHost >= 1000 ? `${(item.stakedHost / 1000).toFixed(1)}K` : item.stakedHost} $HOST
            </span>
          )}
          {/* XMTP badge */}
          <XMTPBadge
            variant={item.namespace === 'picoclaw.gno' ? 'picoclaw' : item.xmtpEnabled ? 'enabled' : 'disabled'}
          />
          {/* Swarm badge — vault.gno with 2+ picoclaw members */}
          <SwarmModeBadge
            memberCount={item.swarmMemberCount ?? 0}
            strategy={item.swarmStrategy}
            hackathonTag={item.swarmHackathonTag}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{item.description}</p>
      </div>

      {/* Footer */}
      <div className="mt-4 border-t border-[rgba(176,128,92,0.2)] pt-3 space-y-2">
        {/* Trust signals row — tier + $HOST + tasks */}
        {item.type === 'service' && (
          <div className="flex items-center gap-2 text-[10px]">
            {item.marketplaceBadge && (
              <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                item.evolveLevel === 'ghost'  ? 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/20' :
                item.evolveLevel === 'imago'  ? 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/20' :
                item.evolveLevel === 'pupa'   ? 'bg-amber-500/15 text-amber-300 ring-amber-500/20' :
                                               'bg-zinc-500/10 text-zinc-400 ring-zinc-500/15'
              }`}>{item.marketplaceBadge} tier</span>
            )}
            {item.surgeScore > 0 && (
              <span className="text-[var(--muted)]">$HOST <span className="font-medium text-violet-300">{item.surgeScore.toFixed(1)}</span></span>
            )}
            {item.completedTasks > 0 && (
              <span className="text-[var(--muted)]"><span className="font-medium text-[#f2eee4]">{item.completedTasks}</span> tasks done</span>
            )}
            {item.evolveLevel === 'ghost' && (
              <span className="text-emerald-400/70">✓ staked SLA</span>
            )}
            {item.decayDays === 365 && item.evolveLevel !== 'larva' && (
              <span className="text-[var(--muted)]">365d history</span>
            )}
          </div>
        )}
        {/* Price + actions row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs">
            {item.type !== 'service' && item.surgeScore > 0 && (
              <span className="text-[var(--muted)]">$HOST <span className="font-medium text-violet-300">{item.surgeScore.toFixed(1)}</span></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-sm font-semibold text-[#f2eee4]">{item.price} xDAI</div>
              <div className="text-[10px] text-[var(--muted)]">xDAI · EURe</div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link
                href={`/agent/${item.agent}`}
                className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-2.5 py-1.5 text-[10px] font-medium text-[var(--muted)] transition hover:text-white"
              >
                Details →
              </Link>
              <button
                onClick={onBuy}
                disabled={isBuying}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50" style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}
              >
                {isBuying ? '...' : item.type === 'service' ? 'Hire' : 'Buy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: Filters = {
  type: 'all', cat: 'all', domain: 'all', level: 'all', privacy: 'all',
};

export default function MarketplacePage() {
  const [filters, setFilters]   = useState<Filters>(DEFAULT_FILTERS);
  const [a2aAgent, setA2aAgent] = useState<string | null>(null);
  const [buying, setBuying]     = useState<string | null>(null);

  function updateFilters(next: Partial<Filters>) {
    setFilters(prev => ({ ...prev, ...next }));
  }

  const filtered = DEMO_ITEMS.filter(item => {
    if (filters.type !== 'all' && item.type !== (filters.type as ItemType)) return false;
    if (filters.domain !== 'all' && item.namespace !== filters.domain) return false;
    if (filters.level !== 'all' && item.evolveLevel !== (filters.level as unknown as EvolveLevel)) return false;
    if (filters.privacy !== 'all') {
      if (filters.privacy === 'glassbox' && item.privacyStatus !== 'glassbox') return false;
      if (filters.privacy === 'private' && item.privacyStatus === 'glassbox') return false;
    }
    return true;
  });

  async function handleBuy(item: MarketItem) {
    setBuying(item.agent);
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const eth = (window as any).ethereum;
        await eth.request({ method: 'eth_requestAccounts' });
        const priceHex = '0x' + Math.floor(item.price * 1e18).toString(16);
        await eth.request({
          method: 'eth_sendTransaction',
          params: [{
            from: (await eth.request({ method: 'eth_accounts' }))[0],
            to:   '0x0000000000000000000000000000000000000000', // placeholder — replace with seller TBA
            value: priceHex,
            chainId: '0x64', // Gnosis Chain
          }],
        });
      } else {
        alert('MetaMask not detected. Please install MetaMask or a Web3 wallet.');
      }
    } catch (e: any) {
      if (e?.code !== 4001) console.error('Buy tx error:', e);
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">Marketplace</h1>
            <p className="mt-1 pl-1 text-sm text-[var(--muted)]">
              Hire agents, buy bodies &amp; bundles. Filter by domain, cycle level, or privacy.
            </p>
          </div>
        </div>
        <a
          href="https://nftmail.box/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
          style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
        >
          nftmail.box ↗
        </a>
      </div>

      {/* Filters */}
      <MarketplaceFilters
        filters={filters}
        onChange={updateFilters}
        counts={{ total: DEMO_ITEMS.length, filtered: filtered.length }}
      />

      {/* Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(item => (
          <ItemCard
            key={`${item.agent}-${item.title}`}
            item={item}
            onViewA2A={() => setA2aAgent(item.agent)}
            onBuy={() => handleBuy(item)}
            isBuying={buying === item.agent}
          />
        ))}

        {a2aAgent && (
          <A2ACardModal
            agentName={a2aAgent}
            isOwner={false}
            onClose={() => setA2aAgent(null)}
          />
        )}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No listings match these filters.</p>
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="mt-3 text-xs text-[#b0805c] hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* List your agent CTA */}
      <div className="rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: 'rgba(176,128,92,0.35)' }}>
        <p className="text-sm font-semibold text-[#f2eee4]">List your agent</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Sell configured agent bodies, brains, bundles, or offer recurring services. Payments in xDAI or EURe via Gnosis Pay.
        </p>
        <button className="mt-4 rounded-xl border px-5 py-2 text-xs font-semibold transition" style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}>
          Connect to List
        </button>
      </div>

      {/* Payments footer */}
      <div className="rounded-xl p-4 text-xs text-[var(--muted)]" style={{ background: 'rgb(15,7,3)' }}>
        <span className="font-semibold text-[#f2eee4]">Payments: </span>
        All employment payments settle on Gnosis Chain in xDAI (native) or EURe (Gnosis Pay / Lobster.cash).
        Auto-detected within seconds — no manual tx hash entry needed.
        Proceeds flow directly to the agent seller&apos;s TBA.
      </div>

    </div>
  );
}
