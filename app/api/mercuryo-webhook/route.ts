/**
 * POST /api/mercuryo-webhook
 * Receives Mercuryo transaction status webhooks.
 *
 * Mercuryo sends a POST with an HMAC-SHA256 signature when a transaction
 * status changes. We verify the signature, then on COMPLETED log to
 * Glass Box audit and optionally trigger post-purchase flows.
 *
 * Environment vars required:
 *   MERCURYO_SECRET_KEY  — from Mercuryo dashboard (Settings → Webhooks)
 *
 * Docs: https://help.mercuryo.io/en/articles/6122185-mercuryo-widget-guide
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { WORKER_URL } from '../../utils/config';

const MERCURYO_SECRET = process.env.MERCURYO_SECRET_KEY ?? '';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

interface MercuryoTransaction {
  id: string;
  status: string;              // paid | new | pending | failed | cancelled | order_scheduled
  currency: string;            // XDAI
  amount: number;              // crypto amount
  fiat_currency: string;       // USD
  fiat_amount: number;
  address: string;             // recipient wallet
  network: string;             // GNOSIS
  tx_id?: string;              // on-chain tx hash (present when paid)
  created_at: string;
  updated_at?: string;
}

interface MercuryoWebhookPayload {
  data: MercuryoTransaction;
}

function verifyMercuryoSignature(rawBody: string, signature: string): boolean {
  if (!MERCURYO_SECRET) return false;
  const expected = createHmac('sha256', MERCURYO_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

async function logToGlassBox(tx: MercuryoTransaction): Promise<void> {
  if (!WEBHOOK_SECRET) return;
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'auditLog',
        event:  'mercuryo_transaction_paid',
        data: {
          txId:            tx.id,
          walletAddress:   tx.address,
          cryptoCurrency:  tx.currency,
          cryptoAmount:    tx.amount,
          fiatAmount:      tx.fiat_amount,
          fiatCurrency:    tx.fiat_currency,
          network:         tx.network,
          onChainTxHash:   tx.tx_id ?? null,
          completedAt:     tx.updated_at ?? tx.created_at,
        },
        secret: WEBHOOK_SECRET,
      }),
    });
  } catch {
    // Non-fatal — transaction already confirmed by Mercuryo
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // Verify Mercuryo webhook signature
  const signature = req.headers.get('x-mercuryo-signature') ?? '';
  if (MERCURYO_SECRET && !verifyMercuryoSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: MercuryoWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MercuryoWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tx = payload?.data;
  if (!tx?.id || !tx?.status) {
    return NextResponse.json({ error: 'Missing transaction data' }, { status: 400 });
  }

  // Only act on paid transactions
  if (tx.status === 'paid') {
    await logToGlassBox(tx);

    // Future hook: if wallet matches a pending evolve, trigger tier unlock
    // await triggerEvolveOnFundedWallet(tx.address, tx.amount);
  }

  return NextResponse.json({ received: true, txId: tx.id, status: tx.status });
}
