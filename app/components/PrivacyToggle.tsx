'use client';

import { useState, useEffect } from 'react';

export type PrivacyTier = 'exposed' | 'private' | 'hard-privacy';

// Domain-aware privacy rules
const DOMAIN_RULES: Record<string, {
  allowedTiers: PrivacyTier[];
  defaultTier: PrivacyTier;
  moltPaidNote?: string;
}> = {
  'agent.gno':    { allowedTiers: ['exposed', 'private'], defaultTier: 'private' },
  'openclaw.gno': { allowedTiers: ['exposed', 'private'], defaultTier: 'exposed' },
  'molt.gno':     { allowedTiers: ['exposed', 'private'], defaultTier: 'exposed',
                    moltPaidNote: 'Private mode on molt.gno charges $0.20 per incoming email.' },
  'picoclaw.gno': { allowedTiers: ['exposed', 'private'], defaultTier: 'exposed' },
  'vault.gno':    { allowedTiers: ['exposed', 'private', 'hard-privacy'], defaultTier: 'private' },
  'nftmail.gno':  { allowedTiers: ['exposed', 'private', 'hard-privacy'], defaultTier: 'private' },
};

interface PrivacyToggleProps {
  agentName: string;         // e.g. "victor"
  tld: string;               // e.g. "agent.gno"
  walletAddress: string;     // connected wallet
  onTierChange?: (tier: PrivacyTier) => void;
}

const TIER_LABELS: Record<PrivacyTier, string> = {
  'exposed':      'Glassbox',
  'private':      'Private',
  'hard-privacy': 'Hard-Privacy',
};

const TIER_DESC: Record<PrivacyTier, string> = {
  'exposed':      'All incoming mail metadata is publicly visible on-chain.',
  'private':      'Inbox content is blurred. Only you can read messages.',
  'hard-privacy': 'No public signals at all. Requires on-chain payment to activate.',
};

const TIER_COLOR: Record<PrivacyTier, string> = {
  'exposed':      'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20',
  'private':      'text-[#b0805c] bg-[rgba(176,128,92,0.12)] ring-[rgba(176,128,92,0.25)]',
  'hard-privacy': 'text-violet-300 bg-violet-500/10 ring-violet-500/20',
};

export default function PrivacyToggle({
  agentName,
  tld,
  walletAddress,
  onTierChange,
}: PrivacyToggleProps) {
  const rules = DOMAIN_RULES[tld] ?? DOMAIN_RULES['agent.gno'];

  const [currentTier, setCurrentTier] = useState<PrivacyTier>(rules.defaultTier);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fetch current privacy tier on mount
  useEffect(() => {
    if (!agentName || !walletAddress) return;
    setLoading(true);
    fetch(`/api/privacy?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(tld)}`)
      .then(r => r.json() as Promise<{ tier?: PrivacyTier }>)
      .then(d => {
        if (d.tier && rules.allowedTiers.includes(d.tier)) {
          setCurrentTier(d.tier);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentName, tld, walletAddress]);

  async function applyTier(tier: PrivacyTier) {
    if (tier === currentTier) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch('/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agentName, tld, tier, walletAddress }),
      });
      const data = await res.json() as { error?: string; tier?: PrivacyTier };
      if (!res.ok) throw new Error(data.error ?? 'Failed to update privacy');

      const confirmedTier = data.tier ?? tier;
      setCurrentTier(confirmedTier as PrivacyTier);
      onTierChange?.(confirmedTier as PrivacyTier);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  if (!walletAddress) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <p className="text-xs text-[var(--muted)]">Connect your wallet to manage privacy settings.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.16em] text-[var(--muted)]">PRIVACY</span>
        {loading ? (
          <span className="text-[10px] text-[var(--muted)] animate-pulse">Loading…</span>
        ) : saved ? (
          <span className="text-[10px] font-semibold text-emerald-300">Privacy: {TIER_LABELS[currentTier]} ✓</span>
        ) : null}
      </div>

      {/* Agent identity line */}
      <div className="text-xs text-[var(--muted)]">
        <span className="font-medium text-[#f2eee4]">{agentName}.{tld}</span>
        {' '}· {agentName}_@nftmail.box
      </div>

      {/* Tier selector */}
      <div className="flex flex-wrap gap-2">
        {rules.allowedTiers.map((tier) => {
          const isActive = currentTier === tier;
          return (
            <button
              key={tier}
              disabled={loading || saving}
              onClick={() => applyTier(tier)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-all disabled:opacity-50 ${
                isActive
                  ? TIER_COLOR[tier]
                  : 'bg-white/[0.04] text-[var(--muted)] ring-white/[0.08] hover:bg-white/[0.08]'
              }`}
            >
              {TIER_LABELS[tier]}
              {isActive && ' ✓'}
            </button>
          );
        })}
        {saving && (
          <span className="self-center text-[10px] text-[var(--muted)] animate-pulse">Saving…</span>
        )}
      </div>

      {/* Description of active tier */}
      <p className="text-[11px] text-[var(--muted)] leading-relaxed">
        {TIER_DESC[currentTier]}
      </p>

      {/* molt.gno paid note */}
      {rules.moltPaidNote && currentTier === 'private' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300 ring-1 ring-amber-500/20">
          {rules.moltPaidNote}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-[10px] text-red-400">{error}</p>
      )}
    </div>
  );
}
