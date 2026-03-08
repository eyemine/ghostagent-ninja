/// POST /api/x402/deliver
///
/// x402-gated A2A message delivery endpoint.
/// Agents pay $0.001 USDC (Base Sepolia testnet) per delivery.
///
/// Flow:
///   1. x402 gate checks PAYMENT-SIGNATURE header
///   2. On valid payment → forward message to recipient's inbox via worker
///   3. Return delivery receipt + settlement tx hash
///
/// Body: { fromAgent, toAgent, subject, body, agentId? }

import { NextRequest, NextResponse } from 'next/server';
import { createX402Gate } from '../../../services/x402-server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

const gate = createX402Gate({
  price:       '$0.001',
  path:        '/api/x402/deliver',
  method:      'POST',
  description: 'GhostAgent A2A inbox delivery — $0.001 USDC per message',
  mimeType:    'application/json',
});

export async function POST(request: NextRequest) {
  // ─── x402 payment gate ───
  const gateResult = await gate.handle(request);
  if (gateResult.type === 'payment-required') {
    return gateResult.response;
  }

  // ─── Parse and validate body ───
  let body: { fromAgent?: string; toAgent?: string; subject?: string; body?: string; agentId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { fromAgent, toAgent, subject, body: messageBody } = body;
  if (!fromAgent || !toAgent || !subject || !messageBody) {
    return NextResponse.json(
      { error: 'Missing required fields: fromAgent, toAgent, subject, body' },
      { status: 400 },
    );
  }

  // ─── Deliver to recipient's inbox via worker ───
  try {
    const workerRes = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:    'storeA2AMessage',
        fromAgent,
        toAgent,
        subject,
        body:      messageBody,
        agentId:   body.agentId ?? null,
        timestamp: Date.now(),
        via:       'x402',
      }),
    });

    const workerData = await workerRes.json() as Record<string, unknown>;

    return NextResponse.json({
      success:   true,
      delivered: true,
      fromAgent,
      toAgent,
      via:       'x402',
      workerStatus: workerRes.status,
      messageId: workerData?.messageId ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Delivery failed', detail: err?.message },
      { status: 502 },
    );
  }
}

/// GET — returns x402 payment requirements for discovery (no payment needed)
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    endpoint:    '/api/x402/deliver',
    description: 'GhostAgent A2A inbox delivery',
    price:       '$0.001 USDC per message',
    network:     process.env.X402_NETWORK ?? 'eip155:84532',
    payTo:       process.env.X402_PAY_TO_ADDRESS ?? '(treasury wallet)',
    usage: {
      method:  'POST',
      headers: { 'PAYMENT-SIGNATURE': '<x402 payment payload>' },
      body:    { fromAgent: 'string', toAgent: 'string', subject: 'string', body: 'string' },
    },
  });
}
