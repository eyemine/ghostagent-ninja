/**
 * POST /api/reputation/update
 *
 * Update ERC-8004 on-chain reputation after Paperclip attestation.
 *
 * Body:
 *   { agentId, paperclipScore, proofHash, ownerAddress }
 *
 * GET /api/reputation/update?agentId=123
 *   Returns reputation history from KV cache
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildReputationUpdate } from '../../../services/paperclip-attestation';
import { GNOSIS_ADDRESSES } from '../../../services/erc8004-registration';
import { WORKER_URL } from '../../../utils/config';


async function workerPost(body: Record<string, unknown>) {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  let body: { agentId?: number; paperclipScore?: number; proofHash?: string; ownerAddress?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { agentId, paperclipScore, proofHash, ownerAddress } = body;

  if (agentId === undefined || paperclipScore === undefined || !proofHash || !ownerAddress) {
    return NextResponse.json(
      { error: 'Missing agentId, paperclipScore, proofHash, or ownerAddress' },
      { status: 400 }
    );
  }

  if (paperclipScore < 0 || paperclipScore > 1000) {
    return NextResponse.json({ error: 'paperclipScore must be 0-1000' }, { status: 400 });
  }

  // Build the ERC-8004 giveFeedback payload
  const attestationCount = 1; // caller can pass actual count; default 1 per call
  const reputationPayload = buildReputationUpdate({ agentId, proofHash, attestationCount });

  // Map paperclipScore → ERC-8004 feedback (-1 / 0 / 1)
  const feedback = paperclipScore >= 700 ? 1 : paperclipScore >= 400 ? 0 : -1;

  // Relay to worker which caches the record (on-chain call handled by Safe tx builder)
  const record = {
    agentId,
    paperclipScore,
    feedback,
    proofHash,
    comment: reputationPayload.comment,
    timestamp: Date.now(),
    reputationRegistry: GNOSIS_ADDRESSES.reputationRegistry,
    chainId: 100,
  };

  // Cache in KV
  const histKey = `reputation:agent:${agentId}`;
  const existing = await workerPost({ action: 'kvGet', key: histKey });
  const history: unknown[] = existing?.value ? JSON.parse(existing.value) : [];
  history.push(record);
  await workerPost({ action: 'kvPut', key: histKey, value: JSON.stringify(history), ownerAddress });

  // Glass Box audit
  const auditKey = `audit:reputation:${agentId}`;
  const auditRaw = await workerPost({ action: 'kvGet', key: auditKey });
  const auditLog: unknown[] = auditRaw?.value ? JSON.parse(auditRaw.value) : [];
  auditLog.push({ type: 'erc8004-reputation-update', ...record });
  await workerPost({ action: 'kvPut', key: auditKey, value: JSON.stringify(auditLog), ownerAddress });

  const displayScore = Math.round(paperclipScore * 0.847); // normalise to ~847/1000 scale for display

  return NextResponse.json({
    ok: true,
    agentId,
    paperclipScore,
    displayScore,
    feedback,
    comment: reputationPayload.comment,
    reputationRegistry: GNOSIS_ADDRESSES.reputationRegistry,
    message: `Reputation Updated: ${displayScore}/1000`,
    note: 'Cache updated. Submit giveFeedback() tx via Safe to finalise on-chain.',
  });
}

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });

  const data = await workerPost({ action: 'kvGet', key: `reputation:agent:${agentId}` });
  const history = data?.value ? JSON.parse(data.value) : [];

  return NextResponse.json({ agentId: Number(agentId), history });
}
