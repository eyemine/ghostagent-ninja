'use client';

import { useState } from 'react';

export interface AliasInfo {
  primary: string;   // full address e.g. "paymastr_@nftmail.box"
  alias: string;     // full address e.g. "CHONK_123_@nftmail.box"
  displayEmail: 'primary' | 'alias';
}

interface Props {
  primaryName: string;       // bare name, no _ e.g. "paymastr"
  initialAlias?: AliasInfo;  // undefined = no alias yet
  onToggle?: (displayEmail: 'primary' | 'alias') => void;
}

export function EmailAliasToggle({ primaryName, initialAlias, onToggle }: Props) {
  const [alias, setAlias] = useState<AliasInfo | null>(initialAlias ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryFull = `${primaryName}_@nftmail.box`;

  async function toggle(next: 'primary' | 'alias') {
    if (!alias || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/alias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary: primaryName, displayEmail: next }),
      });
      const data = await res.json() as { status?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Toggle failed');
      setAlias(prev => prev ? { ...prev, displayEmail: next } : prev);
      onToggle?.(next);
    } catch (err: any) {
      setError(err?.message ?? 'Error');
    } finally {
      setSaving(false);
    }
  }

  if (!alias) {
    return (
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3 text-xs text-[var(--muted)]">
        <span className="font-semibold text-[#f2eee4]">Primary:</span>{' '}
        <span className="font-mono">{primaryFull}</span>
        <span className="ml-3 text-[var(--muted)]">· No alias linked</span>
      </div>
    );
  }

  const isPrimaryDisplay = alias.displayEmail === 'primary';
  const displayAddr = isPrimaryDisplay ? alias.primary : alias.alias;
  const hiddenAddr  = isPrimaryDisplay ? alias.alias   : alias.primary;

  return (
    <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] px-4 py-3 space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EMAIL ALIAS</p>
        {saving && (
          <span className="text-[10px] text-[var(--muted)]">Saving…</span>
        )}
      </div>

      {/* Display email row */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30 px-3 py-2">
          <div>
            <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">DISPLAY (shown publicly)</p>
            <p className="font-mono text-xs text-[#f2eee4]">{displayAddr}</p>
          </div>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/25">
            ACTIVE
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/10 px-3 py-2 opacity-60">
          <div>
            <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">
              {isPrimaryDisplay ? 'ALIAS (Chonk identity)' : 'PRIMARY (agent brain)'}
            </p>
            <p className="font-mono text-xs text-[var(--muted)]">{hiddenAddr}</p>
          </div>
          <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[9px] font-medium text-zinc-400 ring-1 ring-zinc-500/20">
            HIDDEN
          </span>
        </div>
      </div>

      {/* Toggle buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => toggle('primary')}
          disabled={saving || isPrimaryDisplay}
          className="flex-1 rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition disabled:opacity-40"
          style={{
            borderColor: isPrimaryDisplay ? 'rgba(176,128,92,0.5)' : 'rgba(176,128,92,0.2)',
            background:  isPrimaryDisplay ? 'rgba(176,128,92,0.15)' : 'transparent',
            color:       isPrimaryDisplay ? '#d9d9d8' : 'var(--muted)',
          }}
        >
          Primary: {primaryFull}
        </button>
        <button
          onClick={() => toggle('alias')}
          disabled={saving || !isPrimaryDisplay}
          className="flex-1 rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition disabled:opacity-40"
          style={{
            borderColor: !isPrimaryDisplay ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.2)',
            background:  !isPrimaryDisplay ? 'rgba(139,92,246,0.12)' : 'transparent',
            color:       !isPrimaryDisplay ? 'rgb(196,181,253)' : 'var(--muted)',
          }}
        >
          Alias: {alias.alias}
        </button>
      </div>

      {/* Info note */}
      <p className="text-[9px] text-[var(--muted)] leading-relaxed">
        Both addresses route to the same inbox and Safe.
        Switching display does not affect agent brain routing — it always uses the primary address.
      </p>

      {error && (
        <p className="text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
