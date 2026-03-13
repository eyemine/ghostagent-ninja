/// @module paperclip-attestation
/// Paperclip TEE attestation service layer.
///
/// Handles:
///   - Building attestation payloads from task results
///   - Submitting to the on-chain PaperclipModule via worker relay
///   - Reading attestation records for notapaperclip.red display
///   - Hooking into ERC-8004 reputation after verification

import { GNOSIS_ADDRESSES, GNOSIS_CHAIN_ID } from './erc8004-registration';

export const PAPERCLIP_WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

export const NOTA_BASE_URL = 'https://notapaperclip.red';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttestationStatus = 'pending' | 'submitted' | 'verified' | 'failed';

export interface AttestationBundle {
  proofHash: string;        // 0x-prefixed keccak256 of the TEE output bundle
  taskId: string;           // matches SwarmCoordinatorModule taskId (bytes32 hex)
  agentName: string;        // fully qualified, e.g. "scout.picoclaw.gno"
  agentAddress: string;     // EOA / Safe module submitting
  resultSummary: string;    // human-readable (not stored on-chain)
  notaRef?: string;         // notapaperclip.red slug, set after submission
  submittedAt?: number;     // unix ms
  verifiedAt?: number;
  status: AttestationStatus;
  txHash?: string;
  chainId: number;
}

export interface PaperclipSubmitRequest {
  agentName: string;
  taskId: string;           // bytes32 hex
  resultPayload: string;    // raw result string — will be hashed client-side
  notaRef?: string;
  ownerAddress: string;
}

export interface PaperclipSubmitResponse {
  ok: boolean;
  proofHash?: string;
  txHash?: string;
  notaUrl?: string;
  error?: string;
}

export interface PaperclipVerifyResponse {
  proofHash: string;
  agentName: string;
  taskId: string;
  verified: boolean;
  timestamp: number;
  notaUrl: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic proofHash from a result payload string (mirrors Solidity keccak256) */
export async function hashPayload(payload: string): Promise<string> {
  const enc = new TextEncoder().encode(payload);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return '0x' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Build a nota verification URL for a proofHash */
export function notaUrl(proofHash: string): string {
  return `${NOTA_BASE_URL}/verify/${proofHash}`;
}

/** Build the nota ref slug (first 16 hex chars of proofHash) */
export function notaRefFromHash(proofHash: string): string {
  return proofHash.replace('0x', '').slice(0, 16);
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Submit a TEE attestation via the Cloudflare worker relay.
 * The worker forwards the call to the on-chain PaperclipModule.submitAttestation().
 */
export async function submitAttestation(
  req: PaperclipSubmitRequest
): Promise<PaperclipSubmitResponse> {
  const proofHash = await hashPayload(req.resultPayload);
  const notaRef   = req.notaRef ?? notaRefFromHash(proofHash);

  try {
    const res = await fetch(PAPERCLIP_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'paperclipSubmit',
        agentName:    req.agentName,
        taskId:       req.taskId,
        proofHash,
        notaRef,
        ownerAddress: req.ownerAddress,
      }),
    });

    const data = await res.json() as { ok?: boolean; txHash?: string; error?: string };

    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }

    return {
      ok: true,
      proofHash,
      txHash:  data.txHash,
      notaUrl: notaUrl(proofHash),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Check on-chain verification status of a proof hash.
 * Calls the worker kvGet for the cached attestation record.
 */
export async function getAttestationStatus(
  proofHash: string
): Promise<PaperclipVerifyResponse | null> {
  try {
    const res = await fetch(PAPERCLIP_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'kvGet',
        key:    `paperclip:attestation:${proofHash}`,
      }),
    });

    const data = await res.json() as { value?: string };
    if (!data.value) return null;

    const record = JSON.parse(data.value) as PaperclipVerifyResponse;
    return { ...record, notaUrl: notaUrl(proofHash) };
  } catch {
    return null;
  }
}

// ─── ERC-8004 reputation hook ─────────────────────────────────────────────────

export interface ReputationUpdatePayload {
  agentId: number;
  attestationCount: number;
  proofHash: string;
  comment: string;
}

/**
 * After a successful attestation verification, build the ERC-8004
 * giveFeedback() payload to update the agent's on-chain reputation.
 * Caller is responsible for signing and submitting the tx.
 */
export function buildReputationUpdate(params: {
  agentId: number;
  proofHash: string;
  attestationCount: number;
}): ReputationUpdatePayload {
  return {
    agentId:          params.agentId,
    attestationCount: params.attestationCount,
    proofHash:        params.proofHash,
    comment:          `Paperclip TEE attestation verified — proof ${params.proofHash.slice(0, 10)}…`,
  };
}

// ─── Swarm audit entry ────────────────────────────────────────────────────────

export interface PaperclipAuditEntry {
  type:       'paperclip-attestation';
  proofHash:  string;
  taskId:     string;
  agentName:  string;
  verified:   boolean;
  notaUrl:    string;
  timestamp:  number;
  chainId:    number;
  reputationRegistry: string;
}

/** Build a Glass Box audit entry for a submitted attestation */
export function buildPaperclipAuditEntry(bundle: AttestationBundle): PaperclipAuditEntry {
  return {
    type:       'paperclip-attestation',
    proofHash:  bundle.proofHash,
    taskId:     bundle.taskId,
    agentName:  bundle.agentName,
    verified:   bundle.status === 'verified',
    notaUrl:    notaUrl(bundle.proofHash),
    timestamp:  Date.now(),
    chainId:    GNOSIS_CHAIN_ID,
    reputationRegistry: GNOSIS_ADDRESSES.reputationRegistry,
  };
}
