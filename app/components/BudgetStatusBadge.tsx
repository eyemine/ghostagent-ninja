'use client';
import { useEffect, useState, useCallback } from 'react';
import type { BudgetState } from '../services/budget-tracker';

interface Props {
  agentName: string;
  adminSecret?: string;
  pollMs?: number;
}

export function BudgetStatusBadge({ agentName, adminSecret, pollMs = 30_000 }: Props) {
  const [state, setState] = useState<BudgetState | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/budget?agent=${encodeURIComponent(agentName)}`);
      if (res.ok) setState(await res.json() as BudgetState);
    } catch { /* silent */ }
  }, [agentName]);

  useEffect(() => {
    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  async function handleReset() {
    if (!adminSecret) return;
    setResetting(true);
    try {
      const res = await fetch('/api/agent/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', agentName, adminSecret }),
      });
      if (res.ok) setState(await res.json() as BudgetState);
    } finally { setResetting(false); }
  }

  if (!state) return (
    <div className="h-6 w-44 animate-pulse rounded-full bg-white/5" />
  );

  const pct = Math.min(100, state.bps / 100);
  const isPaused = state.paused;
  const isAlert = !isPaused && state.bps >= 8000;
  const color = isPaused ? '#ef4444' : isAlert ? '#f59e0b' : '#22c55e';
  const label = isPaused ? '⏸ PAUSED' : isAlert ? '⚠️' : '✓';

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[#0d0a07] px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--muted)]">Daily Budget</span>
        <span style={{ color }} className="font-medium tabular-nums">
          {state.spentToday.toFixed(4)}/{state.dailyCap.toFixed(4)} xDAI ({pct.toFixed(0)}%) {label}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>

      {(isPaused || isAlert) && adminSecret && (
        <button
          onClick={handleReset}
          disabled={resetting}
          className="mt-1 self-end rounded-md bg-[#b0805c] px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {resetting ? 'Resetting…' : 'Reset Budget (Safe)'}
        </button>
      )}
    </div>
  );
}
