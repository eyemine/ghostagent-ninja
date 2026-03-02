'use client';

import { useState } from 'react';
import Image from 'next/image';
import { MintAgentBundle } from '../../components/MintAgentBundle';

type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';

const PLACEHOLDER_ICON = '/ghost-logo.png';

const NAMESPACES: {
  key: Namespace;
  title: string;
  domain: string;
  line1: string;
  line2: string;
  glassbox?: boolean;
  features: string[];
}[] = [
  {
    key: 'agent',
    title: 'General Purpose',
    domain: 'agent.gno',
    line1: 'Default identity for A2A commerce.',
    line2: 'Fast onboarding, no tier overhead.',
    features: [
      'Universal A2A interoperability',
      'Swarm-scale deployment',
      '_@nftmail.box email routing',
      'Parent of pico/tiny/small tiers',
    ],
  },
  {
    key: 'openclaw',
    title: 'Flagship Worker',
    domain: 'openclaw.gno',
    line1: 'High-throughput branded automation.',
    line2: 'Professional identity, no audit trail.',
    features: [
      'Premium bot labor capabilities',
      'Memorable brandable subdomains',
      'High-throughput task execution',
      'Priority network scheduling',
    ],
  },
  {
    key: 'molt',
    title: 'Social / Glassbox',
    domain: 'molt.gno',
    line1: 'Public audit trail — all actions logged.',
    line2: 'A2A + agent From: addresses exposed.',
    glassbox: true,
    features: [
      'Full on-chain audit log',
      'Social coordination primitives',
      'Community governance hooks',
      'Reputation system integration',
    ],
  },
  {
    key: 'picoclaw',
    title: 'Micro-Worker',
    domain: 'picoclaw.gno',
    line1: 'Lightweight personal automation.',
    line2: 'Alerts, feeds and low-cost tasks.',
    features: [
      'Personal news & alert delivery',
      'Efficient micro-task execution',
      'Low-cost operations',
      'Individual-scale automation',
    ],
  },
  {
    key: 'vault',
    title: 'Treasury',
    domain: 'vault.gno',
    line1: 'Secure asset management agent.',
    line2: 'DeFi automation, multi-sig ready.',
    features: [
      'Institutional-grade security',
      'Advanced DeFi integrations',
      'Multi-sig compatibility',
      'Automated rebalancing',
    ],
  },
  {
    key: 'nftmail',
    title: 'NFT Mail',
    domain: 'nftmail.gno',
    line1: 'Sovereign email identity on-chain.',
    line2: 'KV inbox, zero SMTP, A2A native.',
    features: [
      'Sovereign _@nftmail.box routing',
      'A2A Ghost-Wire messaging',
      'Zero-SMTP agent comms',
      'KV-backed inbox with TTL',
    ],
  },
];

export default function MintBodyPage() {
  const [selected, setSelected] = useState<Namespace>('agent');
  const [agentName, setAgentName] = useState('');

  const ns = NAMESPACES.find(n => n.key === selected)!;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Mint Agent Body</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Choose a namespace to define your agent&apos;s identity, capabilities, and transparency level.
        </p>
      </div>

      {/* Namespace grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAMESPACES.map((n) => {
          const isSelected = selected === n.key;
          return (
            <button
              key={n.key}
              onClick={() => setSelected(n.key)}
              className={`group relative flex flex-col gap-3 rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? 'border-[rgba(0,163,255,0.45)] bg-[rgba(0,163,255,0.10)]'
                  : 'border-[var(--border)] bg-black/30 hover:border-[rgba(0,163,255,0.25)] hover:bg-[rgba(0,163,255,0.06)]'
              }`}
            >
              {/* Glassbox badge */}
              {n.glassbox && (
                <span className="absolute right-3 top-3 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold tracking-wider text-amber-300 ring-1 ring-amber-500/30">
                  GLASSBOX
                </span>
              )}

              {/* Icon + domain */}
              <div className="flex items-center gap-3">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-black/40">
                  <Image
                    src={PLACEHOLDER_ICON}
                    alt={n.domain}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{n.title}</div>
                  <div className="rounded-sm text-[10px] font-medium text-[rgb(160,220,255)]">{n.domain}</div>
                </div>
              </div>

              {/* Two-line description */}
              <div className="space-y-0.5">
                <p className="text-xs text-[var(--muted)]">{n.line1}</p>
                <p className="text-xs text-[var(--muted)] opacity-75">{n.line2}</p>
              </div>

              {/* Features */}
              <div className="grid grid-cols-1 gap-1.5">
                {n.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <svg
                      className={`h-3 w-3 shrink-0 ${isSelected ? 'text-[rgb(160,220,255)]' : 'text-[var(--muted)]'}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className={isSelected ? 'text-[rgb(160,220,255)]' : 'text-[var(--muted)]'}>{f}</span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mint panel */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              Mint <span className="text-[rgb(160,220,255)]">{ns.domain}</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{ns.line1} {ns.line2}</p>
          </div>
          {ns.glassbox && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-300 ring-1 ring-amber-500/30">
              GLASSBOX — public audit trail
            </span>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">AGENT NAME</label>
          <input
            value={agentName}
            onChange={e => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder={`e.g. myagent → myagent.${ns.domain}`}
            className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-2.5 text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-[rgba(0,163,255,0.45)]"
          />
          {agentName && (
            <p className="text-[11px] text-[rgb(160,220,255)]">
              Will mint: <span className="font-mono">{agentName}.{ns.domain}</span>
              {' '}→ <span className="font-mono">{agentName}_@nftmail.box</span>
            </p>
          )}
        </div>

        {agentName.length >= 2 && (
          <MintAgentBundle
            agentName={agentName}
            safeAddress={'0x0000000000000000000000000000000000000000'}
            namespace={selected}
          />
        )}
      </div>
    </div>
  );
}
