/**
 * @module evolve-level
 * Pupa ↔ Imago level scanner and transition logic.
 *
 * Level terminology:
 *   Egg   → basic   (8-day decay, receive only)
 *   Pupa  → lite    (30-day, send + Safe body)
 *   Imago → premium (1yr renewable, infinite KV, Story .ip asset, marketplace badge)
 *   Ghost → ghost   (sovereign, governance, IP revenue share)
 *
 * Upgrade pricing:
 *   Pupa  → Imago : +14 xDAI one-off + 24 xDAI/yr subscription
 *   Imago → Pupa  : cancel subscription (drop-back, zero fee, data preserved)
 */

export type EvolveLevel = 'egg' | 'pupa' | 'imago' | 'ghost';

export interface LevelRecord {
  level: EvolveLevel;
  workerTier: 'basic' | 'lite' | 'premium' | 'ghost';
  expiresAt: number | null;
  safe: string | null;
  storyIp: string | null;
  retention: 'infinite' | '30-day' | '8-day';
  sendEnabled: boolean;
  ipAssetDomain: string | null;
  marketplaceBadge: string | null;
}

export interface EvolveAction {
  from: EvolveLevel;
  to: EvolveLevel;
  label: string;
  oneOffXdai: number;
  annualXdai: number;
  unlocks: string[];
  canDowngrade: boolean;
  downgradeLabel?: string;
}

// ─── Level metadata ──────────────────────────────────────────────────────────

export const LEVEL_META: Record<EvolveLevel, {
  label: string;
  color: string;
  bgColor: string;
  ringColor: string;
  workerTier: 'basic' | 'lite' | 'premium' | 'ghost';
  description: string;
}> = {
  egg: {
    label: 'Egg',
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-500/10',
    ringColor: 'ring-zinc-500/20',
    workerTier: 'basic',
    description: '8-day inbox decay. Receive only. No Safe, no send.',
  },
  pupa: {
    label: 'Pupa',
    color: 'text-amber-300',
    bgColor: 'bg-amber-500/10',
    ringColor: 'ring-amber-500/25',
    workerTier: 'lite',
    description: '30-day inbox cycle. Send + receive. Gnosis Safe body. No IP asset.',
  },
  imago: {
    label: 'Imago',
    color: 'text-violet-300',
    bgColor: 'bg-violet-500/10',
    ringColor: 'ring-violet-500/25',
    workerTier: 'premium',
    description: '1yr renewable. Infinite KV retention. Story .ip NFT. Marketplace badge.',
  },
  ghost: {
    label: 'Ghost',
    color: 'text-fuchsia-300',
    bgColor: 'bg-fuchsia-500/10',
    ringColor: 'ring-fuchsia-500/25',
    workerTier: 'ghost',
    description: 'Sovereign agent. Governance rights. IP revenue share. Infinite retention.',
  },
};

// ─── Upgrade / downgrade paths ───────────────────────────────────────────────

export const EVOLVE_ACTIONS: Partial<Record<EvolveLevel, EvolveAction>> = {
  pupa: {
    from: 'pupa',
    to: 'imago',
    label: 'Evolve to Imago',
    oneOffXdai: 14,
    annualXdai: 24,
    unlocks: [
      'Infinite inbox retention (no decay)',
      'Story Protocol .ip NFT asset',
      'Marketplace "Imago" badge',
      '1-yr renewable subscription',
    ],
    canDowngrade: false,
  },
  imago: {
    from: 'imago',
    to: 'pupa',
    label: 'Drop back to Pupa',
    oneOffXdai: 0,
    annualXdai: 0,
    unlocks: [],
    canDowngrade: true,
    downgradeLabel: 'Cancel subscription — return to 30-day Pupa tier. Email, Safe, and history preserved.',
  },
};

// ─── Map worker tier string → EvolveLevel ────────────────────────────────────

export function workerTierToLevel(tier: string | undefined | null): EvolveLevel {
  switch (tier) {
    case 'ghost':   return 'ghost';
    case 'premium': return 'imago';
    case 'lite':    return 'pupa';
    default:        return 'egg';
  }
}

export function levelToWorkerTier(level: EvolveLevel): 'basic' | 'lite' | 'premium' | 'ghost' {
  return LEVEL_META[level].workerTier;
}

// ─── Build a LevelRecord from raw acct-tier KV data ─────────────────────────

export function parseLevelRecord(raw: string | null): LevelRecord {
  let data: any = {};
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }

  const workerTier: string = data.tier || 'basic';
  const level = workerTierToLevel(workerTier);
  const isPremium = workerTier === 'premium' || workerTier === 'ghost';
  const isLite = workerTier === 'lite';

  return {
    level,
    workerTier: workerTier as LevelRecord['workerTier'],
    expiresAt: data.expires_at ?? null,
    safe: data.safe ?? null,
    storyIp: data.story_ip ?? null,
    retention: isPremium ? 'infinite' : isLite ? '30-day' : '8-day',
    sendEnabled: workerTier !== 'basic',
    ipAssetDomain: data.story_ip ? `${data.story_ip}.creation.ip` : null,
    marketplaceBadge: isPremium ? 'Imago' : isLite ? 'Pupa' : null,
  };
}

// ─── Summarise what the upgrade/downgrade will do ────────────────────────────

export function describeTransition(from: EvolveLevel, to: EvolveLevel): {
  preserves: string[];
  loses: string[];
  gains: string[];
} {
  const preserves = ['Email address', 'Gnosis Safe', 'Message history', 'Agent name'];

  if (to === 'imago') {
    return {
      preserves,
      gains: ['Infinite retention', 'Story .ip NFT', 'Marketplace badge', '1-yr subscription'],
      loses: [],
    };
  }

  if (to === 'pupa') {
    return {
      preserves,
      gains: [],
      loses: ['Infinite retention (resets to 30-day cycle)', 'Story .ip badge (NFT stays on-chain)'],
    };
  }

  return { preserves, gains: [], loses: [] };
}

// ─── Check if level is expired ───────────────────────────────────────────────

export function isExpired(record: LevelRecord): boolean {
  if (!record.expiresAt) return false;
  return Date.now() > record.expiresAt;
}

export function daysUntilExpiry(record: LevelRecord): number | null {
  if (!record.expiresAt) return null;
  const ms = record.expiresAt - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
