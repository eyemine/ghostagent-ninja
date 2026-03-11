'use client';

import { useState, useEffect } from 'react';

// Canary timestamp is written to KV by the Cloudflare Worker cron (every 5 min).
// Reading from the worker eliminates hourly git commits that triggered Netlify deploys.
const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

export function WarrantCanary() {
  const [lastAlive, setLastAlive] = useState<number | null>(null);
  const [alive, setAlive]         = useState(true);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function fetchCanary() {
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getCanary' }),
        });
        if (!res.ok) { setAlive(false); return; }
        const data = await res.json() as { alive: boolean; lastAlive: number | null };
        setAlive(data.alive);
        setLastAlive(data.lastAlive);
      } catch {
        // Network failure — keep alive=true, show last known
      } finally {
        setLoading(false);
      }
    }
    fetchCanary();
  }, []);

  const ts = lastAlive
    ? new Date(lastAlive).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : loading ? 'checking...' : 'unknown';

  if (!loading && !alive) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-[11px] font-semibold text-red-400">WARRANT CANARY EXPIRED</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-[11px] font-medium text-emerald-300">
            No secret orders received
          </span>
        </div>
        <span className="text-[10px] text-[var(--muted)]">last checked {ts}</span>
      </div>
    </div>
  );
}
