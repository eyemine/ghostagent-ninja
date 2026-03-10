'use client';
import { useEffect, useState, useCallback } from 'react';
import type { StorageState } from '../services/storage-quota-manager';

interface Props { agentName: string; pollMs?: number; }
const MB = 1024 * 1024;

export function StorageQuotaBadge({ agentName, pollMs = 60_000 }: Props) {
  const [state, setState] = useState<StorageState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/storage?agent=${encodeURIComponent(agentName)}`);
      if (res.ok) setState(await res.json() as StorageState);
    } catch { /* silent */ }
  }, [agentName]);

  useEffect(() => { load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [load, pollMs]);

  if (!state) return <div className="h-6 w-44 animate-pulse rounded-full bg-white/5" />;

  const pct = Math.min(100, state.bps / 100);
  const isFull = state.bps >= 10000;
  const isAlert95 = !isFull && state.bps >= 9500;
  const isAlert80 = !isAlert95 && state.bps >= 8000;
  const color = isFull ? '#ef4444' : isAlert95 ? '#f97316' : isAlert80 ? '#f59e0b' : '#22c55e';
  const label = isFull ? 'FULL' : isAlert95 ? '⚠️ 95%' : isAlert80 ? '⚠️' : '✓';
  const usedMB = (state.usedBytes / MB).toFixed(0);
  const capMB = (state.capBytes / MB).toFixed(0);
  const archived = state.files.filter(f => f.archived).length;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[#0d0a07] px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--muted)]">Storage</span>
        <span style={{ color }} className="font-medium tabular-nums">
          {usedMB}MB/{capMB}MB ({pct.toFixed(0)}%) {label}
          {archived > 0 && <span className="ml-1 text-[var(--muted)]">· {archived} archived</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
