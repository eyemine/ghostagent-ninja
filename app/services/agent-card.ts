/// @module agent-card
/// Agent Card schema — the public identity document for a GhostAgent.
///
/// An agent-card.json is served at the agent's well-known URL:
///   https://<agentName>.ghostagent.ninja/.well-known/agent-card.json
///
/// It is also stored in the ERC-8004 Identity Registry as the agentURI
/// payload. The A2A router reads this to determine:
///   - Whether to route via swarm coordinator or direct tunnel
///   - Whether the agent is cloud-hosted (Molt Path) or local (Ghost Path)
///   - What capabilities the agent exposes
///
/// THE GREAT DECOUPLING enforced here:
///   architecture: 'Single' → Solo Ghost, direct tunnel, no swarmId required
///   architecture: 'Swarm'  → Ninja Swarm, routes via SwarmCoordinatorModule
///
/// A ghost-tier agent with architecture: 'Single' and no swarmId is a
/// "Sovereign Individual" — it bypasses all swarm coordination logic.

import type { AgentArchitecture, MoltTier } from './vault-swarm-config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentCardVersion = '1.0' | '1.0-ghost';

/** Routing info for cloud-hosted (Molt Path) agents */
export interface CloudEndpoint {
  type:     'cloud';
  inboxUrl: string;   // e.g. "https://nftmail-email-worker.richard-159.workers.dev"
  channel:  'nftmail' | 'xmtp' | 'A2A-RPC';
}

/** Routing info for locally-sovereign (Ghost Path) agents */
export interface TunnelEndpoint {
  type:     'tunnel';
  endpoint: string;   // e.g. "https://abc123.ghost-tunnel.ninja"
  protocol: 'A2A-RPC' | 'MCP-over-HTTP';
}

export type AgentEndpoint = CloudEndpoint | TunnelEndpoint;

/** The canonical agent-card.json schema */
export interface AgentCard {
  /** Schema version — '1.0-ghost' for Ghost Path agents */
  version:      AgentCardVersion;
  /** Fully qualified agent name e.g. "alice.vault.gno" */
  name:         string;
  /** Molt tier — determines path and capabilities */
  tier:         MoltTier;
  /** Single = Solo Ghost (no swarm), Swarm = Ninja Swarm */
  architecture: AgentArchitecture;
  /** Routing endpoint — tunnel for ghost, cloud for molt-path */
  endpoint:     AgentEndpoint;
  /** ERC-8004 agentId — tokenId in the Identity Registry */
  agentId?:     number;
  /** Gnosis Safe address that controls this agent */
  safeAddress:  string;
  /** swarmId — only present for Swarm architecture agents */
  swarmId?:     string;
  /** Human-readable capabilities list */
  capabilities: string[];
  /** Story Protocol IPA ID, if registered */
  ipaId?:       string;
  /** Ghost Path only: Arweave manifest URI for the Eternal Archive */
  arweaveManifestUri?: string;
  /** ISO-8601 creation timestamp */
  createdAt:    string;
  /** ISO-8601 last-updated timestamp */
  updatedAt:    string;
}

// ─── Path detection ───────────────────────────────────────────────────────────

/** Returns true for Ghost Path (local sovereign) agents */
export function isGhostPath(card: AgentCard): boolean {
  return card.tier === 'ghost';
}

/** Returns true for Molt Path (cloud managed) agents */
export function isMoltPath(card: AgentCard): boolean {
  return card.tier !== 'ghost';
}

/**
 * Returns true if A2A traffic should bypass the SwarmCoordinatorModule.
 * Conditions: Single architecture OR ghost tier with no swarmId.
 */
export function shouldBypassSwarmCoordinator(card: AgentCard): boolean {
  return card.architecture === 'Single' || (card.tier === 'ghost' && !card.swarmId);
}

/**
 * Returns true if this agent card can be listed on the marketplace.
 * Ghost tier is permanently blocked (Hollow Shell prevention).
 */
export function canListAgentOnMarketplace(card: AgentCard): boolean {
  if (card.tier === 'ghost') return false;
  if (card.endpoint.type === 'tunnel') return false; // extra safety: tunnel = local brain
  return true;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/** Build an agent card for a cloud-hosted Molt Path agent */
export function buildMoltPathCard(params: {
  name:         string;
  tier:         Exclude<MoltTier, 'ghost'>;
  safeAddress:  string;
  agentId?:     number;
  swarmId?:     string;
  capabilities?: string[];
  ipaId?:       string;
}): AgentCard {
  return {
    version:      '1.0',
    name:         params.name,
    tier:         params.tier,
    architecture: params.swarmId ? 'Swarm' : 'Single',
    endpoint: {
      type:     'cloud',
      inboxUrl: `https://nftmail-email-worker.richard-159.workers.dev`,
      channel:  'nftmail',
    },
    agentId:      params.agentId,
    safeAddress:  params.safeAddress,
    swarmId:      params.swarmId,
    capabilities: params.capabilities ?? ['email', 'task-execution', 'attestation'],
    ipaId:        params.ipaId,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
}

/** Build an agent card for a Ghost Path (local sovereign) agent */
export function buildGhostCard(params: {
  name:          string;
  safeAddress:   string;
  tunnelEndpoint: string;
  agentId?:      number;
  capabilities?: string[];
  arweaveManifestUri?: string;
  swarmId?:      string;   // optional — Solo Ghost has no swarmId
}): AgentCard {
  return {
    version:      '1.0-ghost',
    name:         params.name,
    tier:         'ghost',
    architecture: params.swarmId ? 'Swarm' : 'Single',
    endpoint: {
      type:     'tunnel',
      endpoint: params.tunnelEndpoint,
      protocol: 'A2A-RPC',
    },
    agentId:      params.agentId,
    safeAddress:  params.safeAddress,
    swarmId:      params.swarmId,
    capabilities: params.capabilities ?? [
      'local-file-access',
      'private-pnl-tracking',
      'long-term-planning',
      'sovereign-compute',
    ],
    arweaveManifestUri: params.arweaveManifestUri,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
}

// ─── Routing helper (used by A2A router) ─────────────────────────────────────

export interface RoutingDecision {
  /** Where to send the message */
  destination:  string;
  /** Protocol to use */
  protocol:     'nftmail' | 'xmtp' | 'A2A-RPC' | 'MCP-over-HTTP';
  /** Whether the swarm coordinator is in the path */
  viaCoordinator: boolean;
  /** Whether this is a local sovereign agent (requires tunnel) */
  isSovereign:  boolean;
}

/**
 * Resolve the routing decision for an incoming A2A message to an agent.
 * Ghost Single agents bypass coordinator; Swarm agents route through it.
 */
export function resolveRouting(card: AgentCard): RoutingDecision {
  const bypass = shouldBypassSwarmCoordinator(card);

  if (card.endpoint.type === 'tunnel') {
    return {
      destination:   card.endpoint.endpoint,
      protocol:      card.endpoint.protocol,
      viaCoordinator: false,
      isSovereign:   true,
    };
  }

  return {
    destination:   card.endpoint.inboxUrl,
    protocol:      card.endpoint.channel,
    viaCoordinator: !bypass,
    isSovereign:   false,
  };
}
