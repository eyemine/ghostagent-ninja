'use client';

import { useState } from 'react';
import { MoltModal, type MoltResult } from './MoltModal';

export interface DashboardAgent {
  name: string;
  namespace: string;
  tba: string;
  tier: string;
  hostScore?: number;
  inbox?: number;
  events?: number;
  active?: boolean;
  ipDomain?: string;
  brainType?: string;
  currentIdentity?: string;
  ownerWallet: string;
  totalXdaiBurned?: number;
  surgeReputationScore?: number;
}

interface DashboardAgentCardProps {
  agent: DashboardAgent;
  onMoltComplete?: (result: MoltResult) => void;
}

export function DashboardAgentCard({ agent, onMoltComplete }: DashboardAgentCardProps) {
  const [showMoltModal, setShowMoltModal] = useState(false);
  const [latestMolt, setLatestMolt] = useState<MoltResult | null>(null);

  const tierColor =
    agent.tier === 'ghost' ? 'text-amber-300 bg-amber-500/10 ring-amber-500/20' :
    agent.tier === 'pro'   ? 'text-violet-300 bg-violet-500/10 ring-violet-500/20' :
    agent.tier === 'imago' ? 'text-sky-300 bg-sky-500/10 ring-sky-500/20' :
    agent.tier === 'pupa'  ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20' :
                             'text-zinc-400 bg-white/5 ring-white/10';

  const currentIdentity = latestMolt?.targetIdentity ?? agent.currentIdentity ?? 'default';
  const totalXdaiBurned = latestMolt?.totalXdaiBurned ?? agent.totalXdaiBurned ?? 0;
  const surgeScore = latestMolt?.surgeReputationScore ?? agent.surgeReputationScore ?? 0;

  function handleMoltSuccess(result: MoltResult) {
    setLatestMolt(result);
    setShowMoltModal(false);
    onMoltComplete?.(result);
  }

  return (
    <>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[rgba(176,128,92,0.25)]">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(176,128,92,0.1)] text-lg">
              🤖
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{agent.name}_</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${tierColor}`}>
                  {agent.tier.toUpperCase()}
                </span>
                {agent.active && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--muted)]">
                {agent.name}_@nftmail.box · {agent.namespace}
              </div>
            </div>
          </div>

          {/* Molt button */}
          <button
            onClick={() => setShowMoltModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/15 hover:border-amber-500/40"
          >
            <span>🐛</span>
            Molt
          </button>
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-black/20 px-3 py-2 text-center">
            <div className="text-xs font-semibold text-white">{agent.hostScore?.toFixed(1) ?? '—'}</div>
            <div className="text-[9px] text-[var(--muted)]">Host Score</div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 text-center">
            <div className="text-xs font-semibold text-white">{agent.inbox ?? 0}</div>
            <div className="text-[9px] text-[var(--muted)]">Inbox</div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 text-center">
            <div className="text-xs font-semibold text-white">{agent.events ?? 0}</div>
            <div className="text-[9px] text-[var(--muted)]">Events</div>
          </div>
        </div>

        {/* Identity + xDAI row */}
        <div className="mt-3 flex items-center justify-between rounded-xl border border-[rgba(176,128,92,0.1)] bg-black/20 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[var(--muted)]">IDENTITY</span>
            <span className="font-mono text-[11px] text-amber-300">{currentIdentity}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] font-semibold text-white">{totalXdaiBurned.toFixed(1)} xDAI</div>
              <div className="text-[8px] text-[var(--muted)]">burned</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold text-amber-300">{surgeScore} pts</div>
              <div className="text-[8px] text-[var(--muted)]">surge rep</div>
            </div>
          </div>
        </div>

        {/* TBA + links */}
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-[var(--muted)]">TBA: {agent.tba}</span>
          <div className="flex items-center gap-2">
            {agent.ipDomain && (
              <a
                href={`https://${agent.ipDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-sky-400 hover:underline"
              >
                {agent.ipDomain} ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Molt Modal */}
      {showMoltModal && (
        <MoltModal
          agentName={agent.name}
          currentIdentity={currentIdentity}
          ownerWallet={agent.ownerWallet}
          onClose={() => setShowMoltModal(false)}
          onSuccess={handleMoltSuccess}
        />
      )}
    </>
  );
}
