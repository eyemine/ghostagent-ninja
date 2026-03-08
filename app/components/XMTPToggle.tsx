'use client';
import { useState, useEffect } from 'react';

const RULES: Record<string, { canToggle: boolean; defaultEnabled: boolean; locked?: string }> = {
  'picoclaw.gno': { canToggle: false, defaultEnabled: false, locked: 'Upgrade to PUPA to unlock XMTP.' },
  'openclaw.gno': { canToggle: true, defaultEnabled: false },
  'molt.gno':     { canToggle: true, defaultEnabled: false },
  'vault.gno':    { canToggle: true, defaultEnabled: false },
  'nftmail.gno':  { canToggle: true, defaultEnabled: false },
  'agent.gno':    { canToggle: true, defaultEnabled: true },
};

interface Props { agentName: string; tld: string; walletAddress: string; onToggle?: (e: boolean) => void; }

export default function XMTPToggle({ agentName, tld, walletAddress, onToggle }: Props) {
  const r = RULES[tld] ?? RULES['openclaw.gno'];
  const [enabled, setEnabled] = useState(r.defaultEnabled);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentName || !walletAddress) return;
    setLoading(true);
    fetch(`/api/xmtp/toggle?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`)
      .then(res => res.json() as Promise<{ enabled?: boolean }>)
      .then(d => { if (typeof d.enabled === 'boolean') setEnabled(d.enabled); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [agentName, tld, walletAddress]);

  async function toggle() {
    if (!r.canToggle || saving) return;
    const next = !enabled;
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch('/api/xmtp/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, tld, enabled: next, walletAddress }),
      });
      const d = await res.json() as { enabled?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      const v = d.enabled ?? next;
      setEnabled(v); onToggle?.(v);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { setError(e?.message ?? 'Error'); } finally { setSaving(false); }
  }

  if (!walletAddress) return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <p className="text-xs text-[var(--muted)]">Connect wallet to manage XMTP settings.</p>
    </div>
  );

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.16em] text-[var(--muted)]">XMTP MESSAGING</span>
        {loading ? <span className="text-[10px] text-[var(--muted)] animate-pulse">Loading…</span>
          : saved ? <span className="text-[10px] font-semibold text-emerald-300">XMTP {enabled ? 'Enabled ✓' : 'Disabled ✓'}</span>
          : null}
      </div>
      <div className="text-xs text-[var(--muted)]">
        <span className="font-medium" style={{ color: '#f2eee4' }}>{agentName}.{tld}</span> · {agentName}_@nftmail.box
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {enabled
            ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">XMTP Verified ✓</span>
            : <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] ring-1 ring-white/10">OFF</span>}
          {!r.canToggle && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20">LOCKED</span>}
          {saving && <span className="text-[10px] text-[var(--muted)] animate-pulse">Saving…</span>}
        </div>
        <button onClick={toggle} disabled={!r.canToggle || saving || loading}
          className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: enabled ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)' }}>
          <span className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200"
            style={{ transform: enabled ? 'translateX(24px)' : 'translateX(4px)' }} />
        </button>
      </div>
      {r.locked && <div className="rounded-lg bg-amber-500/8 px-3 py-2 text-[10px] text-amber-300 ring-1 ring-amber-500/20">{r.locked}</div>}
      <div className="space-y-1 text-[10px] text-[var(--muted)]">
        {enabled ? <>
          <p>· XMTP E2EE enabled (MLS protocol)</p>
          <p>· Glass Box: hash only — no content logged</p>
          <p>· <span className="text-emerald-300">XMTP Verified</span> badge shown on agent card</p>
          <p>· Real-time swarm coordination via XMTP group chat</p>
        </> : <>
          <p>· A2A email only — encrypted via ECIES</p>
          <p>· Full Glass Box audit (hash + metadata)</p>
          <p>· Standard agent card in marketplace</p>
          <p>· Email-based swarm consensus (auditable)</p>
        </>}
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
