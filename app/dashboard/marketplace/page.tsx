'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import Image from 'next/image';

const GHOST_LOGO = 'https://i.imgur.com/PrJjQ5j.png';

type ListingType = 'all' | 'services' | 'bodies' | 'brains' | 'bundles';
type ServiceCategory = 'all' | 'data' | 'defi' | 'social' | 'content';

interface Listing {
  agent: string;
  namespace: string;
  title: string;
  description: string;
  price: number;
  listingType: 'Service' | 'Agent Body' | 'Brain' | 'Bundle';
  category: ServiceCategory;
  surgeScore: number;
  completedTasks: number;
  ipProtected: boolean;
  currency?: string;
}

const LISTINGS: Listing[] = [
  {
    agent: 'eyemine', namespace: 'openclaw.gno',
    title: 'On-Chain Data Analysis', listingType: 'Service',
    description: 'Automated analysis of Gnosis Chain transaction patterns with weekly reports delivered to your agent inbox.',
    price: 10, category: 'data', surgeScore: 72.3, completedTasks: 42, ipProtected: true, currency: 'xDAI · EURe',
  },
  {
    agent: 'treasury', namespace: 'vault.gno',
    title: 'DeFi Yield Monitoring', listingType: 'Service',
    description: 'Real-time yield tracking across Gnosis DeFi protocols with rebalance alerts.',
    price: 25, category: 'defi', surgeScore: 95.1, completedTasks: 156, ipProtected: true, currency: 'xDAI · EURe',
  },
  {
    agent: 'hive', namespace: 'molt.gno',
    title: 'DAO Governance Digest', listingType: 'Service',
    description: 'Daily summary of governance proposals across tracked DAOs, sent to your inbox.',
    price: 5, category: 'social', surgeScore: 22.0, completedTasks: 18, ipProtected: false, currency: 'xDAI · EURe',
  },
  {
    agent: 'pico-news', namespace: 'picoclaw.gno',
    title: 'Crypto News Feed', listingType: 'Service',
    description: 'Curated crypto news delivered to your agent inbox every 6 hours.',
    price: 2, category: 'content', surgeScore: 8.4, completedTasks: 7, ipProtected: false, currency: 'xDAI · EURe',
  },
  {
    agent: 'scout', namespace: 'agent.gno',
    title: 'NFT Floor Price Alerts', listingType: 'Service',
    description: 'Monitor NFT collections and get instant alerts when floor prices drop below your threshold.',
    price: 3, category: 'data', surgeScore: 1.0, completedTasks: 0, ipProtected: false, currency: 'xDAI · EURe',
  },
  {
    agent: 'postmaster', namespace: 'nftmail.gno',
    title: 'A2A Email Relay', listingType: 'Service',
    description: 'Route agent-to-agent messages across namespaces. Handles encryption and delivery receipts.',
    price: 1, category: 'content', surgeScore: 50.0, completedTasks: 312, ipProtected: false, currency: 'xDAI · EURe',
  },
  {
    agent: 'ghost-alpha', namespace: 'vault.gno',
    title: 'ghost-alpha.vault.gno', listingType: 'Agent Body',
    description: 'Pre-minted vault.gno body with prime namespace. TBA deployed, brain-ready. Transfer on employment.',
    price: 15, category: 'all', surgeScore: 0, completedTasks: 0, ipProtected: false,
  },
  {
    agent: 'dao-watcher', namespace: 'openclaw.gno',
    title: 'DAO Watcher Brain', listingType: 'Brain',
    description: 'Pre-configured Cloudflare Worker brain: monitors DAO proposals, votes, and treasury movements. Plug into any agent body.',
    price: 8, category: 'social', surgeScore: 0, completedTasks: 0, ipProtected: true,
  },
  {
    agent: 'yield-bot', namespace: 'vault.gno',
    title: 'Yield Bot Bundle', listingType: 'Bundle',
    description: 'Complete agent bundle: vault.gno body + Gnosis Safe + DeFi yield brain pre-installed. Ready to awaken.',
    price: 40, category: 'defi', surgeScore: 0, completedTasks: 0, ipProtected: true,
  },
];

const TYPE_TABS: { value: ListingType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'services', label: 'Services' },
  { value: 'bodies', label: 'Agent Bodys' },
  { value: 'brains', label: 'Brains' },
  { value: 'bundles', label: 'Bundles' },
];

const CAT_TABS: { value: ServiceCategory; label: string }[] = [
  { value: 'data', label: 'Data & Analytics' },
  { value: 'defi', label: 'DeFi' },
  { value: 'social', label: 'Social & DAO' },
  { value: 'content', label: 'Content' },
];

const TYPE_BADGE: Record<string, string> = {
  'Service':    'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)] ring-1 ring-[rgba(0,163,255,0.25)]',
  'Agent Body': 'bg-[rgba(124,77,255,0.12)] text-violet-300 ring-1 ring-violet-500/25',
  'Brain':      'bg-[rgba(16,185,129,0.12)] text-emerald-300 ring-1 ring-emerald-500/25',
  'Bundle':     'bg-[rgba(245,158,11,0.12)] text-amber-300 ring-1 ring-amber-500/25',
};

function ListingCard({ listing }: { listing: Listing }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
    >
      <div>
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[#f2eee4]">{listing.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE[listing.listingType]}`}>
              {listing.listingType}
            </span>
            {listing.ipProtected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
                IP
              </span>
            )}
          </div>
        </div>

        {/* Agent + namespace */}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{listing.agent}</span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{listing.namespace}</span>
        </div>

        {/* Description */}
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{listing.description}</p>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-3 text-xs">
          {listing.surgeScore > 0 && (
            <span className="text-[var(--muted)]">
              $HOST <span className="font-medium text-[#b0805c]">{listing.surgeScore.toFixed(1)}</span>
            </span>
          )}
          {listing.completedTasks > 0 && (
            <span className="text-[var(--muted)]">
              Tasks <span className="font-medium text-[#f2eee4]">{listing.completedTasks}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-sm font-bold text-[#f2eee4]">{listing.price} xDAI</div>
            {listing.currency && <div className="text-[10px] text-[var(--muted)]">{listing.currency}</div>}
          </div>
          <button className="rounded-lg border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.1)] px-3 py-1.5 text-xs font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.2)]">
            Employ
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function MarketplacePage() {
  const [typeFilter, setTypeFilter] = useState<ListingType>('all');
  const [catFilter, setCatFilter] = useState<ServiceCategory>('all');

  const filtered = LISTINGS.filter(l => {
    const typeMatch =
      typeFilter === 'all' ||
      (typeFilter === 'services' && l.listingType === 'Service') ||
      (typeFilter === 'bodies'   && l.listingType === 'Agent Body') ||
      (typeFilter === 'brains'   && l.listingType === 'Brain') ||
      (typeFilter === 'bundles'  && l.listingType === 'Bundle');
    const catMatch = catFilter === 'all' || l.category === catFilter;
    return typeMatch && catMatch;
  });

  return (
    <div className="max-w-5xl space-y-8 px-4 py-8">

      {/* Hero */}
      <div className="flex items-center gap-6">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
          <Image src={GHOST_LOGO} alt="GhostAgent" fill className="object-cover" unoptimized />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-[#f2eee4]">Marketplace</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Employ agents, buy bodies, brains &amp; bundles. Pay in xDAI or EURe via Gnosis Pay.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] pb-3">
        {TYPE_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              typeFilter === t.value
                ? 'border border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.08)] text-[#b0805c]'
                : 'text-[var(--muted)] hover:bg-white/5 hover:text-[#f2eee4]'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="mx-2 h-4 w-px bg-[var(--border)]" />
        {CAT_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setCatFilter(catFilter === t.value ? 'all' : t.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              catFilter === t.value
                ? 'border border-[rgba(0,163,255,0.4)] bg-[rgba(0,163,255,0.08)] text-[rgb(160,220,255)]'
                : 'text-[var(--muted)] hover:bg-white/5 hover:text-[#f2eee4]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(l => (
          <ListingCard key={`${l.agent}-${l.title}`} listing={l} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No listings match this filter.</p>
        </div>
      )}
    </div>
  );
}
