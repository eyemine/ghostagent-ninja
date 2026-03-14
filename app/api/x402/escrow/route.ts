/**
 * POST /api/x402/escrow
 *
 * x402 escrow payment actions: create, release, refund.
 *
 * Body:
 *   { action: 'escrow', agentId, taskId, agentSafe, amount, ownerAddress }
 *   { action: 'release', taskId, ownerAddress }
 *   { action: 'refund',  taskId, reason, ownerAddress }
 */

import { NextRequest, NextResponse } from 'next/server';
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
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { action, taskId, ownerAddress } = body as {
    action?: string; taskId?: string; ownerAddress?: string;
  };

  if (!action || !taskId || !ownerAddress) {
    return NextResponse.json({ error: 'Missing action, taskId, or ownerAddress' }, { status: 400 });
  }

  if (action === 'escrow') {
    const { agentId, agentSafe, amount } = body as { agentId?: number; agentSafe?: string; amount?: string };
    if (!agentId || !agentSafe || !amount) {
      return NextResponse.json({ error: 'Missing agentId, agentSafe, or amount' }, { status: 400 });
    }
    const data = await workerPost({
      action: 'x402Escrow',
      subAction: 'escrow',
      taskId,
      agentId,
      agentSafe,
      amount,
      ownerAddress,
    });
    return NextResponse.json(data);
  }

  if (action === 'release') {
    const data = await workerPost({ action: 'x402Escrow', subAction: 'release', taskId, ownerAddress });
    return NextResponse.json(data);
  }

  if (action === 'refund') {
    const { reason } = body as { reason?: string };
    const data = await workerPost({
      action: 'x402Escrow',
      subAction: 'refund',
      taskId,
      reason: reason ?? 'Manual refund',
      ownerAddress,
    });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });

  const data = await workerPost({ action: 'kvGet', key: `x402:escrow:${taskId}` });
  if (!data?.value) return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });

  return NextResponse.json(JSON.parse(data.value));
}
