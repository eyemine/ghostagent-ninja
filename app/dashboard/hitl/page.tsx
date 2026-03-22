'use client';

import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import HITLPanel from '../../components/HITLPanel';

const GHOST_LOGO = '/ghost-logo.png';

export default function HITLPage() {
  const { authenticated } = usePrivy();

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={GHOST_LOGO}
            alt="GhostAgent"
            className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">Human-In-The-Loop</h1>
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-500/20">
                Safe Module
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                Gnosis Chain
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Spending gates for your agent Safe — high-value txs queue for human approval
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-white"
        >
          ← Dashboard
        </Link>
      </div>

      {/* Explainer cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: '⚡',
            title: 'Below Threshold',
            body: 'Transactions at or below the spending threshold (default 1 xDAI) execute immediately via the Safe module. No queuing, no delays.',
            color: 'border-emerald-500/20 bg-emerald-500/5',
            label: 'text-emerald-300',
          },
          {
            icon: '⏳',
            title: 'Above Threshold',
            body: 'High-value transactions are queued and emit TransactionQueued on-chain. A Safe owner must approve via multi-sig within the TTL window (default 24h).',
            color: 'border-amber-500/20 bg-amber-500/5',
            label: 'text-amber-300',
          },
          {
            icon: '🚨',
            title: 'Emergency Pause',
            body: 'Any Safe owner can instantly halt all execution. Unpausing requires the full Safe multi-sig — ensuring a single rogue signer cannot restart a compromised agent.',
            color: 'border-red-500/20 bg-red-500/5',
            label: 'text-red-300',
          },
        ].map(c => (
          <div key={c.title} className={`rounded-xl border p-4 space-y-1.5 ${c.color}`}>
            <div className="flex items-center gap-2">
              <span>{c.icon}</span>
              <span className={`text-xs font-semibold ${c.label}`}>{c.title}</span>
            </div>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>

      {/* Setup notice if modules not yet enabled */}
      <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
        <div className="flex items-start gap-3">
          <span className="text-lg mt-0.5">⚠️</span>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-zinc-300">Module must be enabled on the Safe</div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              The HumanInTheLoopModule is deployed but must be added as a Safe Module before it can queue or execute transactions.{' '}
              <a
                href="https://app.safe.global/settings/modules?safe=gno:0xb7e493e3d226f8fE722CC9916fF164B793af13F4"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 hover:underline"
              >
                Enable it in Safe Settings → Modules ↗
              </a>
              {' '}→ Add Module → <code className="text-[#b0805c]">0x012A0571d0DFd7eF85d0706875FEc39555e99A96</code>
            </p>
          </div>
        </div>
      </div>

      {!authenticated ? (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] px-6 py-12 text-center space-y-2">
          <p className="text-sm text-[var(--muted)]">Connect your wallet to interact with the HITL module.</p>
          <p className="text-xs text-zinc-600">Emergency pause requires a connected Safe owner wallet.</p>
        </div>
      ) : (
        <HITLPanel />
      )}

    </div>
  );
}
