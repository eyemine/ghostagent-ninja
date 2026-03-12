'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WorkReceiptCard } from '../components/WorkReceiptCard';
import A2ACardModal from '../../components/A2ACardModal';

const GHOST_LOGO = '/ghost-logo.png';

type AgentTier = 'free' | 'pro';
type BrainType = 'CF Worker' | 'Safe Brain' | 'GlassBox';

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
}

interface DemoBody {
  name: string;
  namespace: string;
  tokenId: number;
  tba: string;
  minted: string;
}

interface DemoBrain {
  agent: string;
  type: BrainType;
  endpoint: string;
  installed: string;
}

const DEMO_AGENTS: DemoAgent[] = [
  {
    name: 'eyemine',
    namespace: 'openclaw.gno',
    tba: '0xb7e4...af13',
    tier: 'pro',
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
    tier: 'pro',
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
    tier: 'free',
    hostScore: 22.0,
    inbox: 6,
    events: 1,
    active: true,
    brainType: 'GlassBox',
  },
];

const DEMO_BODIES: DemoBody[] = [
  { name: 'eyemine',  namespace: 'openclaw.gno', tokenId: 1, tba: '0xb7e40c...f3af13', minted: '19/02/2026' },
  { name: 'treasury', namespace: 'vault.gno',    tokenId: 3, tba: '0xd4e5f6...c3d4e5', minted: '26/02/2026' },
  { name: 'hive',     namespace: 'molt.gno',     tokenId: 7, tba: '0xc3d4e5...b2c3d4', minted: '28/02/2026' },
];

const DEMO_RECEIPTS = [
  {
    receiptNumber: 42,
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    licenseId: '0x1234567890abcdef1234567890abcdef12345678',
    revenue: 10,
    agentAddress: '0xb7e40c4b6a0e180577f6c34de944612eb8f3af13',
    surgeGained: 0.1,
    storyTxHash: '0x9876543210fedcba9876543210fedcba98765432',
    timestamp: Date.now() - 3600000,
  },
  {
    receiptNumber: 41,
    cid: 'bafybeihdwdcefgh4c5mvc3jd4yachnuuokinmjnfcnvqbqhzanmkioebu',
    licenseId: '0xabcdef1234567890abcdef1234567890abcdef12',
    revenue: 25,
    agentAddress: '0xd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    surgeGained: 0.25,
    storyTxHash: '0xfedcba9876543210fedcba9876543210fedcba98',
    timestamp: Date.now() - 86400000,
  },
];

const DEMO_BRAINS: DemoBrain[] = [
  { agent: 'eyemine',  type: 'CF Worker', endpoint: 'eyemine.ghostagent.workers.dev', installed: '20/02/2026' },
  { agent: 'treasury', type: 'Safe Brain', endpoint: 'vault.safe.brain',              installed: '27/02/2026' },
  { agent: 'hive',     type: 'GlassBox',  endpoint: 'hive.glassbox.agent',            installed: '01/03/2026' },
];

const NS_COLOR: Record<string, string> = {
  'openclaw.gno': 'text-cyan-300',
  'vault.gno':    'text-emerald-300',
  'molt.gno':     'text-fuchsia-300',
  'agent.gno':    'text-blue-300',
  'picoclaw.gno': 'text-amber-300',
  'nftmail.gno':  'text-rose-300',
};

function HeartbeatDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </span>
  );
}

function AgentCard({ agent, onEvolve, onViewA2A }: { agent: DemoAgent; onEvolve: () => void; onViewA2A: () => void }) {
  const nsColor = NS_COLOR[agent.namespace] ?? 'text-zinc-400';
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5">
      {/* NFT image + identity row */}
      <div className="flex gap-3">
        {/* NFT placeholder — square, half panel width */}
        <div className="w-1/2 shrink-0 aspect-square rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/40 flex flex-col items-center justify-center gap-1.5 overflow-hidden">
          <svg className="h-8 w-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span className="text-[9px] font-semibold tracking-wider text-zinc-700 uppercase">NFT #{agent.name}</span>
        </div>

        {/* Identity — domain + safe address + badges */}
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <HeartbeatDot active={agent.active} />
              <span className="text-sm font-semibold text-[#f2eee4] truncate">{agent.name}</span>
            </div>
            <span className={`text-[11px] font-medium ${nsColor}`}>{agent.namespace}</span>
            <code className="mt-1 block truncate text-[10px] text-[var(--muted)]">{agent.tba}</code>
          </div>

          {/* Badges */}
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.tier === 'pro' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold text-violet-300 ring-1 ring-violet-500/30">
                <svg className="h-2 w-2" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                PUPA
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-zinc-500/15 px-2 py-0.5 text-[9px] font-medium text-zinc-400 ring-1 ring-zinc-500/20">LARVA</span>
            )}
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

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-2">
          {agent.tier === 'free' && (
            <button
              onClick={onEvolve}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
            >
              + Evolve to Pro
            </button>
          )}
          <button className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-300 transition hover:bg-fuchsia-500/20">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            Molt
          </button>
          <button
            onClick={onViewA2A}
            className="flex items-center gap-1 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30 px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:text-white"
          >
            A2A Card
          </button>
          <Link
            href={`/dashboard/agent/${agent.name}`}
            className="flex items-center gap-1 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30 px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:text-white"
          >
            Details →
          </Link>
        </div>

        {agent.tier === 'free' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span className="text-[10px] text-amber-300/80">Free tier — inbox decays after 8 days. Evolve to Pro for persistent storage + IP protection.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const DEMO_RECEIPT_DATA = DEMO_RECEIPTS;

export default function DashboardHome() {
  const [evolvingAgent, setEvolvingAgent] = useState<string | null>(null);
  const [a2aAgent, setA2aAgent]           = useState<string | null>(null);

  function handleEvolve(agentName: string) {
    setEvolvingAgent(agentName);
    setTimeout(() => setEvolvingAgent(null), 3000);
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">My Agents</h1>
            <p className="pl-1 mt-0.5 text-xs text-[var(--muted)]">Fully-rigged Agents – Mirror Bodies with Brains installed</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/ip-portal"
            className="rounded-lg border border-[#7c4dff]/30 bg-[#7c4dff]/10 px-4 py-1.5 text-xs font-semibold text-[#a78bfa] transition hover:bg-[#7c4dff]/20"
          >
            🏛️ IP Portal
          </Link>
          <a
            href="https://nftmail.box/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
            style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
          >
            nftmail.box ↗
          </a>
        </div>
      </div>

      {/* Agent Cards — 3-col grid */}
      <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
        {DEMO_AGENTS.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            onEvolve={() => handleEvolve(agent.name)}
            onViewA2A={() => setA2aAgent(agent.name)}
          />
        ))}

      {a2aAgent && (
        <A2ACardModal
          agentName={a2aAgent}
          isOwner
          onClose={() => setA2aAgent(null)}
        />
      )}
      </div>

      {/* MY BODIES separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">MY BODIES</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* My Bodies section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#f2eee4]">My Bodies</h2>
          <Link href="/dashboard/mint-body" className="text-xs text-[var(--muted)] transition hover:text-white">
            Mint Agent Body →
          </Link>
        </div>
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
              {DEMO_BODIES.map((body, i) => {
                const nsColor = NS_COLOR[body.namespace] ?? 'text-zinc-400';
                return (
                  <tr key={body.name} className={i < DEMO_BODIES.length - 1 ? 'border-b border-[rgba(176,128,92,0.15)]' : ''}>
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
      </section>

      {/* MY BRAINS separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">MY BRAINS</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* My Brains section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#f2eee4]">My Brains</h2>
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
              {DEMO_BRAINS.map((brain, i) => (
                <tr key={brain.agent} className={i < DEMO_BRAINS.length - 1 ? 'border-b border-[rgba(176,128,92,0.15)]' : ''}>
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

      {/* TELEMETRY separator */}
      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">AGENT TELEMETRY</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* Telemetry — Work Receipts */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#f2eee4]">Agent Telemetry</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Live on-chain activity and inbox stats for your TBAs</p>
          </div>
          <span className="text-xs text-[var(--muted)]">Verified by Story Protocol</span>
        </div>
        <div className="grid gap-4">
          {DEMO_RECEIPT_DATA.map((receipt) => (
            <WorkReceiptCard key={receipt.receiptNumber} {...receipt} />
          ))}
        </div>
      </section>

    </div>
  );
}
