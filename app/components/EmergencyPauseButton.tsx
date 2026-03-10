'use client';
import { useEffect, useState, useCallback } from 'react';

interface Props {
  agentName: string;
  adminSecret?: string;
}

interface ApprovalState {
  emergencyPaused: boolean;
  requests: { id: string; status: string }[];
}

export function EmergencyPauseButton({ agentName, adminSecret }: Props) {
  const [state, setState] = useState<ApprovalState | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/approval/request?agent=${encodeURIComponent(agentName)}`);
      if (res.ok) setState(await res.json() as ApprovalState);
    } catch { /* silent */ }
  }, [agentName]);

  useEffect(() => { load(); }, [load]);

  async function handlePause() {
    if (!confirm) { setConfirm(true); return; }
    setLoading(true); setConfirm(false);
    try {
      const res = await fetch('/api/agent/approval/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emergency-pause', agentName }),
      });
      if (res.ok) setState(await res.json() as ApprovalState);
    } finally { setLoading(false); }
  }

  async function handleUnpause() {
    if (!adminSecret) return;
    setLoading(true);
    try {
      const res = await fetch('/api/agent/approval/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emergency-unpause', agentName, adminSecret }),
      });
      if (res.ok) setState(await res.json() as ApprovalState);
    } finally { setLoading(false); }
  }

  const pending = state?.requests.filter(r => r.status === 'pending').length ?? 0;
  const paused = state?.emergencyPaused ?? false;

  return (
    <div className="flex flex-col gap-2">
      {pending > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {pending} high-value action{pending > 1 ? 's' : ''} awaiting Safe approval
        </div>
      )}

      {paused ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-red-900/40 bg-red-900/10 px-3 py-2 text-[11px] text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            EMERGENCY PAUSED — agent halted
          </div>
          {adminSecret && (
            <button onClick={handleUnpause} disabled={loading}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:border-white/20 hover:text-white disabled:opacity-40">
              {loading ? 'Unpausing…' : 'Unpause Agent (Safe)'}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={handlePause}
          disabled={loading}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${confirm ? 'border border-red-500 bg-red-900/20 text-red-400' : 'border border-[var(--border)] text-[var(--muted)] hover:border-red-500/40 hover:text-red-400'}`}
        >
          {loading ? 'Pausing…' : confirm ? 'Confirm Emergency Pause' : 'Emergency Pause'}
        </button>
      )}
      {confirm && !paused && (
        <button onClick={() => setConfirm(false)} className="text-[10px] text-[var(--muted)] underline">Cancel</button>
      )}
    </div>
  );
}
