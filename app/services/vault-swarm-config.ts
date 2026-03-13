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
// Each agent NFT has a molt tier that determines what it can do in a swarm.
// Larva agents cannot register IP or act as governors — they defer to vault.gno.

export type MoltTier = 'larva' | 'pupa' | 'imago' | 'ghost';

export interface SwarmCapabilities {
  canRegisterIP:    boolean;  // true for pupa+
  canGovern:        boolean;  // true for imago+
  canEscrowPayment: boolean;  // true for pupa+
  canAttest:        boolean;  // all tiers can submit Paperclip attestations
  governor:         string;   // namespace that governs this agent ('vault.gno' for larva)
}

/**
 * Derive swarm capabilities from an agent's molt tier.
 *
 * if (agent.molt === 'Larva') {
 *   config.canRegisterIP = false;
 *   config.governor = 'vault.gno';
 * }
 */
export function resolveSwarmCapabilities(molt: MoltTier): SwarmCapabilities {
  if (molt === 'larva') {
    return {
      canRegisterIP:    false,
      canGovern:        false,
      canEscrowPayment: false,
      canAttest:        true,
      governor:         'vault.gno',
    };
  }
  if (molt === 'pupa') {
    return {
      canRegisterIP:    true,
      canGovern:        false,
      canEscrowPayment: true,
      canAttest:        true,
      governor:         'vault.gno',
    };
  }
  if (molt === 'imago') {
    return {
      canRegisterIP:    true,
      canGovern:        true,
      canEscrowPayment: true,
      canAttest:        true,
      governor:         'self',
    };
  }
  // ghost
  return {
    canRegisterIP:    true,
    canGovern:        true,
    canEscrowPayment: true,
    canAttest:        true,
    governor:         'self',
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
