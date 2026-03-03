'use client';

import { useState, useEffect } from 'react';
import {
  LEVEL_META,
  EVOLVE_ACTIONS,
  describeTransition,
  isExpired,
  daysUntilExpiry,
  type EvolveLevel,
  type LevelRecord,
} from '../services/evolve-level';

interface EvolveModalProps {
  agentName: string;
  tld: string;
  walletAddress: string;
  safeAddress?: string;
  tbaAddress?: string;
  onClose: () => void;
  onLevelChange?: (level: EvolveLevel) => void;
}

export default function EvolveModal({
  agentName,
  tld,
  walletAddress,
  safeAddress,
  tbaAddress,
  onClose,
  onLevelChange,
}: EvolveModalProps) {
  const [record, setRecord] = useState<LevelRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [storyIp, setStoryIp] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  useEffect(() => {
    if (!agentName || !walletAddress) return;
    setLoading(true);
    fetch(`/api/evolve?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`)
      .then(r => r.json() as Promise<LevelRecord>)
      .then(d => setRecord(d))
      .catch(() => setRecord(null))
      .finally(() => setLoading(false));
  }, [agentName, tld, walletAddress]);

  async function executeAction(action: 'upgrade' | 'downgrade') {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          name: agentName,
          tld,
          walletAddress,
          safeAddress: safeAddress ?? null,
          tbaAddress: tbaAddress ?? null,
        }),
      });
      const data = await res.json() as {
        status?: string;
        level?: EvolveLevel;
        workerTier?: string;
        expiresAt?: number;
        retention?: string;
        marketplaceBadge?: string;
        storyIp?: { fullDomain?: string; ipAccount?: string; error?: string } | null;
        message?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error ?? 'Request failed');

      const newLevel = data.level ?? (action === 'upgrade' ? 'imago' : 'pupa');
      setRecord(prev => prev ? {
        ...prev,
        level: newLevel,
        workerTier: (data.workerTier as any) ?? prev.workerTier,
        expiresAt: data.expiresAt ?? prev.expiresAt,
        retention: (data.retention as any) ?? prev.retention,
        marketplaceBadge: data.marketplaceBadge ?? prev.marketplaceBadge,
        storyIp: data.storyIp?.fullDomain ?? prev.storyIp,
        ipAssetDomain: data.storyIp?.fullDomain ?? prev.ipAssetDomain,
      } : null);

      if (data.storyIp?.fullDomain) setStoryIp(data.storyIp.fullDomain);
      setStatusMsg(data.message ?? `${action === 'upgrade' ? 'Evolved to Imago' : 'Returned to Pupa'} ✓`);
      setConfirmDowngrade(false);
      onLevelChange?.(newLevel);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const currentLevel = record?.level ?? 'egg';
  const action = EVOLVE_ACTIONS[currentLevel];
  const meta = LEVEL_META[currentLevel];
  const targetMeta = action ? LEVEL_META[action.to] : null;
  const transition = action ? describeTransition(action.from, action.to) : null;
  const expired = record ? isExpired(record) : false;
  const daysLeft = record ? daysUntilExpiry(record) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[var(--muted)] hover:text-[#f2eee4] transition-colors"
        >
          ✕
        </button>

        {/* Header */}
        <div className="mb-5 space-y-1">
          <h2 className="text-lg font-bold text-[#f2eee4]">Evolve Agent</h2>
          <p className="text-xs text-[var(--muted)]">
            <span className="font-medium text-[#f2eee4]">{agentName}.{tld}</span>
            {' '}· {agentName}_@nftmail.box
          </p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--muted)] animate-pulse">Scanning level…</div>
        ) : (
          <>
            {/* Current level card */}
            <div className={`mb-4 rounded-xl border px-4 py-3 ${meta.bgColor} ${meta.ringColor} ring-1`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.15em] text-[var(--muted)]">CURRENT LEVEL</div>
                  <div className={`mt-0.5 text-xl font-bold ${meta.color}`}>{meta.label}</div>
                  <p className="mt-1 text-[11px] text-[var(--muted)] leading-relaxed">{meta.description}</p>
                </div>
                <div className="shrink-0 text-3xl select-none">
                  {currentLevel === 'egg' ? '🥚' : currentLevel === 'pupa' ? '🐛' : currentLevel === 'imago' ? '🦋' : '👻'}
                </div>
              </div>

              {/* Expiry / retention */}
              {record?.retention === '30-day' && daysLeft !== null && (
                <div className={`mt-2 text-[10px] ${daysLeft <= 5 ? 'text-red-400' : 'text-[var(--muted)]'}`}>
                  {expired ? 'Subscription expired' : `Renews in ${daysLeft}d`}
                </div>
              )}
              {record?.retention === 'infinite' && (
                <div className="mt-2 text-[10px] text-emerald-300">Infinite retention ∞</div>
              )}

              {/* Story .ip badge */}
              {record?.ipAssetDomain && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                  {record.ipAssetDomain}
                </div>
              )}
            </div>

            {/* Action block */}
            {action && !statusMsg && (
              <>
                {/* Upgrade path */}
                {action.to === 'imago' && targetMeta && (
                  <div className="mb-4 rounded-xl border border-[var(--border)] bg-white/[0.02] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-base font-bold ${targetMeta.color}`}>
                        {targetMeta.label}
                      </span>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-[#f2eee4]">
                          +{action.oneOffXdai} xDAI one-off
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          then {action.annualXdai} xDAI / yr
                        </div>
                      </div>
                    </div>

                    {/* Unlocks list */}
                    <div className="space-y-1">
                      {action.unlocks.map(u => (
                        <div key={u} className="flex items-center gap-2 text-[11px] text-[#f2eee4]">
                          <span className="text-emerald-400">✓</span>
                          {u}
                        </div>
                      ))}
                    </div>

                    {/* Preserves */}
                    {transition && (
                      <div className="rounded-lg bg-white/[0.03] px-3 py-2 space-y-0.5">
                        <div className="text-[9px] font-semibold tracking-[0.14em] text-[var(--muted)]">PRESERVED</div>
                        {transition.preserves.map(p => (
                          <div key={p} className="text-[10px] text-[var(--muted)]">· {p}</div>
                        ))}
                      </div>
                    )}

                    {/* CTA */}
                    <button
                      disabled={busy}
                      onClick={() => executeAction('upgrade')}
                      className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:shadow-violet-500/40 disabled:opacity-50"
                    >
                      {busy ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" /></svg>
                          Evolving…
                        </span>
                      ) : (
                        `Evolve to Imago +${action.oneOffXdai} xDAI`
                      )}
                    </button>
                    <p className="text-center text-[9px] text-[var(--muted)]">
                      Zero lock-in · drop back to Pupa any time · email preserved
                    </p>
                  </div>
                )}

                {/* Downgrade path */}
                {action.to === 'pupa' && (
                  <div className="mb-4 rounded-xl border border-[var(--border)] bg-white/[0.02] p-4 space-y-3">
                    {!confirmDowngrade ? (
                      <>
                        <p className="text-xs text-[var(--muted)] leading-relaxed">
                          {action.downgradeLabel}
                        </p>
                        {transition?.loses && transition.loses.length > 0 && (
                          <div className="rounded-lg bg-amber-500/10 px-3 py-2 space-y-0.5 ring-1 ring-amber-500/20">
                            <div className="text-[9px] font-semibold tracking-[0.14em] text-amber-300">YOU WILL LOSE</div>
                            {transition.loses.map(l => (
                              <div key={l} className="text-[10px] text-amber-300">· {l}</div>
                            ))}
                          </div>
                        )}
                        {transition?.preserves && (
                          <div className="rounded-lg bg-white/[0.03] px-3 py-2 space-y-0.5">
                            <div className="text-[9px] font-semibold tracking-[0.14em] text-[var(--muted)]">PRESERVED</div>
                            {transition.preserves.map(p => (
                              <div key={p} className="text-[10px] text-[var(--muted)]">· {p}</div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => setConfirmDowngrade(true)}
                          className="w-full rounded-xl border border-zinc-500/30 bg-zinc-500/10 py-2.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-500/20"
                        >
                          Drop back to Pupa
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-amber-300">
                          Are you sure? Infinite retention will revert to 30-day cycle.
                        </p>
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => executeAction('downgrade')}
                            className="flex-1 rounded-xl bg-zinc-500/15 py-2.5 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-500/25 transition hover:bg-zinc-500/25 disabled:opacity-50"
                          >
                            {busy ? 'Processing…' : 'Confirm downgrade'}
                          </button>
                          <button
                            onClick={() => setConfirmDowngrade(false)}
                            className="flex-1 rounded-xl border border-[var(--border)] py-2.5 text-xs text-[var(--muted)] hover:text-[#f2eee4]"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* No upgrade path (ghost tier) */}
            {!action && currentLevel === 'ghost' && (
              <div className="mb-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3 text-xs text-fuchsia-300">
                Ghost tier — sovereign agent. No further evolution path.
              </div>
            )}

            {/* No upgrade path (egg tier — must mint first) */}
            {!action && currentLevel === 'egg' && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                Mint your .nftmail.gno or .agent.gno name first, then return here to evolve.
              </div>
            )}
          </>
        )}

        {/* Status message */}
        {statusMsg && (
          <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3 space-y-1">
            <div className="text-xs font-semibold text-emerald-300">{statusMsg}</div>
            {storyIp && (
              <div className="text-[10px] text-[var(--muted)]">
                Story .ip asset: <span className="text-violet-300">{storyIp}</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="mb-3 rounded-xl bg-red-500/10 px-4 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
            {errorMsg}
          </div>
        )}

        {/* Level ladder */}
        <div className="mt-2 flex items-center justify-center gap-1 text-[9px] text-[var(--muted)]">
          {(['egg', 'pupa', 'imago', 'ghost'] as EvolveLevel[]).map((lvl, i, arr) => (
            <span key={lvl} className="flex items-center gap-1">
              <span className={lvl === currentLevel ? LEVEL_META[lvl].color + ' font-bold' : ''}>
                {LEVEL_META[lvl].label}
              </span>
              {i < arr.length - 1 && <span className="opacity-40">→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
