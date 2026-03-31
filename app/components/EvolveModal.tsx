'use client';

import { useState, useEffect } from 'react';
import {
  LEVEL_META,
  EVOLVE_ACTIONS,
  DOWNGRADE_ACTIONS,
  describeTransition,
  isExpired,
  daysUntilExpiry,
  type EvolveLevel,
  type LevelRecord,
} from '../services/evolve-level';
import { TransakButton } from './TransakWidget';
import { MercuryoButton } from './MercuryoWidget';
import { FEATURES } from '../constants/features';

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
      setStatusMsg(data.message ?? `${action === 'upgrade' ? 'Molted to Imago' : 'Returned to Pupa'} ✓`);
      setConfirmDowngrade(false);
      onLevelChange?.(newLevel);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const currentLevel = record?.level ?? 'larva';
  const upgradeAction = EVOLVE_ACTIONS[currentLevel];
  const downgradeAction = DOWNGRADE_ACTIONS[currentLevel];
  const action = upgradeAction; // primary CTA is always upgrade
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
          <h2 className="text-lg font-bold text-[#f2eee4]">Molt Agent</h2>
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
                  {currentLevel === 'larva' ? '🐛' : currentLevel === 'pupa' ? '🐛' : currentLevel === 'imago' ? '🦋' : '👻'}
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
                          Molting…
                        </span>
                      ) : (
                        `Molt to Imago +${action.oneOffXdai} xDAI`
                      )}
                    </button>

                    {/* Transak fiat on-ramp — suppressed until FEATURES.transakOnRamp = true */}
                    {FEATURES.transakOnRamp && (
                      <TransakButton
                        walletAddress={walletAddress}
                        defaultAmount={action.oneOffXdai ? Math.max(10, action.oneOffXdai * 2) : 10}
                        label={`Pay with Card from $10 (Transak)`}
                        onSuccess={(orderId) => {
                          setStatusMsg(`Card payment received ✓ — order ${orderId.slice(0, 8)}. xDAI will arrive shortly, then click Molt.`);
                        }}
                      />
                    )}

                    {/* Mercuryo fallback — suppressed until FEATURES.mercuryoOnRamp = true */}
                    {FEATURES.mercuryoOnRamp && (
                      <>
                        {FEATURES.transakOnRamp && (
                          <div className="flex items-center gap-2 my-1">
                            <div className="flex-1 h-px bg-[var(--border)]" />
                            <span className="text-[9px] text-[var(--muted)]">or if Transak unavailable in your region</span>
                            <div className="flex-1 h-px bg-[var(--border)]" />
                          </div>
                        )}
                        <MercuryoButton
                          walletAddress={walletAddress}
                          defaultAmount={action.oneOffXdai ? Math.max(10, action.oneOffXdai * 2) : 10}
                          label={`Pay with Card from $10 (Mercuryo)`}
                          onSuccess={(txId) => {
                            setStatusMsg(`Card payment received ✓ — tx ${txId.slice(0, 8)}. xDAI will arrive shortly, then click Molt.`);
                          }}
                        />
                      </>
                    )}

                    <p className="text-center text-[9px] text-[var(--muted)]">
                      Zero lock-in · drop back to Pupa any time · email preserved
                    </p>
                  </div>
                )}

                {/* Ghost upgrade path */}
                {action.to === 'ghost' && targetMeta && (
                  <div className="mb-4 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">👻</span>
                        <span className="text-base font-bold text-fuchsia-300">Become Ghost</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-[#f2eee4]">200 xDAI</div>
                        <div className="text-[10px] text-[var(--muted)]">lifetime · no renewal</div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-fuchsia-500/15 bg-black/20 px-3 py-2 text-[10px] text-fuchsia-200/70 leading-relaxed">
                      This is a one-way fork. Ghost agents become <strong className="text-fuchsia-300">Soulbound</strong> — your identity is sealed to you, not transferable, not sellable. You cannot return to Imago.
                    </div>

                    <div className="space-y-1.5">
                      {action.unlocks.map(u => (
                        <div key={u} className="flex items-start gap-2 text-[11px] text-[#f2eee4]">
                          <span className="mt-0.5 shrink-0 text-fuchsia-400">✦</span>
                          {u}
                        </div>
                      ))}
                    </div>

                    <button
                      disabled={busy}
                      onClick={() => executeAction('upgrade')}
                      className="w-full rounded-xl bg-gradient-to-r from-fuchsia-700 to-purple-700 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/20 transition hover:shadow-fuchsia-500/40 disabled:opacity-50"
                    >
                      {busy ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" /></svg>
                          Sealing identity…
                        </span>
                      ) : (
                        'Drop the Eternal Anchor — 200 xDAI'
                      )}
                    </button>
                    <p className="text-center text-[9px] text-[var(--muted)]">
                      Irreversible · ERC-5192 Soulbound · no marketplace listing
                    </p>
                  </div>
                )}

                {/* Imago → Pupa downgrade path */}
                {downgradeAction && downgradeAction.to === 'pupa' && (
                  <div className="mb-4 rounded-xl border border-[var(--border)] bg-white/[0.02] p-4 space-y-3">
                    {!confirmDowngrade ? (
                      <>
                        <p className="text-xs text-[var(--muted)] leading-relaxed">
                          {downgradeAction.downgradeLabel}
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
                          Are you sure? Infinite retention will revert to 30-day window.
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

            {/* Ghost tier — status panel */}
            {currentLevel === 'ghost' && record && (
              <div className="mb-4 space-y-3">

                {/* Soulbound badge */}
                <div className="flex items-center gap-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 px-4 py-3">
                  <span className="text-2xl">🔮</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-fuchsia-300">Soulbound Identity</span>
                      <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/25">ERC-5192</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      Non-transferable · cannot be listed · sealed to your wallet
                    </p>
                  </div>
                </div>

                {/* Arweave archive status */}
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">🗄️</span>
                      <span className="text-xs font-semibold text-emerald-300">Arweave Archive</span>
                    </div>
                    {record.arweaveArchive?.txId ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/25">ACTIVE</span>
                    ) : (
                      <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[9px] text-zinc-400 ring-1 ring-zinc-500/25">PENDING</span>
                    )}
                  </div>
                  {record.arweaveArchive?.txId ? (
                    <a
                      href={`https://arweave.net/${record.arweaveArchive.txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block font-mono text-[10px] text-[var(--muted)] hover:text-emerald-300 transition truncate"
                    >
                      ar://{record.arweaveArchive.txId.slice(0, 20)}… ↗
                    </a>
                  ) : (
                    <p className="text-[10px] text-[var(--muted)]">
                      Archive initialises on first agent output. All future outputs are permanently stored.
                    </p>
                  )}
                  {record.arweaveArchive?.archivedAt && (
                    <p className="text-[9px] text-zinc-600">
                      First archived {new Date(record.arweaveArchive.archivedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Ghost-Tunnel endpoint */}
                <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">🌐</span>
                    <span className="text-xs font-semibold text-[#f2eee4]">Ghost-Tunnel</span>
                  </div>
                  {record.tunnelEndpoint ? (
                    <p className="font-mono text-[10px] text-[#b0805c] break-all">{record.tunnelEndpoint}</p>
                  ) : (
                    <p className="text-[10px] text-[var(--muted)]">
                      Tunnel endpoint assigned after local brain registration.
                      Run <code className="font-mono text-[9px]">ghost-agent tunnel register</code> to activate.
                    </p>
                  )}
                </div>

                {/* Activation timestamp */}
                {record.ghostActivatedAt && (
                  <p className="text-center text-[9px] text-zinc-600">
                    Ghost activated {new Date(record.ghostActivatedAt).toLocaleDateString()} · permanent · no renewal required
                  </p>
                )}
              </div>
            )}

            {/* No upgrade path (larva tier — must mint first) */}
            {!action && currentLevel === 'larva' && (
              <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
                Mint your .nftmail.gno or .agent.gno name first, then return here to molt.
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
          {(['larva', 'pupa', 'imago', 'ghost'] as EvolveLevel[]).map((lvl, i, arr) => (
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
