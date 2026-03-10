'use client';
import { useEffect, useState, useCallback } from 'react';

interface TaskLog { taskId: string; status: string; durationMs: number; retries: number; error?: string; description?: string; timestamp: number; }
interface Props { agentName: string; pollMs?: number; }

const statusColor = (s: string) => s === 'completed' ? '#22c55e' : s === 'timeout' ? '#f59e0b' : '#ef4444';
const fmt = (ms: number) => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;

export function TaskStatusBadge({ agentName, pollMs = 15_000 }: Props) {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [consecutive, setConsecutive] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/task/status?agent=${encodeURIComponent(agentName)}&limit=5`);
      if (res.ok) {
        const d = await res.json() as { logs: TaskLog[]; consecutiveFailures: number };
        setLogs(d.logs.reverse());
        setConsecutive(d.consecutiveFailures);
      }
    } catch { /* silent */ }
  }, [agentName]);

  useEffect(() => { load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [load, pollMs]);

  const last = logs[0];
  if (!last) return <div className="h-6 w-44 animate-pulse rounded-full bg-white/5" />;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[#0d0a07] px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-[var(--muted)]">Last Task</span>
        {consecutive > 0 && <span className="text-red-400">{consecutive} consecutive failures</span>}
      </div>
      {logs.map(l => (
        <div key={l.taskId} className="flex items-center gap-2">
          <span style={{ color: statusColor(l.status) }} className="w-16 shrink-0 capitalize">{l.status}</span>
          <span className="truncate text-[var(--muted)]">{l.description ?? l.taskId.slice(0, 8)}</span>
          <span className="ml-auto shrink-0 tabular-nums text-[var(--muted)]">{fmt(l.durationMs)}</span>
          {l.retries > 0 && <span className="text-amber-400">{l.retries}r</span>}
        </div>
      ))}
    </div>
  );
}
