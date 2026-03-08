/// @module swarm-coordination
/// XMTP-aware swarm consensus routing.
///
/// XMTP ON  → members coordinate via XMTP group chat (MLS E2EE, real-time)
/// XMTP OFF → members coordinate via encrypted email (A2A ECIES, auditable)
///
/// Consensus hash is always logged to Glass Box regardless of method.

import type { SwarmConfig, SwarmMember, SwarmStrategy } from './vault-swarm-config';

export type CoordinationMethod = 'xmtp' | 'email';

export type VoteValue = 'yes' | 'no' | 'abstain';

export interface MemberVote {
  agentName: string;
  vote: VoteValue;
  reason?: string;
  timestamp: number;
  method: CoordinationMethod;
}

export interface ConsensusRound {
  id: string;
  vaultName: string;
  topic: string;
  payload: string;
  strategy: SwarmStrategy;
  method: CoordinationMethod;
  xmtpEnabled: boolean;
  votes: MemberVote[];
  memberCount: number;
  quorum: number;
  result: 'pending' | 'approved' | 'rejected' | 'timeout';
  consensusHash: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface GlassBoxConsensusEntry {
  roundId: string;
  vaultName: string;
  topic: string;
  result: ConsensusRound['result'];
  method: CoordinationMethod;
  memberCount: number;
  votedCount: number;
  consensusHash: string;
  timestamp: number;
  note: string;
}

/** Minimum fraction of members needed to reach consensus */
export const QUORUM_FRACTION = 0.51;

/** Derive coordination method from XMTP toggle state */
export function resolveMethod(xmtpEnabled: boolean): CoordinationMethod {
  return xmtpEnabled ? 'xmtp' : 'email';
}

/** Human-readable label for dashboard */
export const METHOD_LABEL: Record<CoordinationMethod, string> = {
  xmtp:  'XMTP Group Chat (E2EE)',
  email: 'Encrypted Email (ECIES)',
};

/** Badge label shown in SwarmConsensus component */
export const METHOD_BADGE: Record<CoordinationMethod, string> = {
  xmtp:  'XMTP',
  email: 'Email',
};

/** Start a new consensus round */
export function createConsensusRound(params: {
  vaultName: string;
  topic: string;
  payload: string;
  config: SwarmConfig;
  xmtpEnabled: boolean;
  consensusHash: string;
}): ConsensusRound {
  const method = resolveMethod(params.xmtpEnabled);
  const memberCount = params.config.members.length;
  return {
    id: `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    vaultName: params.vaultName,
    topic: params.topic,
    payload: params.payload,
    strategy: params.config.strategy,
    method,
    xmtpEnabled: params.xmtpEnabled,
    votes: [],
    memberCount,
    quorum: Math.ceil(memberCount * QUORUM_FRACTION),
    result: 'pending',
    consensusHash: params.consensusHash,
    createdAt: Date.now(),
  };
}

/** Register a vote and resolve result if quorum reached */
export function applyVote(round: ConsensusRound, vote: Omit<MemberVote, 'timestamp' | 'method'>): ConsensusRound {
  if (round.result !== 'pending') return round;
  const already = round.votes.find(v => v.agentName === vote.agentName);
  if (already) return round;

  const newVote: MemberVote = { ...vote, timestamp: Date.now(), method: round.method };
  const votes = [...round.votes, newVote];

  const yesCount = votes.filter(v => v.vote === 'yes').length;
  const noCount  = votes.filter(v => v.vote === 'no').length;

  let result: ConsensusRound['result'] = 'pending';
  if (yesCount >= round.quorum)                        result = 'approved';
  else if (noCount > round.memberCount - round.quorum) result = 'rejected';

  return {
    ...round,
    votes,
    result,
    resolvedAt: result !== 'pending' ? Date.now() : undefined,
  };
}

/** Build a Glass Box audit entry for a consensus round */
export function buildConsensusAuditEntry(round: ConsensusRound): GlassBoxConsensusEntry {
  return {
    roundId:       round.id,
    vaultName:     round.vaultName,
    topic:         round.topic,
    result:        round.result,
    method:        round.method,
    memberCount:   round.memberCount,
    votedCount:    round.votes.length,
    consensusHash: round.consensusHash,
    timestamp:     Date.now(),
    note: `Swarm Consensus: ${round.votes.length}/${round.memberCount} Agents (${METHOD_BADGE[round.method]})`,
  };
}

/** Derive per-strategy vote requirement */
export function strategyLabel(strategy: SwarmStrategy): string {
  switch (strategy) {
    case 'consensus':   return `>${Math.round(QUORUM_FRACTION * 100)}% majority`;
    case 'parallel':    return 'First valid response';
    case 'pipeline':    return 'Sequential — each stage must approve';
    case 'competitive': return 'Fastest valid response';
  }
}
