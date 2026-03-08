'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';

interface StealthAliasRecord {
  token: string;
  address: string;
  primary: string;
  ownerAddress: string;
  label?: string;
  createdAt: number;
  active: boolean;
}

interface Props {
  primaryName: string; // e.g. "alice" (without _ suffix)
}

export function StealthAlias({ primaryName }: Props) {
  const { wallets } = useWallets();
  const ownerAddress = wallets[0]?.address ?? '';

  const [aliases, setAliases] = useState<StealthAliasRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [newAlias, setNewAlias] = useState<StealthAliasRecord | null>(null);

  const loadAliases = useCallback(async () => {
    if (!primaryName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stealth-alias?primary=${encodeURIComponent(primaryName)}&owner=${encodeURIComponent(ownerAddress)}`
      );
      const data = await res.json() as { aliases?: StealthAliasRecord[]; error?: string };
      setAliases(data.aliases ?? []);
    } catch {
      // worker may not have the action yet — show empty gracefully
      setAliases([]);
    } finally {
      setLoading(false);
    }
  }, [primaryName, ownerAddress]);

  useEffect(() => {
    loadAliases();
  }, [loadAliases]);

  async function generate() {
    if (!ownerAddress) { setError('Connect wallet first'); return; }
    setGenerating(true);
    setError('');
    setNewAlias(null);
    try {
      const res = await fetch('/api/stealth-alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: primaryName, ownerAddress, label: label.trim() }),
      });
      const data = await res.json() as StealthAliasRecord & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to generate');
      setNewAlias(data);
      setLabel('');
      setAliases(prev => [data, ...prev]);
    } catch (err: any) {
      setError(err?.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(token: string) {
    if (!ownerAddress) return;
    setRevoking(token);
    try {
      const res = await fetch('/api/stealth-alias', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ownerAddress }),
      });
      const data = await res.json() as { status?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Revoke failed');
      setAliases(prev => prev.filter(a => a.token !== token));
      if (newAlias?.token === token) setNewAlias(null);
    } catch (err: any) {
      setError(err?.message ?? 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function timeAgo(ts: number) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Stealth Aliases</h3>
          <p className="text-[10px] text-[var(--muted)] mt-0.5">
            Random one-use addresses that forward to <span className="text-[rgb(160,220,255)]">{primaryName}_@nftmail.box</span>
          </p>
        </div>
        <span className="rounded-full bg-[rgba(0,163,255,0.1)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(160,220,255)] ring-1 ring-[rgba(0,163,255,0.2)]">
          {aliases.length} active
        </span>
      </div>

      {/* What is this */}
      <div className="rounded-xl px-3 py-2.5 text-[10px] leading-relaxed text-[var(--muted)]" style={{ background: '#0a0a14' }}>
        Use a stealth alias when signing up to a service so your real address stays private.
        Forwards silently to your inbox. Revoke anytime to cut off that sender.
      </div>

      {/* Generate form */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label (optional — e.g. Twitter signup)"
            className="flex-1 rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs outline-none focus:border-[rgba(0,163,255,0.4)] text-white placeholder:text-[var(--muted)]"
          />
          <button
            onClick={generate}
            disabled={generating || !ownerAddress}
            className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold transition disabled:opacity-40"
            style={{ background: 'rgba(0,163,255,0.12)', color: 'rgb(160,220,255)', border: '1px solid rgba(0,163,255,0.25)' }}
          >
            {generating ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/></svg>
                Generating…
              </span>
            ) : '+ Generate'}
          </button>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>

      {/* Newly generated — highlight */}
      {newAlias && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-emerald-400 tracking-wider">NEW ALIAS</span>
            <button
              onClick={() => copy(newAlias.address)}
              className="text-[10px] font-semibold text-emerald-300 hover:text-white transition"
            >
              {copied === newAlias.address ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <div className="font-mono text-sm text-emerald-300">{newAlias.address}</div>
          {newAlias.label && (
            <div className="text-[10px] text-[var(--muted)]">{newAlias.label}</div>
          )}
          <div className="text-[10px] text-[var(--muted)]">
            Forwards → <span className="text-white">{newAlias.primary}</span>
          </div>
        </div>
      )}

      {/* Alias list */}
      {loading ? (
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4"/></svg>
          Loading…
        </div>
      ) : aliases.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">ACTIVE ALIASES</p>
          {aliases.map(a => (
            <div
              key={a.token}
              className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-xs gap-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-[rgb(160,220,255)] cursor-pointer hover:underline truncate"
                    onClick={() => copy(a.address)}
                    title="Click to copy"
                  >
                    {a.address}
                  </span>
                  {copied === a.address && (
                    <span className="shrink-0 text-[10px] text-emerald-400">✓</span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--muted)] flex gap-2">
                  {a.label && <span className="text-white/60">{a.label}</span>}
                  <span>{timeAgo(a.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => revoke(a.token)}
                disabled={revoking === a.token}
                className="shrink-0 rounded-lg border border-red-500/20 bg-red-500/8 px-2 py-1 text-[10px] font-semibold text-red-400 transition hover:bg-red-500/15 disabled:opacity-40"
              >
                {revoking === a.token ? '…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">No aliases yet — generate one above.</p>
      )}
    </div>
  );
}
