'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TradeIntentPanel } from '../../../components/TradeIntentPanel';
import SwarmConsensus from '../../../components/SwarmConsensus';
import { GhostHandshakePanel } from '../../../components/GhostHandshakePanel';

const GHOST_LOGO = '/ghost-logo.png';

const SECTION_COMING = 'Data will be populated once connected to your agent\'s TBA and on-chain registry.';

const STUB_SECTIONS = [
  {
    id: 'identity',
    icon: '🪪',
    title: 'Identity Graph',
    color: 'border-amber-500/30 bg-amber-500/5',
    labelColor: 'text-amber-300',
    rows: [
      { label: 'Agent Name',       value: '—' },
      { label: 'Namespace',        value: '—' },
      { label: 'TBA (Safe)',       value: '—' },
      { label: 'ERC-8004 AgentID', value: '—' },
      { label: 'Story IP Account', value: '—' },
      { label: 'NFT Token ID',     value: '—' },
      { label: 'Cycle Level',      value: '—' },
    ],
  },
  {
    id: 'safe',
    icon: '🏦',
    title: 'Safe & Modules',
    color: 'border-emerald-500/30 bg-emerald-500/5',
    labelColor: 'text-emerald-300',
    rows: [
      { label: 'Safe Address',            value: '—' },
      { label: 'DailyBudget Cap',         value: '—' },
      { label: 'HumanInTheLoop Threshold',value: '—' },
      { label: 'Safe Balance',            value: '—' },
      { label: 'Pending Approvals',       value: '—' },
    ],
  },
  {
    id: 'erc8004',
    icon: '📡',
    title: 'ERC-8004 Status',
    color: 'border-violet-500/30 bg-violet-500/5',
    labelColor: 'text-violet-300',
    rows: [
      { label: 'Registration Chain', value: '—' },
      { label: 'Agent URI',          value: '—' },
      { label: 'Reputation Score',   value: '—' },
      { label: 'Feedback Count',     value: '—' },
      { label: 'Last Feedback TX',   value: '—' },
    ],
  },
  {
    id: 'inbox',
    icon: '📬',
    title: 'Inbox Preview',
    color: 'border-sky-500/30 bg-sky-500/5',
    labelColor: 'text-sky-300',
    rows: [
      { label: 'Total Messages',  value: '—' },
      { label: 'Unread',         value: '—' },
      { label: 'Last Message',   value: '—' },
      { label: 'A2A Threads',    value: '—' },
    ],
  },
  {
    id: 'ip',
    icon: '🏛️',
    title: 'IP & Arweave',
    color: 'border-fuchsia-500/30 bg-fuchsia-500/5',
    labelColor: 'text-fuchsia-300',
    rows: [
      { label: 'Story IP Domain',       value: '—' },
      { label: 'IPA Metadata CID',      value: '—' },
      { label: 'Glass Box Declaration', value: '—' },
      { label: 'Arweave TX',            value: '—' },
      { label: 'Legal Anchor CID',      value: '—' },
    ],
  },
  {
    id: 'telemetry',
    icon: '📊',
    title: 'On-Chain Telemetry',
    color: 'border-rose-500/30 bg-rose-500/5',
    labelColor: 'text-rose-300',
    rows: [
      { label: '$HOST Score',      value: '—' },
      { label: 'Completed Tasks',  value: '—' },
      { label: 'TBA Tx Count',     value: '—' },
      { label: 'Last Activity',    value: '—' },
    ],
  },
];

const TABS = [
  { id: 'overview',  label: '🪪 Overview'    },
  { id: 'trade',     label: '📈 TradeIntent' },
  { id: 'swarm',     label: '🤝 Swarm'       },
  { id: 'tunnel',    label: '🌐 Tunnel'      },
  { id: 'handshake', label: '🔏 Certs'       },
] as const;
type TabId = typeof TABS[number]['id'];

export default function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-16 w-16 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#f2eee4]">{name}</h1>
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

      {/* Under construction banner */}
      <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
        <svg className="h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <p className="text-[11px] text-amber-300/80">{SECTION_COMING}</p>
      </div>

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
        {STUB_SECTIONS.map((section) => (
          <div
            key={section.id}
            className={`rounded-2xl border p-5 ${section.color}`}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">{section.icon}</span>
              <h2 className={`text-sm font-semibold ${section.labelColor}`}>{section.title}</h2>
            </div>
            <div className="space-y-2">
              {section.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="text-[var(--muted)] shrink-0">{row.label}</span>
                  <span className="font-mono text-zinc-500 truncate">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
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
