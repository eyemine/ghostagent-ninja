/**
 * POST /api/transak-webhook
 * Receives Transak order status webhooks.
 *
 * Transak sends a POST with a signed JWT payload when an order status changes.
 * We verify the signature, then on COMPLETED log to Glass Box audit and
 * optionally trigger any post-purchase flow (e.g. evolve tier unlock).
 *
 * Environment vars required:
 *   TRANSAK_SECRET_KEY  — from Transak dashboard (Settings → Webhook)
 *
 * Docs: https://docs.transak.com/docs/webhooks
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { WORKER_URL } from '../../utils/config';

const TRANSAK_SECRET = process.env.TRANSAK_SECRET_KEY ?? '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

interface TransakOrder {
  id: string;
  status: string;                  // COMPLETED | FAILED | CANCELLED | PENDING
  cryptoCurrencyCode: string;      // XDAI
  cryptoAmount: number;
  fiatAmount: number;
  fiatCurrency: string;
  walletAddress: string;
  network: string;                 // gnosis
  transactionHash?: string;
  createdAt: string;
  completedAt?: string;
}

interface TransakWebhookPayload {
  webhookData: TransakOrder;
}

function verifyTransakSignature(rawBody: string, signature: string): boolean {
  if (!TRANSAK_SECRET) return false;
  const expected = createHmac('sha256', TRANSAK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

async function logToGlassBox(order: TransakOrder): Promise<void> {
  if (!WEBHOOK_SECRET) return;
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'auditLog',
        event:  'transak_order_completed',
        data: {
          orderId:           order.id,
          walletAddress:     order.walletAddress,
          cryptoCurrency:    order.cryptoCurrencyCode,
          cryptoAmount:      order.cryptoAmount,
          fiatAmount:        order.fiatAmount,
          fiatCurrency:      order.fiatCurrency,
          network:           order.network,
          transactionHash:   order.transactionHash ?? null,
          completedAt:       order.completedAt ?? new Date().toISOString(),
        },
        secret: WEBHOOK_SECRET,
      }),
    });
  } catch {
    // Non-fatal — order is already confirmed by Transak
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // Verify Transak webhook signature
  const signature = req.headers.get('x-transak-signature') ?? '';
  if (TRANSAK_SECRET && !verifyTransakSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: TransakWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TransakWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const order = payload?.webhookData;
  if (!order?.id || !order?.status) {
    return NextResponse.json({ error: 'Missing order data' }, { status: 400 });
  }

  // Only act on completed orders
  if (order.status === 'COMPLETED') {
    await logToGlassBox(order);

    // Future hook: if wallet matches a pending evolve, trigger tier unlock
    // await triggerEvolveOnFundedWallet(order.walletAddress, order.cryptoAmount);
  }

  return NextResponse.json({ received: true, orderId: order.id, status: order.status });
}
