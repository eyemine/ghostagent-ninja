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
const WORKER_SECRET = process.env.WEBHOOK_SECRET || '';

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

const PROFESSIONAL_MIN_XDAI = 9.5;  // 10 xDAI - 0.5 rounding buffer (tx.amount = net crypto received)
const VAULT_MIN_XDAI       = 23.5;  // 24 xDAI - 0.5 rounding buffer

async function triggerEvolveOnFundedWallet(tx: MercuryoTransaction): Promise<void> {
  if (!WORKER_SECRET) return;
  if (tx.network?.toUpperCase() !== 'GNOSIS') return;
  if (tx.currency?.toUpperCase() !== 'XDAI') return;

  const wallet = tx.address.toLowerCase();

  // Look up pending upgrade intent for this wallet
  let pending: { agentName: string; tier: string } | null = null;
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'getPendingUpgrade', walletAddress: wallet }),
    });
    const data = await res.json() as { pending: boolean; agentName?: string; tier?: string };
    if (data.pending && data.agentName && data.tier) {
      pending = { agentName: data.agentName, tier: data.tier };
    }
  } catch {
    return; // Non-fatal
  }

  if (!pending) return;

  // Verify amount is sufficient for the requested tier
  const amount = Number(tx.amount);
  if (pending.tier === 'vault'       && amount < VAULT_MIN_XDAI)        return;
  if (pending.tier === 'professional' && amount < PROFESSIONAL_MIN_XDAI) return;

  // Fire upgradeTier
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action:        'upgradeTier',
        name:          pending.agentName,
        tier:          pending.tier,
        walletAddress: wallet,
        txHash:        tx.tx_id ?? '',
      }),
    });
  } catch {
    // Non-fatal — Glass Box audit already logged the payment
  }
}

async function logToGlassBox(tx: MercuryoTransaction): Promise<void> {
  if (!WORKER_SECRET) return;
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
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
        secret: WORKER_SECRET,
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
    await Promise.all([
      logToGlassBox(tx),
      triggerEvolveOnFundedWallet(tx),
    ]);
  }

  return NextResponse.json({ received: true, txId: tx.id, status: tx.status });
}
