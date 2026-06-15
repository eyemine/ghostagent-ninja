'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

const GHOST_LOGO = '/ghost-logo.png';

type AgentTier = 'basic' | 'lite' | 'premium' | 'ghost';
type BrainType = 'CF Worker' | 'Safe Brain' | 'GlassBox';

const TIER_LABEL: Record<string, string> = {
  basic:   'Basic',
  lite:    'Pro',
  premium: 'Premium',
  ghost:   'Ghost',
};

interface DemoAgent {
  name: string;
  namespace: string;
  tba: string;
  tier: AgentTier;
  hostScore: number;
  inbox: number;
  events: number;
  active: boolean;
  ipDomain?: string;
  brainType?: BrainType;
  imageUrl?: string;
  principal?: string;
  safeAddress?: string;  // Safe address for BYO NFT molts (Safe-first architecture)
}

interface DemoBody {
  name: string;
  namespace: string;
  tokenId: number;
  tba: string;
  minted: string;
}

interface LiveBrain {
  agent: string;
  type: BrainType;
  endpoint: string;
  installed: string;
}

interface LiveBody {
  name: string;
  namespace: string;
  tokenId: number;
  tba: string;
  minted: string;
  safeAddress?: string;
  tbaAddress?: string;
  imageUrl?: string;
}

const DEMO_AGENTS: DemoAgent[] = [
  {
    name: 'eyemine',
    namespace: 'openclaw.gno',
    tba: '0xb7e4...af13',
    tier: 'lite',
    hostScore: 72.3,
    inbox: 12,
    events: 3,
    active: true,
    ipDomain: 'eyemine.creation.ip',
  },
  {
    name: 'treasury',
    namespace: 'vault.gno',
    tba: '0xd4e5...d4e5',
    tier: 'premium',
    hostScore: 95.1,
    inbox: 47,
    events: 8,
    active: true,
    ipDomain: 'treasury.creation.ip',
  },
  {
    name: 'hive',
    namespace: 'molt.gno',
    tba: '0xc3d4...c3d4',
    tier: 'basic',
    hostScore: 22.0,
    inbox: 6,
    events: 1,
    active: true,
    brainType: 'GlassBox',
  },
];

// DEMO_BODIES removed - now fetching real NFT data via /api/my-nfts


const NS_THEME: Record<string, { text: string; border: string; bg: string; selBorder: string; selBg: string; imgBorder: string; placeholder: string }> = {
  'agent.gno':    { text: 'text-blue-300',    border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    selBorder: 'border-blue-400/50',    selBg: 'bg-blue-500/10',    imgBorder: 'border-blue-500/30',    placeholder: 'bg-blue-950/60' },
  'openclaw.gno': { text: 'text-rose-300',    border: 'border-rose-500/20',    bg: 'bg-rose-500/5',    selBorder: 'border-rose-400/50',    selBg: 'bg-rose-500/10',    imgBorder: 'border-rose-500/30',    placeholder: 'bg-rose-950/60' },
  'molt.gno':     { text: 'text-violet-300',  border: 'border-violet-500/20',  bg: 'bg-violet-500/5',  selBorder: 'border-violet-400/50',  selBg: 'bg-violet-500/10',  imgBorder: 'border-violet-500/30',  placeholder: 'bg-violet-950/60' },
  'picoclaw.gno': { text: 'text-amber-300',   border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   selBorder: 'border-amber-400/50',   selBg: 'bg-amber-500/10',   imgBorder: 'border-amber-500/30',   placeholder: 'bg-amber-950/60' },
  'vault.gno':    { text: 'text-emerald-300', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', selBorder: 'border-emerald-400/50', selBg: 'bg-emerald-500/10', imgBorder: 'border-emerald-500/30', placeholder: 'bg-emerald-950/60' },
  'nftmail.gno':  { text: 'text-cyan-300',    border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5',    selBorder: 'border-cyan-400/50',    selBg: 'bg-cyan-500/10',    imgBorder: 'border-cyan-500/30',    placeholder: 'bg-cyan-950/60' },
};
const NS_FALLBACK = { text: 'text-zinc-400', border: 'border-zinc-500/20', bg: 'bg-zinc-500/5', selBorder: 'border-zinc-400/50', selBg: 'bg-zinc-500/10', imgBorder: 'border-zinc-500/30', placeholder: 'bg-zinc-900/60' };

function HeartbeatDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </span>
  );
}

function AgentCard({ agent, onSelect, selected }: { agent: DemoAgent; onSelect: () => void; selected: boolean }) {
  const ns  = NS_THEME[agent.namespace] ?? NS_FALLBACK;
  const sld = agent.namespace.split('.')[0];
  return (
    <div
      onClick={onSelect}
      className={`flex flex-col justify-between rounded-2xl border p-5 cursor-pointer transition-all ${
        selected
          ? `${ns.selBorder} ${ns.selBg} ring-1 ring-current/10`
          : `${ns.border} ${ns.bg} hover:brightness-110`
      }`}
    >
      {/* NFT image + identity row */}
      <div className="flex gap-3">
        {/* NFT image — real agent card image or SLD-coloured placeholder */}
        <div className={`w-1/2 shrink-0 aspect-square rounded-xl border ${ns.imgBorder} ${ns.placeholder} overflow-hidden flex items-center justify-center`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={agent.imageUrl ?? `/sld-images/${sld}.png`}
            alt={`${agent.name}.${agent.namespace}`}
            className="h-full w-full object-cover"
            onError={(e) => {
              const el = e.target as HTMLImageElement;
              if (agent.imageUrl && el.src !== `/sld-images/${sld}.png`) {
                el.src = `/sld-images/${sld}.png`;
              } else {
                el.style.display = 'none';
                el.parentElement!.innerHTML = `<span class="text-[9px] font-bold tracking-widest opacity-30 uppercase">${sld}</span>`;
              }
            }}
          />
        </div>

        {/* Identity — domain + tba + badges */}
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <HeartbeatDot active={agent.active} />
              <span className="text-sm font-semibold text-[#f2eee4] truncate">{agent.name}</span>
            </div>
            <span className={`text-[11px] font-medium ${ns.text}`}>{agent.namespace}</span>
            {agent.safeAddress ? (
              <code className="mt-1 block truncate text-[10px] text-emerald-300/70">Safe: {agent.safeAddress.slice(0, 6)}…{agent.safeAddress.slice(-4)}</code>
            ) : (
              <code className="mt-1 block truncate text-[10px] text-[var(--muted)]">{agent.tba}</code>
            )}
            {agent.principal && (
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[9px] text-[var(--muted)]">Principal:</span>
                <code className="truncate text-[10px] text-amber-300/70">{agent.principal.slice(0, 6)}…{agent.principal.slice(-4)}</code>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ring-1 ${
              agent.tier === 'ghost' ? 'bg-purple-500/15 text-purple-300 ring-purple-500/30' :
              agent.tier === 'premium' ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30' :
              agent.tier === 'lite' ? 'bg-violet-500/15 text-violet-300 ring-violet-500/30' :
              'bg-zinc-500/15 text-zinc-400 ring-zinc-500/20'
            }`}>
              {TIER_LABEL[agent.tier] ?? agent.tier.toUpperCase()}
            </span>
            {agent.ipDomain && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-medium text-emerald-300 ring-1 ring-emerald-500/20 truncate max-w-full">
                {agent.ipDomain}
              </span>
            )}
            {agent.brainType && (
              <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] font-medium text-sky-300 ring-1 ring-sky-500/20">
                {agent.brainType}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: '$HOST', value: agent.hostScore.toFixed(1), color: 'text-violet-300' },
          { label: 'INBOX', value: agent.inbox, color: 'text-[#f2eee4]' },
          { label: 'EVENTS', value: agent.events, color: 'text-[#f2eee4]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/20 px-2.5 py-2">
            <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{label}</div>
            <div className={`mt-0.5 text-sm font-medium ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Basic tier warning */}
      {agent.tier === 'basic' && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span className="text-[10px] text-amber-300/80">Basic tier — 8-day history window. Molt to Pro for persistent storage + IP protection.</span>
        </div>
      )}
      {selected && (
        <div className="mt-3 flex items-center justify-between">
          <span className={`text-[10px] font-medium ${ns.text} opacity-70`}>✓ selected</span>
          <Link
            href={`/dashboard/agent/${agent.name}?sld=${sld}`}
            onClick={e => e.stopPropagation()}
            className={`rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition ${ns.border} ${ns.text} hover:brightness-125`}
          >
            Details →
          </Link>
        </div>
      )}
    </div>
  );
}

function AgentCardSkeleton({ name }: { name: string }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-zinc-700/30 bg-zinc-800/10 p-5 animate-pulse">
      <div className="flex gap-3">
        <div className="w-1/2 shrink-0 aspect-square rounded-xl bg-zinc-800/60" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 w-3/4 rounded bg-zinc-700/60" />
          <div className="h-2.5 w-1/2 rounded bg-zinc-700/40" />
          <div className="h-2 w-2/3 rounded bg-zinc-700/30" />
          <div className="mt-3 flex gap-1">
            <div className="h-4 w-10 rounded-full bg-zinc-700/40" />
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-lg border border-zinc-700/20 bg-black/20 px-2.5 py-2">
            <div className="h-2 w-8 rounded bg-zinc-700/40 mb-1.5" />
            <div className="h-4 w-6 rounded bg-zinc-700/30" />
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-[10px] text-zinc-600 animate-pulse">{name}</div>
    </div>
  );
}

type ActionHref = ((n: string, extra?: string) => string) | (() => string);

const AGENT_ACTIONS = [
  { key: 'agent-profile', label: 'Agent Profile', href: (n: string) => `/dashboard/agent-profile?agent=${n}`, color: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' },
  { key: 'molt',          label: 'Molt',          href: (n: string) => `/molt?agent=${n}`,                    color: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20' },
  { key: 'ghost-tier',    label: 'Ghost Tier',    href: (n: string) => `/dashboard/settings/ghost?agent=${n}`,color: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20' },
  { key: 'delegate-nft',  label: 'Delegate NFT',  href: () => '/dashboard/delegate',                          color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
  { key: 'erc8048',       label: 'ERC-8048',      href: (n: string) => `/dashboard/erc8048?agent=${n}`,        color: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20' },
  { key: 'swarm',         label: 'Swarm',         href: (n: string) => `/dashboard/swarm?agent=${n}`,         color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
  { key: 'trade',         label: 'Trade Intent',  href: (n: string) => `/dashboard/trade?agent=${n}`,         color: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' },
  { key: 'hitl',          label: 'HITL Gates',    href: (n: string) => `/dashboard/hitl?agent=${n}`,          color: 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' },
  { key: 'ip-portal',     label: 'IP Portal',     href: (n: string, sld?: string) => `/ip-portal?agent=${n}${sld ? `&sld=${sld}` : ''}`, color: 'border-[#7c4dff]/30 bg-[#7c4dff]/10 text-[#a78bfa] hover:bg-[#7c4dff]/20' },
] as Array<{ key: string; label: string; href: ActionHref; color: string }>;

const BODY_ACTIONS = [
  { key: 'install-brain', label: 'Install Brain', href: (n: string) => `/dashboard/install-brain?body=${n}`, color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
  { key: 'molt',          label: 'Molt',          href: (n: string) => `/molt?body=${n}`,                    color: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20' },
];

const BRAIN_ACTIONS = [
  { key: 'create-brain',   label: 'Create Brain',   href: (_n: string) => `/dashboard/install-brain`,  color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
  { key: 'create-service', label: 'Create Service', href: (_n: string) => `/dashboard/create-service`, color: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' },
];

export default function DashboardHome() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  // agent loading: null = not started, [] = loading-started
  type AgentEntry = { name: string; tld: string | null; data: DemoAgent | null };
  const [agentEntries, setAgentEntries]   = useState<AgentEntry[] | null>(null);
  const loadingWallet = useRef<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedBody,  setSelectedBody]  = useState<string>('');
  const [selectedBrain, setSelectedBrain] = useState<string>('');
  const [liveBodies, setLiveBodies] = useState<LiveBody[] | null>(null);
  const [liveBrains, setLiveBrains] = useState<LiveBrain[] | null>(null);
  const [bodiesLoading, setBodiesLoading] = useState(false);
  const [brainsLoading, setBrainsLoading] = useState(false);

  // Fetch agents — skeleton-first progressive loading
  useEffect(() => {
    if (!connectedWallet) { setAgentEntries(null); return; }
    loadingWallet.current = connectedWallet;
    setAgentEntries([]);   // triggers skeleton state

    fetch('/api/agents', { signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() as Promise<{ agents?: Array<{ name: string; tld: string | null }> }> : Promise.reject())
      .then((data) => {
        if (loadingWallet.current !== connectedWallet) return;
        const allAgents = data.agents ?? [];
        // Show a skeleton slot for every agent immediately
        setAgentEntries(allAgents.map(a => ({ name: a.name, tld: a.tld, data: null })));

        // Independently resolve each agent — fill in cards as they arrive
        allAgents.forEach(async (a) => {
          try {
            const idRes = await fetch(`/api/agent-lookup?q=${a.name}`, { signal: AbortSignal.timeout(5000) });
            if (!idRes.ok) throw new Error('identity fetch failed');
            const identity = await idRes.json() as {
              onChainOwner?: string;
              identityNft?: { owner?: string; tld?: string | null; name?: string | null } | null;
              principal?: string | null;
              safe?: string | null;
              safeAddress?: string | null;
              tbaAddress?: string | null;
              accountTier?: string;
            };

            // Ownership check — drop agent if wallet doesn't match any candidate
            const owner    = identity.onChainOwner ?? identity.identityNft?.owner ?? null;
            const ctrl     = identity.principal ?? null;
            const safeAddr = identity.safeAddress ?? identity.safe ?? null;
            const isOwner  = [owner, ctrl, safeAddr]
              .filter(Boolean)
              .some(c => c!.toLowerCase() === connectedWallet.toLowerCase());
            if (!isOwner) {
              setAgentEntries(prev => prev?.filter(e => e.name !== a.name) ?? null);
              return;
            }

            // Derive namespace: prefer stored tld, then parse identityNft.name, then fall back
            const nftName  = identity.identityNft?.name ?? '';
            const namespace =
              identity.identityNft?.tld ??
              (nftName ? nftName.replace(/^[^.]+\./, '') : null) ??
              a.tld ?? 'nftmail.gno';

            const tierRaw = (identity.accountTier ?? 'basic').toLowerCase();
            const tier: AgentTier = (['basic', 'lite', 'premium', 'ghost'] as AgentTier[]).includes(tierRaw as AgentTier)
              ? (tierRaw as AgentTier) : 'basic';

            const basicCard: DemoAgent = {
              name:        a.name,
              namespace,
              tba:         identity.tbaAddress ?? safeAddr ?? connectedWallet,
              safeAddress: safeAddr ?? undefined,
              tier,
              hostScore:   0,
              inbox:       0,
              events:      0,
              active:      true,
              principal:   identity.principal ?? identity.identityNft?.owner ?? undefined,
            };

            // Immediately show basic card (no image yet)
            setAgentEntries(prev => {
              const updated = prev?.map(e => e.name === a.name ? { ...e, data: basicCard } : e) ?? null;
              // Auto-select first resolved agent
              if (updated && !selectedAgent) {
                const first = updated.find(e => e.data !== null);
                if (first) setSelectedAgent(first.name);
              }
              return updated;
            });

            // Enrich with image + authoritative tier in background
            const [cardRes, lookupRes] = await Promise.allSettled([
              fetch(`/api/agent-card?agent=${a.name}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }),
              fetch(`/api/agent-lookup?q=${a.name}`, { signal: AbortSignal.timeout(10000) }),
            ]);
            let imageUrl: string | undefined;
            let lookupTier: string | null = null;
            if (cardRes.status === 'fulfilled' && cardRes.value.ok) {
              const card = await cardRes.value.json() as { image?: string };
              if (card.image) imageUrl = card.image;
            }
            if (lookupRes.status === 'fulfilled' && lookupRes.value.ok) {
              const lu = await lookupRes.value.json() as { accountTier?: string };
              if (lu.accountTier) lookupTier = lu.accountTier;
            }
            const finalTierRaw = (lookupTier ?? tierRaw).toLowerCase();
            const finalTier: AgentTier = (['basic', 'lite', 'premium', 'ghost'] as AgentTier[]).includes(finalTierRaw as AgentTier)
              ? (finalTierRaw as AgentTier) : tier;

            setAgentEntries(prev => prev?.map(e =>
              e.name === a.name && e.data
                ? { ...e, data: { ...e.data, imageUrl, tier: finalTier } }
                : e
            ) ?? null);
          } catch {
            setAgentEntries(prev => prev?.filter(e => e.name !== a.name) ?? null);
          }
        });
      })
      .catch(() => setAgentEntries([]));
  }, [connectedWallet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch bodies = beacon NFTs (real on-chain data)
  useEffect(() => {
    if (!connectedWallet) { setLiveBodies(null); return; }
    setBodiesLoading(true);
    fetch(`/api/my-nfts?wallet=${connectedWallet}`)
      .then(r => r.json() as Promise<{ nfts?: LiveBody[] }>)
      .then(data => {
        const bodies = data.nfts ?? [];
        setLiveBodies(bodies);
        if (bodies.length > 0 && !selectedBody) {
          setSelectedBody(bodies[0].name);
        }
      })
      .catch(() => setLiveBodies([]))
      .finally(() => setBodiesLoading(false));
  }, [connectedWallet, selectedBody]);

  // Fetch brains = installed brain modules (from worker by wallet)
  useEffect(() => {
    if (!connectedWallet) { setLiveBrains(null); return; }
    setBrainsLoading(true);
    // TODO: Replace with real brain registry API that filters by wallet
    // For now, return empty until we have real brain data
    setLiveBrains([]);
    setBrainsLoading(false);
  }, [connectedWallet]);

  // Derive display lists from agentEntries
  const resolvedAgents = agentEntries?.filter(e => e.data !== null).map(e => e.data as DemoAgent) ?? [];
  const skeletonNames  = agentEntries?.filter(e => e.data === null).map(e => e.name) ?? [];
  const agentsLoading  = agentEntries !== null && agentEntries.length === 0;
  const isDemo         = agentEntries === null;
  const agents         = isDemo ? DEMO_AGENTS : resolvedAgents;
  const bodies = liveBodies ?? [];
  const brains = liveBrains ?? [];

  // Exclude bodies that already appear as agents in the My Agents section
  const agentNames = new Set(agents.map(a => a.name));
  const orphanBodies = bodies.filter(body =>
    !agentNames.has(body.name) && !brains.some(brain => brain.agent === body.name)
  );
  const orphanBrains = brains.filter(brain =>
    !bodies.some(body => body.name === brain.agent)
  );

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-36 w-36 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">My Agents</h1>
            <p className="pl-1 mt-0.5 text-xs text-[var(--muted)]">Fully-rigged Agents – Mirror Bodies with Brains installed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/nftmail"
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
            style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
          >
            nftmail.box [for-agents] →
          </Link>
        </div>
      </div>

      {/* Agent Cards — 3-col grid */}
      {!authenticated ? (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] px-6 py-12 text-center space-y-2">
          <p className="text-sm text-[var(--muted)]">Connect your wallet to see your agents.</p>
        </div>
      ) : agentsLoading ? (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.15)] bg-[rgba(176,128,92,0.03)] px-6 py-12 text-center">
          <p className="text-sm text-[var(--muted)] animate-pulse">Looking up your agents…</p>
        </div>
      ) : agents.length === 0 && skeletonNames.length === 0 ? (
        <div className="rounded-2xl border border-zinc-700/30 bg-zinc-800/10 px-6 py-12 text-center space-y-2">
          <p className="text-sm text-[var(--muted)]">No agents found for this wallet.</p>
          <p className="text-xs text-zinc-600">Agent ownership is determined by the Beacon NFT. Connect the EOA wallet holding the NFT.</p>
        </div>
      ) : (
        <>
          {isDemo && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-300">
              ⚠ Showing demo data — connect wallet to see your agents
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                selected={selectedAgent === agent.name}
                onSelect={() => setSelectedAgent(agent.name)}
              />
            ))}
            {skeletonNames.map(name => (
              <AgentCardSkeleton key={name} name={name} />
            ))}
          </div>
        </>
      )}

      {/* ── Agent Action Bar ── */}
      {selectedAgent && (
      <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">ACTIONS FOR</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
            {selectedAgent}
          </span>
          <span className="text-[10px] text-zinc-600">select agent card to action</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {AGENT_ACTIONS.map(action => {
            const selectedAgentData = agents.find(a => a.name === selectedAgent);
            const sld = selectedAgentData?.namespace?.replace(/\.gno$/, '') ?? '';
            const href = action.key === 'byo-nft'
              ? (action.href as () => string)()
              : action.key === 'ip-portal'
              ? (action.href as (n: string, sld?: string) => string)(selectedAgent, sld)
              : (action.href as (n: string) => string)(selectedAgent);
            return (
            <Link
              key={action.key}
              href={href}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${action.color}`}
            >
              {action.label}
            </Link>
            );
          })}
        </div>
      </div>
      )}

      {/* MY BODIES separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">MY BODIES</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* My Bodies section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#f2eee4]">
            My Bodies {bodiesLoading && <span className="text-xs text-[var(--muted)] ml-2">Loading...</span>}
          </h2>
          <Link href="/agents?tab=mint" className="text-xs text-[var(--muted)] transition hover:text-white">
            Mint Agent Body →
          </Link>
        </div>
        {!authenticated ? (
          <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] px-6 py-8 text-center">
            <p className="text-sm text-[var(--muted)]">Connect your wallet to see your bodies.</p>
          </div>
        ) : bodiesLoading ? (
          <div className="rounded-2xl border border-[rgba(176,128,92,0.15)] bg-[rgba(176,128,92,0.03)] px-6 py-8 text-center">
            <p className="text-sm text-[var(--muted)] animate-pulse">Loading your bodies…</p>
          </div>
        ) : orphanBodies.length === 0 ? (
          <div className="rounded-2xl border border-zinc-700/30 bg-zinc-800/10 px-6 py-8 text-center space-y-1">
            <p className="text-sm text-[var(--muted)]">No unpaired bodies found.</p>
            <p className="text-xs text-zinc-600">Bodies are beacon NFTs not yet paired with a brain.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(176,128,92,0.2)]">
                  {['NAME', 'NAMESPACE', 'TOKEN ID', 'TBA', 'MINTED'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold tracking-wider text-[var(--muted)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orphanBodies.map((body, i) => {
                  const nsColor = (NS_THEME[body.namespace] ?? NS_FALLBACK).text;
                  return (
                    <tr
                      key={body.name}
                      onClick={() => setSelectedBody(body.name)}
                      className={`cursor-pointer transition ${
                        selectedBody === body.name ? 'bg-amber-500/5' : 'hover:bg-white/[0.02]'
                      } ${i < orphanBodies.length - 1 ? 'border-b border-[rgba(176,128,92,0.15)]' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-[#f2eee4]">{body.name}</td>
                      <td className={`px-4 py-3 text-xs font-medium ${nsColor}`}>{body.namespace}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">#{body.tokenId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{body.tba}</td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">{body.minted}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Body Action Bar */}
      <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">BODY ACTIONS FOR</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
            {selectedBody || '—'}
          </span>
          <span className="text-[10px] text-zinc-600">select body row to action</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {BODY_ACTIONS.map(action => (
            <Link
              key={action.key}
              href={action.href(selectedBody)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${action.color}`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* MY BRAINS separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">MY BRAINS</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* My Brains section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#f2eee4]">
            My Brains {brainsLoading && <span className="text-xs text-[var(--muted)] ml-2">Loading...</span>}
          </h2>
          <Link href="/dashboard/install-brain" className="text-xs text-[var(--muted)] transition hover:text-white">
            Install Agent Brain →
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(176,128,92,0.2)]">
                {['AGENT', 'TYPE', 'ENDPOINT', 'INSTALLED'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold tracking-wider text-[var(--muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orphanBrains.map((brain, i) => (
                <tr
                  key={brain.agent}
                  onClick={() => setSelectedBrain(brain.agent)}
                  className={`cursor-pointer transition ${
                    selectedBrain === brain.agent ? 'bg-amber-500/5' : 'hover:bg-white/[0.02]'
                    } ${i < orphanBrains.length - 1 ? 'border-b border-[rgba(176,128,92,0.15)]' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-[#f2eee4]">{brain.agent}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/20">
                      {brain.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">{brain.endpoint}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">{brain.installed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Brain Action Bar */}
      <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">BRAIN ACTIONS FOR</span>
          <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-500/20">
            {selectedBrain}
          </span>
          <span className="text-[10px] text-zinc-600">select brain row to action</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {BRAIN_ACTIONS.map(action => (
            <Link
              key={action.key}
              href={action.href(selectedBrain)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${action.color}`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* TELEMETRY separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">AGENT TELEMETRY</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* Telemetry */}
      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-[#f2eee4]">Agent Telemetry</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Agent on-chain activity log</p>
        </div>
        <div className="rounded-2xl border border-dashed border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.03)] px-6 py-10 text-center">
          <p className="text-sm text-[var(--muted)]">No on-chain activity yet.</p>
          <p className="text-xs text-zinc-600 mt-1">Work receipts and transaction events will appear here once your agents start transacting.</p>
        </div>
      </section>

    </div>
  );
}
