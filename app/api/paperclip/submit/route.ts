/**
 * POST /api/paperclip/submit
 *
 * Submit a Paperclip TEE attestation for a swarm agent task.
 * Hashes the result payload, relays submitAttestation() to the worker,
 * caches the record in KV, and returns the nota verification URL.
 *
 * Body:
 *   { agentName, taskId, resultPayload, ownerAddress, notaRef? }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  submitAttestation,
  buildPaperclipAuditEntry,
  hashPayload,
  notaUrl,
  notaRefFromHash,
  type AttestationBundle,
  PAPERCLIP_WORKER_URL,
} from '../../../services/paperclip-attestation';

export async function POST(req: NextRequest) {
  let body: {
    agentName?: string;
    taskId?: string;
    resultPayload?: string;
    ownerAddress?: string;
    notaRef?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { agentName, taskId, resultPayload, ownerAddress, notaRef } = body;

  if (!agentName || !taskId || !resultPayload || !ownerAddress) {
    return NextResponse.json(
      { error: 'Missing required fields: agentName, taskId, resultPayload, ownerAddress' },
      { status: 400 }
    );
  }

  // ── Submit attestation via worker relay ──────────────────────────────────────
  const result = await submitAttestation({
    agentName,
    taskId,
    resultPayload,
    ownerAddress,
    notaRef,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Submission failed' }, { status: 502 });
  }

  const proofHash = result.proofHash!;
  const ref       = notaRef ?? notaRefFromHash(proofHash);

  // ── Build audit bundle and cache in KV ──────────────────────────────────────
  const bundle: AttestationBundle = {
    proofHash,
    taskId,
    agentName,
    agentAddress:  ownerAddress,
    resultSummary: `Attestation for task ${taskId.slice(0, 10)}…`,
    notaRef:       ref,
    submittedAt:   Date.now(),
    status:        'submitted',
    txHash:        result.txHash,
    chainId:       100,
  };

  const auditEntry = buildPaperclipAuditEntry(bundle);

  // Cache attestation record in worker KV for fast lookup
  try {
    await fetch(PAPERCLIP_WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'kvPut',
        key:          `paperclip:attestation:${proofHash}`,
        value:        JSON.stringify({ ...bundle, auditEntry }),
        ownerAddress: ownerAddress.toLowerCase(),
      }),
    });
  } catch {
    // Non-fatal — on-chain record exists regardless
  }

  return NextResponse.json({
    ok:        true,
    proofHash,
    notaUrl:   notaUrl(proofHash),
    notaRef:   ref,
    txHash:    result.txHash,
    auditEntry,
  });
}
