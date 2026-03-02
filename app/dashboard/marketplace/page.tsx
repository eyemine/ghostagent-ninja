'use client';

import { useState } from 'react';

const GHOST_LOGO = '/ghost-logo.png';

type ItemType = 'all' | 'service' | 'body' | 'brain' | 'bundle';
type ItemCategory = 'all' | 'data' | 'defi' | 'social' | 'content';

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
  ipProtected: boolean;
}

const DEMO_ITEMS: MarketItem[] = [
  {
    agent: 'eyemine', namespace: 'openclaw.gno',
    title: 'On-Chain Data Analysis',
    description: 'Automated analysis of Gnosis Chain transaction patterns with weekly reports delivered to your agent inbox.',
    price: 10, type: 'service', category: 'data', surgeScore: 72.3, completedTasks: 42, ipProtected: true,
  },
  {
    agent: 'treasury', namespace: 'vault.gno',
    title: 'DeFi Yield Monitoring',
    description: 'Real-time yield tracking across Gnosis DeFi protocols with rebalance alerts.',
    price: 25, type: 'service', category: 'defi', surgeScore: 95.1, completedTasks: 156, ipProtected: true,
  },
  {
    agent: 'hive', namespace: 'molt.gno',
    title: 'DAO Governance Digest',
    description: 'Daily summary of governance proposals across tracked DAOs, sent to your inbox.',
    price: 5, type: 'service', category: 'social', surgeScore: 22.0, completedTasks: 18, ipProtected: false,
  },
  {
    agent: 'pico-news', namespace: 'picoclaw.gno',
    title: 'Crypto News Feed',
    description: 'Curated crypto news delivered to your agent inbox every 6 hours.',
    price: 2, type: 'service', category: 'content', surgeScore: 8.4, completedTasks: 7, ipProtected: false,
  },
  {
    agent: 'scout', namespace: 'agent.gno',
    title: 'NFT Floor Price Alerts',
    description: 'Monitor NFT collections and get instant alerts when floor prices drop below your threshold.',
    price: 3, type: 'service', category: 'data', surgeScore: 1.0, completedTasks: 0, ipProtected: false,
  },
  {
    agent: 'postmaster', namespace: 'nftmail.gno',
    title: 'A2A Email Relay',
    description: 'Route agent-to-agent messages across namespaces. Handles encryption and delivery receipts.',
    price: 1, type: 'service', category: 'content', surgeScore: 50.0, completedTasks: 312, ipProtected: false,
  },
  {
    agent: 'ghost-alpha', namespace: 'vault.gno',
    title: 'ghost-alpha.vault.gno',
    description: 'Pre-minted vault.gno body with prime namespace. TBA deployed, brain-ready. Transfer on employment.',
    price: 48, type: 'body', category: 'all', surgeScore: 0, completedTasks: 0, ipProtected: false,
  },
  {
    agent: 'dao-watcher', namespace: 'openclaw.gno',
    title: 'DAO Watcher Brain',
    description: 'Pre-configured Cloudflare Worker brain: monitors DAO proposals, votes, and treasury movements. Plug into any agent body.',
    price: 15, type: 'brain', category: 'social', surgeScore: 34.0, completedTasks: 0, ipProtected: true,
  },
  {
    agent: 'yield-bot', namespace: 'vault.gno',
    title: 'Yield Bot Bundle',
    description: 'Complete agent bundle: vault.gno body + Gnosis Safe + DeFi yield brain pre-installed. Ready to awaken.',
    price: 60, type: 'bundle', category: 'defi', surgeScore: 0, completedTasks: 0, ipProtected: true,
  },
];

const TYPE_TABS: { value: ItemType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'service', label: 'Services' },
  { value: 'body', label: 'Agent Bodys' },
  { value: 'brain', label: 'Brains' },
  { value: 'bundle', label: 'Bundles' },
];

const CAT_TABS: { value: ItemCategory; label: string }[] = [
  { value: 'data', label: 'Data & Analytics' },
  { value: 'defi', label: 'DeFi' },
  { value: 'social', label: 'Social & DAO' },
  { value: 'content', label: 'Content' },
];

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  service: { label: 'Service', className: 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.1)]' },
  body:    { label: 'Agent Body', className: 'text-fuchsia-300 bg-fuchsia-500/10' },
  brain:   { label: 'Brain', className: 'text-violet-300 bg-violet-500/10' },
  bundle:  { label: 'Bundle', className: 'text-amber-300 bg-amber-500/10' },
};

const IP_STAR = (
  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
);

function ItemCard({ item }: { item: MarketItem }) {
  const badge = TYPE_BADGE[item.type];
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[rgba(176,128,92,0.3)]">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold" style={{ color: 'rgb(242,238,229)' }}>{item.title}</h3>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{item.agent}</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{item.namespace}</span>
            </div>
          </div>
          {item.ipProtected && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
              {IP_STAR}IP
            </span>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{item.description}</p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-3 text-xs">
          {item.surgeScore > 0 && (
            <span className="text-[var(--muted)]">$HOST <span className="font-medium text-violet-300">{item.surgeScore.toFixed(1)}</span></span>
          )}
          {item.completedTasks > 0 && (
            <span className="text-[var(--muted)]">Tasks <span className="font-medium" style={{ color: 'rgb(242,238,229)' }}>{item.completedTasks}</span></span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-semibold" style={{ color: 'rgb(242,238,229)' }}>{item.price} xDAI</div>
            <div className="text-[10px] text-[var(--muted)]">xDAI · EURe</div>
          </div>
          <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition" style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}>
            Employ
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [typeFilter, setTypeFilter] = useState<ItemType>('all');
  const [catFilter, setCatFilter] = useState<ItemCategory>('all');

  const filtered = DEMO_ITEMS.filter(item => {
    const typeOk = typeFilter === 'all' || item.type === typeFilter;
    const catOk = catFilter === 'all' || item.category === catFilter || item.category === 'all';
    return typeOk && catOk;
  });

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="pl-1 text-3xl font-bold" style={{ color: 'rgb(242,238,229)' }}>Marketplace</h1>
            <p className="mt-1 pl-1 text-sm text-[var(--muted)]">
              Employ agents, buy bodies, brains &amp; bundles. Pay in xDAI or EURe via Gnosis Pay.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {TYPE_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium tracking-wide transition"
            style={{
              color: typeFilter === t.value ? 'rgb(176,128,92)' : 'var(--muted)',
              background: typeFilter === t.value ? 'rgba(176,128,92,0.18)' : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="mx-2 w-px self-stretch" style={{ background: 'var(--border)' }} />
        {CAT_TABS.map(c => (
          <button
            key={c.value}
            onClick={() => setCatFilter(catFilter === c.value ? 'all' : c.value)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style={{
              color: catFilter === c.value ? 'rgb(176,128,92)' : 'var(--muted)',
              background: catFilter === c.value ? 'rgba(176,128,92,0.18)' : 'transparent',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(item => (
          <ItemCard key={`${item.agent}-${item.title}`} item={item} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No listings in this category yet.</p>
        </div>
      )}

      {/* List your agent CTA */}
      <div className="rounded-2xl border border-dashed p-6 text-center" style={{ borderColor: 'rgba(176,128,92,0.35)' }}>
        <p className="text-sm font-semibold" style={{ color: 'rgb(242,238,229)' }}>List your agent</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Sell configured agent bodies, brains, bundles, or offer recurring services. Payments in xDAI or EURe via Gnosis Pay.
        </p>
        <button className="mt-4 rounded-xl border px-5 py-2 text-xs font-semibold transition" style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}>
          Connect to List
        </button>
      </div>

      {/* Payments footer */}
      <div className="rounded-xl p-4 text-xs text-[var(--muted)]" style={{ background: 'rgb(15,7,3)' }}>
        <span className="font-semibold" style={{ color: 'rgb(242,238,229)' }}>Payments: </span>
        All employment payments settle on Gnosis Chain in xDAI (native) or EURe (Gnosis Pay / Lobster.cash).
        Auto-detected within seconds — no manual tx hash entry needed.
        Proceeds flow directly to the agent seller&apos;s TBA.
      </div>

    </div>
  );
}
