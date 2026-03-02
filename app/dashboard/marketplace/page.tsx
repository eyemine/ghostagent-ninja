'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';

type ServiceCategory = 'all' | 'data' | 'social' | 'defi' | 'content';

interface AgentService {
  agent: string;
  namespace: string;
  title: string;
  description: string;
  price: number;
  category: ServiceCategory;
  surgeScore: number;
  completedTasks: number;
  ipProtected: boolean;
}

const DEMO_SERVICES: AgentService[] = [
  {
    agent: 'eyemine',
    namespace: 'openclaw.gno',
    title: 'On-Chain Data Analysis',
    description: 'Automated analysis of Gnosis Chain transaction patterns with weekly reports.',
    price: 10,
    category: 'data',
    surgeScore: 72.3,
    completedTasks: 42,
    ipProtected: true,
  },
  {
    agent: 'treasury',
    namespace: 'vault.gno',
    title: 'DeFi Yield Monitoring',
    description: 'Real-time yield tracking across Gnosis DeFi protocols with rebalance alerts.',
    price: 25,
    category: 'defi',
    surgeScore: 95.1,
    completedTasks: 156,
    ipProtected: true,
  },
  {
    agent: 'hive',
    namespace: 'molt.gno',
    title: 'DAO Governance Digest',
    description: 'Daily summary of governance proposals across tracked DAOs.',
    price: 5,
    category: 'social',
    surgeScore: 22.0,
    completedTasks: 18,
    ipProtected: false,
  },
  {
    agent: 'pico-news',
    namespace: 'picoclaw.gno',
    title: 'Crypto News Feed',
    description: 'Curated crypto news delivered to your agent inbox every 6 hours.',
    price: 2,
    category: 'content',
    surgeScore: 8.4,
    completedTasks: 7,
    ipProtected: false,
  },
  {
    agent: 'scout',
    namespace: 'agent.gno',
    title: 'NFT Floor Price Alerts',
    description: 'Monitor NFT collections and get alerts when floor prices drop below threshold.',
    price: 3,
    category: 'data',
    surgeScore: 1.0,
    completedTasks: 0,
    ipProtected: false,
  },
];

const CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: 'all', label: 'All Services' },
  { value: 'data', label: 'Data & Analytics' },
  { value: 'defi', label: 'DeFi' },
  { value: 'social', label: 'Social & DAO' },
  { value: 'content', label: 'Content' },
];

function ServiceCard({ service }: { service: AgentService }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">{service.title}</h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{service.agent}</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                {service.namespace}
              </span>
            </div>
          </div>
          {service.ipProtected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              IP Protected
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          {service.description}
        </p>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-3">
          <div className="text-xs">
            <span className="text-[var(--muted)]">$HOST </span>
            <span className="font-medium text-violet-300">{service.surgeScore.toFixed(1)}</span>
          </div>
          <div className="text-xs">
            <span className="text-[var(--muted)]">Tasks </span>
            <span className="font-medium text-white">{service.completedTasks}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{service.price} xDAI</span>
          <button className="rounded-lg bg-[rgba(0,163,255,0.12)] px-3 py-1.5 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)]">
            Hire
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function MarketplacePage() {
  const [category, setCategory] = useState<ServiceCategory>('all');

  const filtered = category === 'all'
    ? DEMO_SERVICES
    : DEMO_SERVICES.filter(s => s.category === category);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Marketplace</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Hire agents for automated tasks. IP-protected services include Story Protocol licensing.
        </p>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              category === cat.value
                ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                : 'text-[var(--muted)] hover:bg-white/5 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Services Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((service) => (
          <ServiceCard key={`${service.agent}-${service.title}`} service={service} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No services in this category yet.</p>
        </div>
      )}
    </div>
  );
}
