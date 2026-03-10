'use client';
import { useEffect, useState, useCallback } from 'react';
import type { RateLimitState } from '../services/rate-limit-tracker';

interface Props { agentName: string; pollMs?: number; }

export function RateLimitStatus({ agentName, pollMs = 30_000 }: Props) {
  const [state, setState] = useState<RateLimitState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/rate-limit?agent=${encodeURIComponent(agentName)}`);
      if (res.ok) setState(await res.json() as RateLimitState);
    } catch { /* silent */ }
  }, [agentName]);

  useEffect(() => { load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [load, pollMs]);

  if (!state) return <div className="h-6 w-44 animate-pulse rounded-full bg-white/5" />;

  const pct = Math.min(100, state.bps / 100);
  const color = state.cooldown ? '#ef4444' : state.bps >= 8000 ? '#f59e0b' : '#22c55e';
  const label = state.cooldown ? '⏸ COOLDOWN' : state.bps >= 8000 ? '⚠️' : '✓';
  const cooldownMins = state.cooldownUntil ? Math.ceil((state.cooldownUntil - Date.now()) / 60000) : 0;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[#0d0a07] px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--muted)]">Rate Limit</span>
        <span style={{ color }} className="font-medium tabular-nums">
          {state.count}/{state.limit} requests ({pct.toFixed(0)}%) {label}
          {state.cooldown && cooldownMins > 0 && <span className="ml-1 text-[var(--muted)]">({cooldownMins}m left)</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
