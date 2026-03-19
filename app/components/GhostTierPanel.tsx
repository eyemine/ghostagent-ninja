'use client';

/**
 * GhostTierPanel
 *
 * Full vault.gno settings panel for the Ghost tier upgrade path.
 * Shown on /dashboard/settings/ghost and embeddable in agent settings.
 *
 * States:
 *   loading  — fetching level record
 *   imago    — eligible: show 200 xDAI CTA + feature list
 *   ghost    — already Ghost: show soulbound badge, Arweave status, tunnel endpoint
 *   other    — not yet eligible (larva/pupa): show gating message
 */

import { useState, useEffect, useCallback } from 'react';
import {
  LEVEL_META,
  EVOLVE_ACTIONS,
  type LevelRecord,
  type EvolveLevel,
} from '../services/evolve-level';

interface Props {
  agentName:     string;
  tld:           string;
  walletAddress: string;
  safeAddress?:  string;
  onUpgraded?:   () => void;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function GhostTierPanel({ agentName, tld, walletAddress, safeAddress, onUpgraded }: Props) {
  const [record,    setRecord]    = useState<LevelRecord | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [busy,      setBusy]      = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null);

  const loadRecord = useCallback(() => {
    if (!agentName || !walletAddress) return;
    setLoading(true);
    fetch(`/api/evolve?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`)
      .then(r => r.json() as Promise<LevelRecord>)
      .then(d => setRecord(d))
      .catch(() => setRecord(null))
      .finally(() => setLoading(false));
  }, [agentName, tld, walletAddress]);

  useEffect(() => { loadRecord(); }, [loadRecord]);

  async function handleUpgrade() {
    if (!confirmed || busy) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/evolve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'upgrade',
          name:          agentName,
          tld,
          walletAddress,
          safeAddress:   safeAddress ?? null,
          tbaAddress:    null,
        }),
      });

      const data = await res.json() as {
        status?: string;
        level?: EvolveLevel;
        message?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error ?? 'Request failed');

      setStatusMsg(data.message ?? 'Ghost tier activated ✓');
      setRecord(prev => prev
        ? { ...prev, level: 'ghost', workerTier: 'ghost', isSoulbound: true,
            arweaveArchive: { enabled: true },
            tunnelEndpoint: null,
            ghostActivatedAt: Date.now() }
        : prev
      );
      setConfirmed(false);
      onUpgraded?.();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const ghostAction = EVOLVE_ACTIONS['imago'];
  const currentLevel = record?.level ?? 'larva';
  const isGhost  = currentLevel === 'ghost';
  const isImago  = currentLevel === 'imago';
  const eligible = isGhost || isImago;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">👻</span>
        <div>
          <h2 className="text-base font-bold text-[#f2eee4]">Ghost Tier</h2>
          <p className="text-xs text-[var(--muted)]">
            Sovereign agent · ERC-5192 Soulbound · Arweave permanent archive
          </p>
        </div>
        {isGhost && (
          <span className="ml-auto rounded-full bg-fuchsia-500/15 px-3 py-1 text-[10px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/25">
            ACTIVE
          </span>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="py-8 text-center text-xs text-[var(--muted)] animate-pulse">Loading level…</div>
      )}

      {/* ── Not eligible ── */}
      {!loading && !eligible && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-5 space-y-2">
          <div className="text-xs font-semibold text-amber-300">
            Imago tier required
          </div>
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Ghost is a one-time upgrade from Imago (200 xDAI, lifetime).
            Your agent is currently <span className={`font-semibold ${LEVEL_META[currentLevel].color}`}>{LEVEL_META[currentLevel].label}</span>.
            {currentLevel === 'pupa' && ' Cycle to Imago first, then return here.'}
            {currentLevel === 'larva' && ' Mint your agent name first, then cycle to Pupa → Imago.'}
          </p>
          <div className="flex items-center gap-1 mt-1">
            {(['larva', 'pupa', 'imago'] as EvolveLevel[]).map((lvl, i, arr) => (
              <span key={lvl} className="flex items-center gap-1 text-[10px]">
                <span className={lvl === currentLevel ? LEVEL_META[lvl].color + ' font-bold' : 'text-zinc-600'}>
                  {LEVEL_META[lvl].label}
                </span>
                {i < arr.length - 1 && <span className="text-zinc-700">→</span>}
              </span>
            ))}
            <span className="text-zinc-700 text-[10px]"> → </span>
            <span className="text-[10px] text-fuchsia-500">Ghost</span>
          </div>
        </div>
      )}

      {/* ── Already Ghost: status panel ── */}
      {!loading && isGhost && record && (
        <div className="space-y-3">

          {/* Soulbound badge */}
          <div className="flex items-center gap-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 px-4 py-3">
            <span className="text-2xl">🔮</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-fuchsia-300">Soulbound Identity</span>
                <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/25">ERC-5192</span>
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                {agentName}.{tld} · Non-transferable · Sealed to wallet {shortAddr(walletAddress)}
              </p>
            </div>
          </div>

          {/* Arweave archive */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🗄️</span>
                <span className="text-xs font-semibold text-emerald-300">Arweave Archive</span>
              </div>
              {record.arweaveArchive?.txId
                ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/25">ACTIVE</span>
                : <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[9px] text-zinc-400 ring-1 ring-zinc-500/25">PENDING</span>
              }
            </div>

            {record.arweaveArchive?.txId ? (
              <a
                href={`https://arweave.net/${record.arweaveArchive.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-[10px] text-[var(--muted)] hover:text-emerald-300 transition truncate"
              >
                ar://{record.arweaveArchive.txId.slice(0, 24)}… ↗
              </a>
            ) : (
              <p className="text-[10px] text-[var(--muted)]">
                Archive initialises on first agent output. All future outputs are preserved permanently on Arweave.
              </p>
            )}

            {record.arweaveArchive?.archivedAt && (
              <p className="text-[9px] text-zinc-600">First archived {formatDate(record.arweaveArchive.archivedAt)}</p>
            )}
          </div>

          {/* Ghost-Tunnel */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span>🌐</span>
              <span className="text-xs font-semibold text-[#f2eee4]">Ghost-Tunnel Endpoint</span>
              {record.tunnelEndpoint
                ? <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] text-emerald-300 ring-1 ring-emerald-500/25">CONNECTED</span>
                : <span className="ml-auto rounded-full bg-zinc-500/15 px-2 py-0.5 text-[9px] text-zinc-400 ring-1 ring-zinc-500/25">NOT REGISTERED</span>
              }
            </div>
            {record.tunnelEndpoint ? (
              <p className="font-mono text-[10px] text-[#b0805c] break-all">{record.tunnelEndpoint}</p>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] text-[var(--muted)]">
                  Register your local brain to activate a private A2A tunnel endpoint.
                </p>
                <code className="block rounded bg-black/30 px-2 py-1 text-[9px] text-zinc-400 font-mono">
                  ghost-agent tunnel register --agent {agentName}.{tld}
                </code>
              </div>
            )}
          </div>

          {/* Activation date */}
          {record.ghostActivatedAt && (
            <p className="text-center text-[9px] text-zinc-600">
              Ghost activated {formatDate(record.ghostActivatedAt)} · permanent · no renewal required
            </p>
          )}

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: '🔒', label: 'Governance rights', active: true },
              { icon: '💰', label: 'IP revenue share',  active: true },
              { icon: '🧠', label: 'Local brain',       active: !!record.tunnelEndpoint },
              { icon: '📡', label: 'Ghost-Tunnel',      active: !!record.tunnelEndpoint },
            ].map(f => (
              <div key={f.label} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                f.active
                  ? 'border-fuchsia-500/20 bg-fuchsia-500/5'
                  : 'border-zinc-700/30 bg-zinc-800/20'
              }`}>
                <span className="text-sm">{f.icon}</span>
                <span className={`text-[10px] font-medium ${f.active ? 'text-fuchsia-300' : 'text-zinc-600'}`}>
                  {f.label}
                </span>
                {f.active && <span className="ml-auto text-[9px] text-emerald-400">✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Imago: upgrade CTA ── */}
      {!loading && isImago && !statusMsg && ghostAction && (
        <div className="space-y-4">

          {/* Price callout */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-4">
            <div className="space-y-1">
              <div className="text-sm font-bold text-fuchsia-300">Drop the Eternal Anchor</div>
              <div className="text-[11px] text-[var(--muted)]">One-time payment. No renewal. Ever.</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xl font-bold text-[#f2eee4]">200 xDAI</div>
              <div className="text-[10px] text-zinc-500">≈ $200 USD</div>
            </div>
          </div>

          {/* Unlocks */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">WHAT YOU UNLOCK</div>
            {ghostAction.unlocks.map(u => (
              <div key={u} className="flex items-start gap-2 text-[11px] text-[#f2eee4]">
                <span className="mt-0.5 shrink-0 text-fuchsia-400">✦</span>
                {u}
              </div>
            ))}
          </div>

          {/* One-way warning */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1">
            <div className="text-[10px] font-semibold text-amber-300">⚠ This is irreversible</div>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">
              Once you become Ghost, your agent is <strong className="text-amber-300">Soulbound</strong>.
              It cannot be transferred, sold, or listed on the marketplace.
              It is permanently sealed to wallet <span className="font-mono text-[#b0805c]">{shortAddr(walletAddress)}</span>.
            </p>
          </div>

          {/* Confirm checkbox */}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[rgba(176,128,92,0.2)] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.04] transition">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-fuchsia-500"
            />
            <span className="text-[11px] text-[var(--muted)] leading-relaxed">
              I understand this is permanent and irreversible. My agent will become a soulbound identity sealed to my wallet.
            </span>
          </label>

          {errorMsg && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {errorMsg}
            </div>
          )}

          <button
            disabled={!confirmed || busy}
            onClick={handleUpgrade}
            className="w-full rounded-xl bg-gradient-to-r from-fuchsia-700 to-purple-700 py-3.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-500/20 transition hover:shadow-fuchsia-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
                </svg>
                Sealing identity…
              </span>
            ) : (
              'Drop the Eternal Anchor — 200 xDAI'
            )}
          </button>

          <p className="text-center text-[9px] text-zinc-600">
            Irreversible · ERC-5192 Soulbound · governance rights · no marketplace listing
          </p>
        </div>
      )}

      {/* ── Success ── */}
      {statusMsg && (
        <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/5 px-4 py-5 text-center space-y-2">
          <div className="text-2xl">👻</div>
          <div className="text-sm font-bold text-fuchsia-300">{statusMsg}</div>
          <p className="text-[11px] text-[var(--muted)]">
            Your identity is now soulbound. Arweave archive will initialise on first agent output.
          </p>
          <button onClick={loadRecord} className="mt-2 text-[10px] text-[var(--muted)] hover:text-fuchsia-300 transition underline underline-offset-2">
            Refresh status
          </button>
        </div>
      )}
    </div>
  );
}
