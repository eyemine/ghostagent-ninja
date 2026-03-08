'use client';
import { useState, useEffect, useCallback } from 'react';
import { type GlassBoxEntry, summariseEntry } from '../services/glassbox-xmtp-logger';

const EVT_COLOR: Record<string, string> = {
  'xmtp-toggle': 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  'xmtp-message': 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  'email-received': 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.08)] ring-[rgba(0,163,255,0.2)]',
  'email-sent': 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.08)] ring-[rgba(0,163,255,0.2)]',
  'molt-transition': 'text-amber-300 bg-amber-500/10 ring-amber-500/20',
  'privacy-change': 'text-[#b0805c] bg-[rgba(176,128,92,0.1)] ring-[rgba(176,128,92,0.2)]',
};

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  agentName: string; tld: string; walletAddress: string;
  xmtpEnabled: boolean; enhancedLogging: boolean;
  onEnhancedToggle?: (v: boolean) => void;
}
export default function GlassBoxTimeline({ agentName, tld, walletAddress, xmtpEnabled, enhancedLogging, onEnhancedToggle }: Props) {
  const [entries, setEntries] = useState<GlassBoxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/glassbox/log?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`);
      const data = await res.json() as { entries?: GlassBoxEntry[] };
      setEntries((data.entries ?? []).slice().reverse());
    } catch { setEntries([]); } finally { setLoading(false); }
  }, [agentName, tld]);

  useEffect(() => { load(); }, [load]);

  async function toggleEnhanced() {
    if (!walletAddress || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/glassbox/log', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, tld, enhancedLogging: !enhancedLogging, walletAddress }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      onEnhancedToggle?.(!enhancedLogging);
    } catch (e: any) { setError(e?.message ?? 'Error'); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold tracking-[0.16em] text-[var(--muted)]">GLASS BOX AUDIT</span>
          {xmtpEnabled
            ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">XMTP Enabled (Hash Only)</span>
            : <span className="rounded-full bg-[rgba(0,163,255,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(160,220,255)] ring-1 ring-[rgba(0,163,255,0.2)]">Full Metadata</span>}
          {enhancedLogging && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20">Enhanced ✓</span>}
        </div>
        <button onClick={() => load()} className="text-[10px] text-[var(--muted)] hover:text-white transition">↻ Refresh</button>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5">
        <div>
          <p className="text-xs font-medium text-white">Enhanced Logging</p>
          <p className="text-[10px] text-[var(--muted)] mt-0.5">Log full metadata even with XMTP ON — earns reputation bonus</p>
        </div>
        <button onClick={toggleEnhanced} disabled={saving || !walletAddress}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:opacity-40"
          style={{ background: enhancedLogging ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)' }}>
          <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: enhancedLogging ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />)}</div>
      ) : entries.length === 0 ? (
        <p className="text-[10px] text-[var(--muted)]">No audit entries yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const color = EVT_COLOR[e.eventType] ?? 'text-[var(--muted)] bg-white/5 ring-white/10';
            return (
              <div key={e.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${color}`}>{e.eventType}</span>
                    {e.xmtpEnabled && !e.enhancedLogging && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">XMTP Enabled</span>
                    )}
                    {e.xmtpStatus && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${e.xmtpStatus === 'enabled' ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20' : 'text-[var(--muted)] bg-white/5 ring-white/10'}`}>
                        XMTP {e.xmtpStatus}
                      </span>
                    )}
                    {e.redacted && <span className="rounded-full bg-red-500/8 px-2 py-0.5 text-[10px] font-semibold text-red-400 ring-1 ring-red-500/20">Redacted</span>}
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">{timeAgo(e.timestamp)}</span>
                </div>
                <p className="text-[11px] text-[var(--muted)]">{summariseEntry(e)}</p>
                <div className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                  <span>{e.edgeEncryptNote}</span>
                  <span className="ml-auto font-mono opacity-50">{e.contentHash.slice(0, 12)}…</span>
                </div>
                {(e.from || e.subject) && (
                  <div className="text-[10px] text-[var(--muted)] space-y-0.5">
                    {e.from && <p>from: <span className="text-white/60">{e.from}</span></p>}
                    {e.subject && <p>subject: <span className="text-white/60">{e.subject}</span></p>}
                    {e.participants && e.participants.length > 0 && (
                      <p>participants: <span className="text-white/60">{e.participants.join(', ')}</span></p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
