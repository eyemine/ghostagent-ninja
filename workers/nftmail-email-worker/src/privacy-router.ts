/// @module privacy-router
/// Domain-aware privacy routing for ghostagent.ninja namespaces
///
/// TLD rules:
///   molt.gno     → default Glassbox (exposed); Private = $0.20/email (billed downstream)
///   openclaw.gno → default Private; Exposed = free toggle
///   picoclaw.gno → default Private; Exposed = free toggle
///   agent.gno    → default Private; Exposed = free toggle
///   nftmail.gno  → default Private; Hard-Privacy = paid (10 xDAI/month)
///   vault.gno    → default Private; Hard-Privacy = paid (10 xDAI/month)

export type PrivacyTier = 'exposed' | 'private' | 'hard-privacy';

export type FarcasterVisibility = 'hidden' | 'fid-only' | 'full';
export type EmailVisibility = 'hidden' | 'domain-only' | 'full';

export interface PrivacyRecord {
  tier: PrivacyTier;
  enabled: boolean;       // true if tier !== 'exposed'
  tld: string;
  walletAddress?: string;
  moltPrivatePaid?: boolean;
  updatedAt: number;
  // Public API visibility controls (added for notapaperclip.red integration)
  farcasterVisibility?: FarcasterVisibility;
  emailVisibility?: EmailVisibility;
}

export interface PrivacyRouterResult {
  status: 'ok' | 'error';
  tier?: PrivacyTier;
  privacyEnabled?: boolean;
  moltPrivatePaid?: boolean;
  error?: string;
}

// Per-TLD defaults and allowed tiers
const TLD_DEFAULTS: Record<string, { defaultTier: PrivacyTier; allowed: PrivacyTier[] }> = {
  'molt.gno':     { defaultTier: 'exposed', allowed: ['exposed', 'private'] },
  'picoclaw.gno': { defaultTier: 'private', allowed: ['exposed', 'private'] },
  'openclaw.gno': { defaultTier: 'private', allowed: ['exposed', 'private'] },
  'agent.gno':    { defaultTier: 'private', allowed: ['exposed', 'private'] },
  'nftmail.gno':  { defaultTier: 'private', allowed: ['exposed', 'private', 'hard-privacy'] },
  'vault.gno':    { defaultTier: 'private', allowed: ['exposed', 'private', 'hard-privacy'] },
};

export function getTldDefaults(tld: string) {
  return TLD_DEFAULTS[tld] ?? TLD_DEFAULTS['agent.gno'];
}

/**
 * Build the KV privacy record for a given agent + tier.
 * Called from the worker's setPrivacy action handler.
 */
export function buildPrivacyRecord(
  tier: PrivacyTier,
  tld: string,
  walletAddress?: string,
  moltPrivatePaid?: boolean,
): PrivacyRecord {
  return {
    tier,
    enabled: tier !== 'exposed',
    tld,
    walletAddress: walletAddress ?? undefined,
    moltPrivatePaid: tld === 'molt.gno' && tier === 'private' ? (moltPrivatePaid ?? true) : false,
    updatedAt: Date.now(),
  };
}

/**
 * Parse raw KV privacy value into a typed PrivacyRecord.
 * Handles both old boolean format and new tier format.
 */
export function parsePrivacyRecord(raw: string | null, tld: string): PrivacyRecord {
  const defaults = getTldDefaults(tld);
  if (!raw) {
    return buildPrivacyRecord(defaults.defaultTier, tld);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PrivacyRecord>;
    const tier: PrivacyTier =
      parsed.tier === 'hard-privacy' ? 'hard-privacy'
      : parsed.tier === 'private'    ? 'private'
      : parsed.tier === 'exposed'    ? 'exposed'
      // Legacy boolean format
      : (parsed as any).privacyEnabled === true ? 'private' : 'exposed';
    return {
      tier,
      enabled: tier !== 'exposed',
      tld: parsed.tld ?? tld,
      walletAddress: parsed.walletAddress,
      moltPrivatePaid: parsed.moltPrivatePaid ?? false,
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return buildPrivacyRecord(defaults.defaultTier, tld);
  }
}

/**
 * Validate a setPrivacy request.
 * Returns an error string or null if valid.
 */
export function validateSetPrivacy(
  tier: string | undefined,
  tld: string,
): string | null {
  if (!tier) return 'Missing tier';
  const allowed = getTldDefaults(tld).allowed;
  if (!(allowed as string[]).includes(tier)) {
    return `Tier "${tier}" not allowed for ${tld}. Allowed: ${allowed.join(', ')}`;
  }
  return null;
}

/**
 * Route a privacy SET request.
 * Returns the KV key and serialised record to store.
 */
export function routeSetPrivacy(
  agentName: string,
  tld: string,
  tier: PrivacyTier,
  walletAddress?: string,
  moltPrivatePaid?: boolean,
): { kvKey: string; record: PrivacyRecord; result: PrivacyRouterResult } {
  const record = buildPrivacyRecord(tier, tld, walletAddress, moltPrivatePaid);
  return {
    kvKey: `privacy:${agentName}`,
    record,
    result: {
      status: 'ok',
      tier,
      privacyEnabled: tier !== 'exposed',
      moltPrivatePaid: record.moltPrivatePaid,
    },
  };
}

/**
 * Should an email be encrypted (private) or stored cleartext (glassbox)?
 * Uses KV privacy record + TLD default as fallback.
 */
export function shouldEncrypt(privacy: PrivacyRecord | null, tld: string): boolean {
  if (privacy) return privacy.enabled;
  return getTldDefaults(tld).defaultTier !== 'exposed';
}

/**
 * For molt.gno private tier: return the per-email charge in xDAI.
 */
export function getMoltPrivateCharge(privacy: PrivacyRecord | null): number {
  if (!privacy) return 0;
  if (privacy.tld === 'molt.gno' && privacy.tier === 'private') return 0.20;
  return 0;
}
