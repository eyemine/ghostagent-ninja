'use client';

import { useState, useEffect } from 'react';
import {
  getRequirementsForTld,
  fmtHost,
  tierColor,
  type StakeTier,
  type StakeRequirement,
} from '../services/host-staking';

interface StakingModalProps {
  agentName: string;
  tld: string;
  walletAddress: string;
  onClose: () => void;
  onStakeChange?: (stakedHost: number, tier: StakeTier) => void;
}

interface StakeState {
  stakedHost: number;
  activeTier: StakeTier;
  unlockedSend: boolean;
  persistenceDays: number | null;
  expiresAt: number | null;
}

export default function StakingModal({
  agentName,
  tld,
  walletAddress,
  onClose,
  onStakeChange,
}: StakingModalProps) {
  const requirements = getRequirementsForTld(tld);

  const [stake, setStake] = useState<StakeState>({
    stakedHost: 0,
    activeTier: 'none',
    unlockedSend: false,
    persistenceDays: null,
    expiresAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lostUnlocks, setLostUnlocks] = useState<string[]>([]);

  useEffect(() => {
    if (!agentName || !walletAddress) return;
    setLoading(true);
    fetch(`/api/stake?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`)
      .then(r => r.json() as Promise<StakeState>)
      .then(d => setStake(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentName, tld, walletAddress]);

  async function submit(hostAmount: number) {
    if (busy || !walletAddress) return;
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setLostUnlocks([]);

    try {
      const res = await fetch('/api/stake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, name: agentName, tld, hostAmount, walletAddress }),
      });
      const data = await res.json() as {
        status?: string;
        stakedHost?: number;
        activeTier?: StakeTier;
        unlockedSend?: boolean;
        persistenceDays?: number | null;
        expiresAt?: number | null;
        lostUnlocks?: string[];
        message?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error ?? 'Request failed');

      const updated: StakeState = {
        stakedHost:      data.stakedHost      ?? stake.stakedHost,
        activeTier:      data.activeTier      ?? stake.activeTier,
        unlockedSend:    data.unlockedSend    ?? stake.unlockedSend,
        persistenceDays: data.persistenceDays ?? null,
        expiresAt:       data.expiresAt       ?? null,
      };
      setStake(updated);
      setStatusMsg(data.message ?? `${mode === 'stake' ? 'Staked' : 'Unstaked'} ${hostAmount} $HOST ✓`);
      setLostUnlocks(data.lostUnlocks ?? []);
      setCustomAmount('');
      onStakeChange?.(updated.stakedHost, updated.activeTier);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const parsedCustom = parseFloat(customAmount);
  const customValid = Number.isFinite(parsedCustom) && parsedCustom > 0;

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
          <h2 className="text-lg font-bold text-[#f2eee4]">$HOST Staking</h2>
          <p className="text-xs text-[var(--muted)]">
            <span className="font-medium text-[#f2eee4]">{agentName}.{tld}</span>
            {' '}· {agentName}_@nftmail.box
          </p>
        </div>

        {/* Current stake status */}
        {loading ? (
          <div className="mb-4 text-xs text-[var(--muted)] animate-pulse">Loading stake…</div>
        ) : (
          <div className="mb-4 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Staked</span>
              <span className="font-semibold text-[#f2eee4]">{fmtHost(stake.stakedHost)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">Tier</span>
              <span className={`font-semibold capitalize ${tierColor(stake.activeTier)}`}>
                {stake.activeTier === 'none' ? 'None' : stake.activeTier.replace(/-/g, ' ')}
                {stake.activeTier !== 'none' && ' ✓'}
              </span>
            </div>
            {stake.unlockedSend && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">Send emails</span>
                <span className="font-semibold text-emerald-300">Unlocked ✓</span>
              </div>
            )}
            {stake.persistenceDays && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">Persistence</span>
                <span className="font-semibold text-cyan-300">{stake.persistenceDays}d</span>
              </div>
            )}
            {stake.expiresAt && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">Expires</span>
                <span className="text-[var(--muted)]">{new Date(stake.expiresAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Stake / Unstake toggle */}
        <div className="mb-4 flex gap-2">
          {(['stake', 'unstake'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setStatusMsg(null); setErrorMsg(null); setLostUnlocks([]); }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                mode === m
                  ? 'bg-[rgba(176,128,92,0.15)] text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.3)]'
                  : 'text-[var(--muted)] hover:text-[#f2eee4]'
              }`}
            >
              {m === 'stake' ? 'Stake $HOST' : 'Unstake'}
            </button>
          ))}
        </div>

        {/* Requirements grid — only shown in stake mode */}
        {mode === 'stake' && (
          <div className="mb-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-[0.15em] text-[var(--muted)]">UNLOCK TIERS</div>
            {requirements.map((req: StakeRequirement) => {
              const isActive = stake.stakedHost >= req.hostAmount;
              return (
                <button
                  key={req.tier}
                  disabled={busy || isActive}
                  onClick={() => submit(Math.max(0, req.hostAmount - stake.stakedHost))}
                  className={`group w-full rounded-xl border p-3 text-left transition-all disabled:cursor-default ${
                    isActive
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-[var(--border)] hover:border-[rgba(176,128,92,0.3)] hover:bg-[rgba(176,128,92,0.04)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isActive ? 'text-emerald-300' : 'text-[#f2eee4] group-hover:text-[#b0805c]'}`}>
                      {req.label}
                      {isActive ? ' ✓' : ''}
                    </span>
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                        : 'bg-[rgba(176,128,92,0.1)] text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.2)]'
                    }`}>
                      {fmtHost(req.hostAmount)} · ~${req.usdEquiv}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {req.unlocks.map(u => (
                      <span key={u} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] text-[var(--muted)] ring-1 ring-white/[0.07]">
                        {u}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom amount input */}
        <div className="mb-3 space-y-2">
          <div className="text-[10px] font-semibold tracking-[0.15em] text-[var(--muted)]">
            CUSTOM AMOUNT
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 focus-within:border-[rgba(176,128,92,0.4)]">
              <input
                type="number"
                min="1"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                placeholder="e.g. 100"
                className="flex-1 bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
              />
              <span className="shrink-0 text-xs text-[var(--muted)]">$HOST</span>
            </div>
            <button
              disabled={!customValid || busy}
              onClick={() => submit(parsedCustom)}
              className="rounded-xl bg-[rgba(176,128,92,0.12)] px-4 py-2 text-xs font-semibold text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)] transition-all hover:bg-[rgba(176,128,92,0.2)] disabled:opacity-40"
            >
              {busy ? '…' : mode === 'stake' ? 'Stake' : 'Unstake'}
            </button>
          </div>
        </div>

        {/* Status / error messages */}
        {statusMsg && (
          <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
            {statusMsg}
          </div>
        )}
        {lostUnlocks.length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300 ring-1 ring-amber-500/20">
            Unlocks lost: {lostUnlocks.join(', ')}
          </div>
        )}
        {errorMsg && (
          <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
            {errorMsg}
          </div>
        )}

        {/* Zero lock-in note */}
        <p className="mt-4 text-center text-[9px] text-[var(--muted)]">
          Zero lock-in · unstake any time · no withdrawal fee
        </p>
      </div>
    </div>
  );
}
