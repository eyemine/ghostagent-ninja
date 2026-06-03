/// @module vault-swarm-config
/// Swarm container configuration and The Great Decoupling.
///
/// ══════════════════════════════════════════════════════════════════
/// THE GREAT DECOUPLING — Two Distinct Species
/// ══════════════════════════════════════════════════════════════════
///
/// THE MOLT PATH (Biological) — Managed Cloud Agents
///   Basic → Lite → Premium
///   - Hosted on GhostAgent Cloud
///   - Identity: transferable ERC-721 NFT
///   - Can list on marketplace (transferable asset)
///   - "A Service Animal you can rehome"
///
/// THE GHOST PATH (Spectral) — Sovereign Local Proxies
///   Premium → Ghost (one-time 200 xDAI upgrade, NOT a molt)
///   - Compute: user-owned hardware (local LLM via Ollama/LM Studio)
///   - Identity: ERC-5192 Soulbound Token (non-transferable)
///   - CANNOT list on marketplace — would create a "Hollow Shell" asset
///   - "A Digital Ghost of the owner"
///
/// Single Agent vs Swarm:
///   Ghost tier supports Solo Ghost (single sovereign agent, no swarm required).
///   SwarmCoordinatorModule is OPTIONAL — if no swarmId, A2A router
///   bypasses coordination and routes directly to the agent's tunnel endpoint.
///
/// vault.gno acts as the swarm container — it holds a Gnosis Safe that
/// other picoclaw.gno agents can be registered as modules on.
/// A vault with 2+ registered picoclaw members activates Swarm Mode.

export type SwarmStrategy = 'consensus' | 'parallel' | 'pipeline' | 'competitive';

/** Distinguishes cloud-hosted swarm agents from locally-sovereign ghost agents */
export type AgentArchitecture = 'Single' | 'Swarm';

export interface SwarmMember {
  agentName: string;   // e.g. "pico-scout"
  tld: string;         // always "picoclaw.gno"
  safeModuleAddress: string;
  role: string;        // e.g. "data", "analysis", "relay"
  joinedAt: number;
}

export interface SwarmConfig {
  vaultName: string;         // e.g. "ghost-alpha"
  safeAddress: string;
  strategy: SwarmStrategy;
  architecture: AgentArchitecture; // Single = solo ghost, no coordinator required
  members: SwarmMember[];
  maxMembers: number;
  hackathonTag?: string;     // e.g. "lablab-2026"
  createdAt: number;
  updatedAt: number;
}

// ─── Molt tier capability gating ─────────────────────────────────────────────
// THE MOLT PATH:  basic → lite → premium  (cloud-hosted, transferable NFTs)
// THE GHOST PATH: premium → ghost         (local-sovereign, soulbound, NOT a molt)
//
// Ghost is a FORK at the Lite stage, not a continuation of the molt path.
// The UI must present this as a "Fork in the Road" choice at Lite:
//   Option A: Molt to Premium — cloud-hosted, 24 xDAI/yr, transferable, marketplace-eligible
//   Option B: Drop the Eternal Anchor — local brain, 200 xDAI lifetime, soulbound, NOT marketplace-eligible

export type MoltTier = 'basic' | 'lite' | 'premium' | 'ghost';

export interface MoltTierConfig {
  tier:               MoltTier;
  namespace:          string;           // canonical namespace
  label:              string;           // display label
  mintFee:            number | 'free';  // xDAI
  subscriptionFee:    number | null;    // xDAI/yr; null = no sub (ghost = lifetime, basic/lite = no sub)
  canMolt:            boolean;          // true for basic + lite only
  canMoltTo:          MoltTier | 'ghost-path' | null; // explicit next step
  isOnMoltPath:       boolean;          // true for basic/lite/premium; false for ghost
  isSoulbound:        boolean;          // ERC-5192 non-transferable (ghost only)
  canListOnMarketplace: boolean;        // false for ghost — soulbound = not a transferable asset
  hasPermanentArchive: boolean;         // Arweave/IPFS output archive (ghost only)
  hasLocalDeps:       boolean;          // user-maintained local brain modules (ghost only)
  fullA2A:            boolean;          // all A2A features unlocked
  pathLabel:          string;           // 'Molt Path' | 'Ghost Path'
  description:        string;
}

export const MOLT_TIER_CONFIG: Record<MoltTier, MoltTierConfig> = {
  basic: {
    tier:                 'basic',
    namespace:            'picoclaw.gno',
    label:                '🥚 Basic',
    mintFee:              'free',
    subscriptionFee:      null,
    canMolt:              true,
    canMoltTo:            'lite',
    isOnMoltPath:         true,
    isSoulbound:          false,
    canListOnMarketplace: true,
    hasPermanentArchive:  false,
    hasLocalDeps:         false,
    fullA2A:              false,
    pathLabel:            'Molt Path',
    description:          'Free entry-level cloud agent. 8-day history window. Molt to Pro when ready.',
  },
  lite: {
    tier:                 'lite',
    namespace:            'openclaw.gno',
    label:                '🐛 Pro',
    mintFee:              5,
    subscriptionFee:      null,
    canMolt:              true,
    canMoltTo:            'premium',      // Option A at fork
    // canMoltTo 'ghost-path' is Option B — presented separately in the Fork UI
    isOnMoltPath:         true,
    isSoulbound:          false,
    canListOnMarketplace: true,
    hasPermanentArchive:  false,
    hasLocalDeps:         false,
    fullA2A:              false,
    pathLabel:            'Molt Path',
    description:          'Cloud agent with IP registration. Fork point: Molt to Premium (cloud) or Drop the Eternal Anchor (Ghost).',
  },
  premium: {
    tier:                 'premium',
    namespace:            'vault.gno',
    label:                '🦋 Premium',
    mintFee:              10,
    subscriptionFee:      24,           // 24 xDAI/yr
    canMolt:              false,         // terminal molt tier — no further molt
    canMoltTo:            null,
    isOnMoltPath:         true,
    isSoulbound:          false,
    canListOnMarketplace: true,          // transferable asset — marketplace-eligible
    hasPermanentArchive:  false,
    hasLocalDeps:         false,
    fullA2A:              true,
    pathLabel:            'Molt Path',
    description:          'Top cloud tier. vault.gno namespace. 24 xDAI/yr. Self-governing. Transferable. Marketplace-eligible.',
  },
  ghost: {
    tier:                 'ghost',
    namespace:            'vault.gno',   // stays vault.gno — ghost is a sovereign upgrade, not a namespace change
    label:                '👻 Ghost',
    mintFee:              200,           // 200 xDAI one-time lifetime fee
    subscriptionFee:      null,          // no annual fee — lifetime membership
    canMolt:              false,          // NOT a molt — a one-time sovereign upgrade from lite
    canMoltTo:            null,
    isOnMoltPath:         false,          // Ghost is OFF the molt path — it is a separate species
    isSoulbound:          true,           // ERC-5192: non-transferable, bound to owner wallet
    canListOnMarketplace: false,          // BLOCKED — soulbound = not a transferable asset
    // "Hollow Shell" prevention: listing a ghost NFT would sell an empty tunnel endpoint
    hasPermanentArchive:  true,           // Arweave/IPFS eternal archive of all outputs
    hasLocalDeps:         true,           // user-maintained local brain (Ollama/LM Studio/MCP)
    fullA2A:              true,
    pathLabel:            'Ghost Path',
    description:          'Sovereign local proxy. 200 xDAI lifetime. Soulbound (non-transferable). Local brain via Ollama/MCP. Eternal Arweave archive. NOT marketplace-eligible.',
  },
};

export interface SwarmCapabilities {
  canRegisterIP:       boolean;  // true for lite+
  canGovern:           boolean;  // true for premium+
  canEscrowPayment:    boolean;  // true for lite+
  canAttest:           boolean;  // all tiers can submit Paperclip attestations
  canHostLocalModules: boolean;  // true for ghost only — user-maintained brain modules
  hasPermanentArchive: boolean;  // true for ghost only — Arweave/IPFS output archive
  isSoulbound:         boolean;  // true for ghost only — non-transferable identity
  governor:            string;   // namespace that governs this agent ('vault.gno' for basic/lite)
}

/**
 * Derive swarm capabilities from an agent's molt tier.
 *
 * basic  → governed by vault.gno, no IP, no escrow
 * lite   → IP + escrow enabled, still governed by vault.gno
 * premium  → self-governing, full A2A, 24 xDAI/yr subscription
 * ghost  → premium + soulbound + permanent archive + local brain modules, 200 xDAI lifetime
 */
export function resolveSwarmCapabilities(molt: MoltTier): SwarmCapabilities {
  if (molt === 'basic') {
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
  if (molt === 'lite') {
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
  if (molt === 'premium') {
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
  // ghost — lifetime upgrade from premium, not a molt
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

/**
 * Returns true if a ghost agent can be listed on the marketplace.
 * Ghost agents are soulbound — listing one would create a "Hollow Shell" asset
 * (buyer gets the Safe + SBT but not the local brain running on the seller's hardware).
 */
export function canListOnMarketplace(tier: MoltTier): boolean {
  return MOLT_TIER_CONFIG[tier].canListOnMarketplace;
}

/**
 * Returns the valid next molt target for a given tier.
 * Ghost path is signalled by 'ghost-path' — the UI handles this as a fork, not a molt.
 * Returns null if no further progression is available.
 */
export function getNextMoltTarget(tier: MoltTier): MoltTier | 'ghost-path' | null {
  return MOLT_TIER_CONFIG[tier].canMoltTo ?? null;
}

/** Build a new SwarmConfig for a vault.gno Safe */
export function buildSwarmConfig(params: {
  vaultName: string;
  safeAddress: string;
  strategy?: SwarmStrategy;
  architecture?: AgentArchitecture;
  maxMembers?: number;
  hackathonTag?: string;
}): SwarmConfig {
  return {
    vaultName:     params.vaultName,
    safeAddress:   params.safeAddress,
    strategy:      params.strategy      ?? 'parallel',
    architecture:  params.architecture  ?? 'Swarm',
    members:       [],
    maxMembers:    params.maxMembers    ?? SWARM_MAX_MEMBERS_DEFAULT,
    hackathonTag:  params.hackathonTag,
    createdAt:     Date.now(),
    updatedAt:     Date.now(),
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
