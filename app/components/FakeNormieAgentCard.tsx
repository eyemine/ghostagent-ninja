'use client';
import Image from 'next/image';
import { canAccessFeature, getTierConfig } from '../services/tier-config';

interface FakeNormieAgentCardProps {
  tokenId: number;
  tier: 0 | 1 | 2;
  adjective: string;
  type: string;
  slug: string;
  collection?: 'fakenormies' | 'normies';
  onUpgradePro?: (tokenId: number) => void;
  onUpgradePremium?: (tokenId: number) => void;
}

const TIER_LABELS: Record<0 | 1 | 2, 'Basic' | 'Pro' | 'Premium'> = {
  0: 'Basic',
  1: 'Pro',
  2: 'Premium',
};

const TIER_COLORS: Record<0 | 1 | 2, string> = {
  0: 'border-slate-500/30 text-slate-300',
  1: 'border-amber-500/30 text-amber-300',
  2: 'border-violet-500/30 text-violet-300',
};

export function FakeNormieAgentCard({
  tokenId,
  tier,
  adjective,
  type,
  slug,
  collection = 'fakenormies',
  onUpgradePro,
  onUpgradePremium,
}: FakeNormieAgentCardProps) {
  const tierLabel = TIER_LABELS[tier];
  const config = getTierConfig(collection, tierLabel);
  const isFakeNormie = collection === 'fakenormies';

  const delegationEnabled = canAccessFeature(collection, tier, 'delegation');
  const treasuryEnabled   = canAccessFeature(collection, tier, 'treasury');
  const apiEnabled        = canAccessFeature(collection, tier, 'api_access');

  const sendsLabel = config?.sendsPerDay === Infinity ? '∞' : String(config?.sendsPerDay ?? 10);
  const chatLabel  = config?.chatMessagesPerDay === Infinity ? '∞' : String(config?.chatMessagesPerDay ?? 10);

  const paddedId = String(tokenId).padStart(2, '0');

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4 max-w-xs">

      {/* Image + name */}
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-xl overflow-hidden border border-[var(--border)] bg-black/30 flex-shrink-0">
          <Image
            src={`/FakeNormies/SVGS/${paddedId}.svg`}
            alt={`FakeNormie #${tokenId}`}
            width={56} height={56}
            className="object-contain"
          />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{adjective} {type} <span className="text-[var(--muted)]">#{paddedId}</span></p>
          <p className="text-[10px] font-mono text-[var(--muted)]">{slug}@nftmail.box</p>
        </div>
      </div>

      {/* Tier + collection badges */}
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${TIER_COLORS[tier]}`}>
          {tierLabel}
        </span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[9px] text-[var(--muted)]">
          {isFakeNormie ? 'FakeNormie' : 'Normie'}
        </span>
      </div>

      {/* Daily quota */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: '📧', label: 'Email', value: `${sendsLabel}/day` },
          { icon: '💬', label: 'Chat',  value: `${chatLabel}/day` },
        ].map(({ icon, label, value }) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <p className="text-[9px] text-[var(--muted)]">{icon} {label}</p>
            <p className="text-xs font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Feature list */}
      <div className="space-y-1.5">
        {[
          { label: `Delegation${delegationEnabled && isFakeNormie && tier < 1 ? ' (demo)' : ''}`, enabled: delegationEnabled },
          { label: 'Treasury', enabled: treasuryEnabled },
          { label: 'API access', enabled: apiEnabled },
        ].map(({ label, enabled }) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`text-[10px] ${enabled ? 'text-emerald-400' : 'text-[var(--muted)]'}`}>
              {enabled ? '✓' : '○'}
            </span>
            <span className={`text-[11px] ${enabled ? 'text-white' : 'text-[var(--muted)]'}`}>{label}</span>
          </div>
        ))}
      </div>

      {/* Upgrade CTAs */}
      {tier === 0 && (
        <div className="space-y-2 pt-1">
          <button
            onClick={() => onUpgradePro?.(tokenId)}
            className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-left transition hover:bg-amber-500/20"
          >
            <p className="text-xs font-semibold text-amber-300">
              Upgrade to Pro — {isFakeNormie ? '5' : '10'} USDC
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {isFakeNormie ? '50 sends/day · real Safe · API' : '50 sends/day · unlimited chat · API'}
            </p>
          </button>
          {!isFakeNormie && (
            <button
              onClick={() => onUpgradePremium?.(tokenId)}
              className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-left transition hover:bg-violet-500/20"
            >
              <p className="text-xs font-semibold text-violet-300">Go Premium — 24 USDC/year</p>
              <p className="text-[10px] text-[var(--muted)]">Full Safe delegation + treasury</p>
            </button>
          )}
          {isFakeNormie && (
            <p className="text-[10px] text-center text-[var(--muted)]">
              Want full protection?{' '}
              <a href="/activate/normie" className="text-[rgb(160,220,255)] hover:underline">Activate a real Normie →</a>
            </p>
          )}
        </div>
      )}

      {tier === 1 && !isFakeNormie && (
        <button
          onClick={() => onUpgradePremium?.(tokenId)}
          className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-left transition hover:bg-violet-500/20"
        >
          <p className="text-xs font-semibold text-violet-300">⭐ Go Premium — 24 USDC/year</p>
          <p className="text-[10px] text-[var(--muted)]">Unlock delegation & treasury for your high-value asset</p>
        </button>
      )}
    </div>
  );
}
