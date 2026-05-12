/**
 * @module host-staking
 * $HOST staking logic — domain-aware unlock tiers, send/persistence requirements.
 * KV-backed, zero lock-in. No on-chain contract required at launch.
 *
 * Stake record is stored in the CF Worker KV under `stake:<agentName>`.
 * Unlocks are evaluated client-side from the stake record returned by the API.
 */

export type StakeTier = 'none' | 'send' | 'persist-30d' | 'persist-365d' | 'ghost';

export interface StakeRequirement {
  tier: StakeTier;
  label: string;
  hostAmount: number;      // $HOST tokens required
  usdEquiv: number;        // approximate USD at launch price
  unlocks: string[];
  persistDays: number | null;
}

export interface StakeRecord {
  agentName: string;
  tld: string;
  walletAddress: string;
  stakedHost: number;         // total $HOST staked
  activeTier: StakeTier;
  unlockedSend: boolean;
  persistenceDays: number | null;
  moltPrivateBalance: number; // prepaid xDAI for molt.gno $0.20/email billing
  stakedAt: number;
  expiresAt: number | null;
}

// ─── Per-TLD staking requirement tables ─────────────────────────────────────

const BASE_REQUIREMENTS: StakeRequirement[] = [
  {
    tier: 'send',
    label: 'Send Emails',
    hostAmount: 100,       // 100 $HOST ≈ $10 at launch
    usdEquiv: 10,
    unlocks: ['Send outbound emails', 'Receive to nftmail.box inbox'],
    persistDays: null,
  },
  {
    tier: 'persist-30d',
    label: '30-Day Persistence',
    hostAmount: 300,       // 300 $HOST ≈ $30
    usdEquiv: 30,
    unlocks: ['30-day inbox retention', 'No 8-day decay'],
    persistDays: 30,
  },
  {
    tier: 'persist-365d',
    label: '365-Day Persistence',
    hostAmount: 1000,      // 1000 $HOST ≈ $100
    usdEquiv: 100,
    unlocks: ['365-day inbox retention', 'Eligible for infinite retention upgrade'],
    persistDays: 365,
  },
  {
    tier: 'ghost',
    label: 'Ghost Tier',
    hostAmount: 5000,      // 5000 $HOST
    usdEquiv: 500,
    unlocks: ['Infinite retention', 'Governance rights', 'IP revenue share', 'Marketplace priority'],
    persistDays: null,
  },
];

// agent.gno: $10 send, $100/yr persistence (same as base)
// molt.gno:  send only, $0.20/email billing — no persistence tier
// picoclaw:  send only (no persistence — basic tier)
// openclaw:  send + persist available
// vault:     all tiers
// nftmail:   all tiers

export function getRequirementsForTld(tld: string): StakeRequirement[] {
  switch (tld) {
    case 'molt.gno':
      return BASE_REQUIREMENTS.filter(r => r.tier === 'send');
    case 'picoclaw.gno':
      return BASE_REQUIREMENTS.filter(r => r.tier === 'send' || r.tier === 'persist-30d');
    case 'openclaw.gno':
      return BASE_REQUIREMENTS.filter(r => r.tier !== 'ghost');
    case 'agent.gno':
    case 'vault.gno':
    case 'nftmail.gno':
    default:
      return BASE_REQUIREMENTS;
  }
}

// ─── Tier resolution ─────────────────────────────────────────────────────────

export function resolveStakeTier(stakedHost: number): StakeTier {
  if (stakedHost >= 5000) return 'ghost';
  if (stakedHost >= 1000) return 'persist-365d';
  if (stakedHost >= 300)  return 'persist-30d';
  if (stakedHost >= 100)  return 'send';
  return 'none';
}

export function resolvePersistenceDays(tier: StakeTier): number | null {
  if (tier === 'ghost')        return null;    // infinite
  if (tier === 'persist-365d') return 365;
  if (tier === 'persist-30d')  return 30;
  return null;
}

export function buildStakeRecord(
  agentName: string,
  tld: string,
  walletAddress: string,
  stakedHost: number,
  existingMoltBalance?: number,
): StakeRecord {
  const activeTier = resolveStakeTier(stakedHost);
  const persistenceDays = resolvePersistenceDays(activeTier);
  return {
    agentName,
    tld,
    walletAddress,
    stakedHost,
    activeTier,
    unlockedSend: stakedHost >= 100,
    persistenceDays,
    moltPrivateBalance: existingMoltBalance ?? 0,
    stakedAt: Date.now(),
    expiresAt: persistenceDays ? Date.now() + persistenceDays * 86400 * 1000 : null,
  };
}

// ─── Unstake: reduce stake, recompute tier ───────────────────────────────────

export function computeUnstake(
  existing: StakeRecord,
  unstakeAmount: number,
): { newStakedHost: number; newTier: StakeTier; lost: string[] } {
  const newStakedHost = Math.max(0, existing.stakedHost - unstakeAmount);
  const newTier = resolveStakeTier(newStakedHost);
  const lost: string[] = [];
  if (existing.unlockedSend && newStakedHost < 100)  lost.push('Send emails');
  if (existing.persistenceDays && newStakedHost < 300) lost.push('Inbox persistence');
  return { newStakedHost, newTier, lost };
}

// ─── Format helpers ──────────────────────────────────────────────────────────

export function fmtHost(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K $HOST`;
  return `${amount} $HOST`;
}

export function tierColor(tier: StakeTier): string {
  switch (tier) {
    case 'ghost':        return 'text-fuchsia-300';
    case 'persist-365d': return 'text-violet-300';
    case 'persist-30d':  return 'text-cyan-300';
    case 'send':         return 'text-[#b0805c]';
    default:             return 'text-[var(--muted)]';
  }
}
