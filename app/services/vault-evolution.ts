/// @module vault-evolution
/// Migration logic: human inbox (swarm.acme@nftmail.box, BASIC)
///                → vault.gno agent inbox (swarm.acme_@nftmail.box)
///
/// Steps:
///   1. Validate name availability on vault.gno
///   2. Record migration intent in KV
///   3. On-chain: mint vault.gno NFT → deploy ERC6551 TBA → deploy Safe
///   4. Migrate email history from human KV key to agent KV key
///   5. Preserve contacts list
///   6. Emit Glass Box audit entry

export type EvolutionStatus =
  | 'pending'
  | 'minting'
  | 'deploying-safe'
  | 'migrating-email'
  | 'complete'
  | 'failed';

export interface VaultEvolutionRecord {
  clientName: string;            // e.g. "acme"
  humanEmail: string;            // swarm.acme@nftmail.box
  agentEmail: string;            // swarm.acme_@nftmail.box
  ownerAddress: string;
  safeAddress: string | null;
  tbaAddress: string | null;
  txHash: string | null;
  status: EvolutionStatus;
  migratedMessageCount: number;
  migratedContactCount: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface EvolutionAuditEntry {
  id: string;
  clientName: string;
  humanEmail: string;
  agentEmail: string;
  ownerAddress: string;
  status: EvolutionStatus;
  migratedMessageCount: number;
  migratedContactCount: number;
  timestamp: number;
  note: string;
}

/** Cost in xDAI to evolve a human inbox to vault.gno */
export const VAULT_EVOLUTION_COST_XDAI = 14;

/** Derive human-format inbox address (no underscore) */
export function humanEmailAddress(clientName: string): string {
  return `swarm.${clientName.toLowerCase()}@nftmail.box`;
}

/** Derive agent-format inbox address (underscore suffix) */
export function agentEmailAddress(clientName: string): string {
  return `swarm.${clientName.toLowerCase()}_@nftmail.box`;
}

/** KV key for human inbox messages */
export function humanInboxKey(clientName: string): string {
  return `inbox:swarm.${clientName.toLowerCase()}`;
}

/** KV key for agent blind index (post-migration) */
export function agentBlindIndexKey(clientName: string): string {
  return `blind-index:swarm.${clientName.toLowerCase()}_`;
}

/** Build initial evolution record */
export function buildEvolutionRecord(params: {
  clientName: string;
  ownerAddress: string;
}): VaultEvolutionRecord {
  const name = params.clientName.toLowerCase();
  return {
    clientName:            name,
    humanEmail:            humanEmailAddress(name),
    agentEmail:            agentEmailAddress(name),
    ownerAddress:          params.ownerAddress.toLowerCase(),
    safeAddress:           null,
    tbaAddress:            null,
    txHash:                null,
    status:                'pending',
    migratedMessageCount:  0,
    migratedContactCount:  0,
    startedAt:             Date.now(),
    completedAt:           null,
    error:                 null,
  };
}

/** Build Glass Box audit entry for evolution */
export function buildEvolutionAuditEntry(record: VaultEvolutionRecord): EvolutionAuditEntry {
  return {
    id:                   `evo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName:           record.clientName,
    humanEmail:           record.humanEmail,
    agentEmail:           record.agentEmail,
    ownerAddress:         record.ownerAddress,
    status:               record.status,
    migratedMessageCount: record.migratedMessageCount,
    migratedContactCount: record.migratedContactCount,
    timestamp:            Date.now(),
    note: record.status === 'complete'
      ? `Evolved to vault.gno: ${record.agentEmail}`
      : `Evolution ${record.status}: ${record.error ?? ''}`,
  };
}

/** Status label for UI display */
export const STATUS_LABEL: Record<EvolutionStatus, string> = {
  pending:          'Pending',
  minting:          'Minting NFT…',
  'deploying-safe': 'Deploying Safe…',
  'migrating-email':'Migrating email history…',
  complete:         'Evolution complete ✓',
  failed:           'Evolution failed',
};

export const STATUS_COLOR: Record<EvolutionStatus, string> = {
  pending:          'text-zinc-400',
  minting:          'text-amber-300',
  'deploying-safe': 'text-amber-300',
  'migrating-email':'text-amber-300',
  complete:         'text-emerald-300',
  failed:           'text-red-400',
};
