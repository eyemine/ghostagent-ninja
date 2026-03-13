/// @module vault-swarm-config
/// Swarm container configuration for vault.gno Safes.
///
/// vault.gno acts as the swarm container — it holds a Gnosis Safe that
/// other picoclaw.gno agents can be registered as modules on.
/// A vault with 2+ registered picoclaw members activates Swarm Mode.

export type SwarmStrategy = 'consensus' | 'parallel' | 'pipeline' | 'competitive';

export interface SwarmMember {
  agentName: string;   // e.g. "pico-scout"
  tld: string;         // always "picoclaw.gno"
  safeModuleAddress: string;
  role: string;        // e.g. "data", "analysis", "relay"
  joinedAt: number;
}

export interface SwarmConfig {
  vaultName: string;        // e.g. "ghost-alpha"
  safeAddress: string;
  strategy: SwarmStrategy;
  members: SwarmMember[];
  maxMembers: number;
  hackathonTag?: string;    // e.g. "lablab-2026"
  createdAt: number;
  updatedAt: number;
}

// ─── Molt tier capability gating ─────────────────────────────────────────────
// Tier progression: larva → pupa → imago → ghost
//
// ghost is NOT a molt — it is an upgrade from imago via a one-time 200 xDAI
// lifetime payment. Imago is the ceiling of the molt path; ghost is a separate
// opt-in tier that adds:
//   - Soulbound (non-transferable) NFT identity
//   - Permanent Arweave/IPFS archive of all agent outputs
//   - Local/self-hosted dependency support (user-maintained brain modules)
//   - Full A2A feature access (Story ATCP/IP, ERC-8004 rep oracle, x402 escrow)
//   - No annual subscription — lifetime membership

export type MoltTier = 'larva' | 'pupa' | 'imago' | 'ghost';

export interface MoltTierConfig {
  tier:          MoltTier;
  namespace:     string;          // canonical namespace
  label:         string;          // display label
  mintFee:       number | 'free'; // xDAI
  subscriptionFee: number | null; // xDAI/yr, null = lifetime
  canMolt:       boolean;         // false for ghost — ghost is a terminal upgrade not a molt
  isSoulbound:   boolean;         // non-transferable NFT
  hasPermanentArchive: boolean;   // Arweave/IPFS output archive
  hasLocalDeps:  boolean;         // user-maintained local brain modules
  fullA2A:       boolean;         // all A2A features unlocked
  description:   string;
}

export const MOLT_TIER_CONFIG: Record<MoltTier, MoltTierConfig> = {
  larva: {
    tier:               'larva',
    namespace:          'picoclaw.gno',
    label:              '🥚 Larva',
    mintFee:            'free',
    subscriptionFee:    null,
    canMolt:            true,
    isSoulbound:        false,
    hasPermanentArchive: false,
    hasLocalDeps:       false,
    fullA2A:            false,
    description:        'Free entry-level agent. 8-day history window. Can molt to pupa.',
  },
  pupa: {
    tier:               'pupa',
    namespace:          'openclaw.gno',
    label:              '🐛 Pupa',
    mintFee:            5,
    subscriptionFee:    null,
    canMolt:            true,
    isSoulbound:        false,
    hasPermanentArchive: false,
    hasLocalDeps:       false,
    fullA2A:            false,
    description:        'Intermediate tier. IP registration enabled. Can molt to imago.',
  },
  imago: {
    tier:               'imago',
    namespace:          'vault.gno',
    label:              '🦋 Imago',
    mintFee:            10,
    subscriptionFee:    24,   // 24 xDAI/yr
    canMolt:            false, // terminal molt tier — cannot molt further
    isSoulbound:        false,
    hasPermanentArchive: false,
    hasLocalDeps:       false,
    fullA2A:            true,
    description:        'Top molt tier. vault.gno namespace. 24 xDAI/yr subscription. Self-governing.',
  },
  ghost: {
    tier:               'ghost',
    namespace:          'vault.gno',  // stays on vault.gno — ghost is a vault upgrade
    label:              '👻 Ghost',
    mintFee:            200,          // 200 xDAI lifetime — replaces annual subscription
    subscriptionFee:    null,         // no annual fee — lifetime membership
    canMolt:            false,        // ghost is not a molt — it is a one-time upgrade from imago
    isSoulbound:        true,         // non-transferable: identity bound to owner wallet
    hasPermanentArchive: true,        // all outputs archived to Arweave/IPFS permanently
    hasLocalDeps:       true,         // user can attach local/self-hosted brain modules
    fullA2A:            true,
    description:        'Lifetime vault.gno upgrade from imago. 200 xDAI one-time. Soulbound identity, permanent Arweave/IPFS archive, local brain module support. All A2A features.',
  },
};

export interface SwarmCapabilities {
  canRegisterIP:       boolean;  // true for pupa+
  canGovern:           boolean;  // true for imago+
  canEscrowPayment:    boolean;  // true for pupa+
  canAttest:           boolean;  // all tiers can submit Paperclip attestations
  canHostLocalModules: boolean;  // true for ghost only — user-maintained brain modules
  hasPermanentArchive: boolean;  // true for ghost only — Arweave/IPFS output archive
  isSoulbound:         boolean;  // true for ghost only — non-transferable identity
  governor:            string;   // namespace that governs this agent ('vault.gno' for larva/pupa)
}

/**
 * Derive swarm capabilities from an agent's molt tier.
 *
 * larva  → governed by vault.gno, no IP, no escrow
 * pupa   → IP + escrow enabled, still governed by vault.gno
 * imago  → self-governing, full A2A, 24 xDAI/yr subscription
 * ghost  → imago + soulbound + permanent archive + local brain modules, 200 xDAI lifetime
 */
export function resolveSwarmCapabilities(molt: MoltTier): SwarmCapabilities {
  if (molt === 'larva') {
    return {
      canRegisterIP:       false,
      canGovern:           false,
      canEscrowPayment:    false,
      canAttest:           true,
      canHostLocalModules: false,
      hasPermanentArchive: false,
      isSoulbound:         false,
      governor:            'vault.gno',
    };
  }
  if (molt === 'pupa') {
    return {
      canRegisterIP:       true,
      canGovern:           false,
      canEscrowPayment:    true,
      canAttest:           true,
      canHostLocalModules: false,
      hasPermanentArchive: false,
      isSoulbound:         false,
      governor:            'vault.gno',
    };
  }
  if (molt === 'imago') {
    return {
      canRegisterIP:       true,
      canGovern:           true,
      canEscrowPayment:    true,
      canAttest:           true,
      canHostLocalModules: false,
      hasPermanentArchive: false,
      isSoulbound:         false,
      governor:            'self',
    };
  }
  // ghost — lifetime upgrade from imago, not a molt
  return {
    canRegisterIP:       true,
    canGovern:           true,
    canEscrowPayment:    true,
    canAttest:           true,
    canHostLocalModules: true,   // user-maintained local brain modules
    hasPermanentArchive: true,   // Arweave/IPFS permanent output archive
    isSoulbound:         true,   // non-transferable NFT identity
    governor:            'self',
  };
}

export const SWARM_MIN_MEMBERS = 2;
export const SWARM_MAX_MEMBERS_DEFAULT = 8;

export const STRATEGY_LABELS: Record<SwarmStrategy, string> = {
  consensus:   'Consensus — all members vote, majority wins',
  parallel:    'Parallel — all members act simultaneously',
  pipeline:    'Pipeline — output of each member feeds the next',
  competitive: 'Competitive — fastest valid response wins',
};

/** Returns true when the vault qualifies as an active swarm */
export function isSwarmActive(config: SwarmConfig): boolean {
  return config.members.length >= SWARM_MIN_MEMBERS;
}

/** Build a new SwarmConfig for a vault.gno Safe */
export function buildSwarmConfig(params: {
  vaultName: string;
  safeAddress: string;
  strategy?: SwarmStrategy;
  maxMembers?: number;
  hackathonTag?: string;
}): SwarmConfig {
  return {
    vaultName:    params.vaultName,
    safeAddress:  params.safeAddress,
    strategy:     params.strategy     ?? 'parallel',
    members:      [],
    maxMembers:   params.maxMembers   ?? SWARM_MAX_MEMBERS_DEFAULT,
    hackathonTag: params.hackathonTag,
    createdAt:    Date.now(),
    updatedAt:    Date.now(),
  };
}

/** Add a picoclaw member to an existing SwarmConfig */
export function addSwarmMember(
  config: SwarmConfig,
  member: Omit<SwarmMember, 'joinedAt'>
): { config: SwarmConfig; error?: string } {
  if (member.tld !== 'picoclaw.gno') {
    return { config, error: 'Only picoclaw.gno agents can join a swarm' };
  }
  if (config.members.length >= config.maxMembers) {
    return { config, error: `Swarm is full (max ${config.maxMembers} members)` };
  }
  if (config.members.find(m => m.agentName === member.agentName)) {
    return { config, error: `${member.agentName} is already a swarm member` };
  }
  return {
    config: {
      ...config,
      members: [...config.members, { ...member, joinedAt: Date.now() }],
      updatedAt: Date.now(),
    },
  };
}

/** Remove a member from a SwarmConfig */
export function removeSwarmMember(config: SwarmConfig, agentName: string): SwarmConfig {
  return {
    ...config,
    members: config.members.filter(m => m.agentName !== agentName),
    updatedAt: Date.now(),
  };
}
