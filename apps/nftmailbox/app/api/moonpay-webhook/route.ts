import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

// MoonPay signs webhooks with HMAC-SHA256 using your webhook secret key
const MOONPAY_WEBHOOK_SECRET = process.env.MOONPAY_WEBHOOK_SECRET || '';
const WORKER_URL = process.env.NEXT_PUBLIC_NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function verifyMoonPaySignature(payload: string, signature: string): boolean {
  if (!MOONPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', MOONPAY_WEBHOOK_SECRET)
    .update(payload)
    .digest('base64');
  return signature === expected;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('moonpay-signature-v2') || req.headers.get('x-moonpay-signature') || '';

  // Verify signature in production
  if (MOONPAY_WEBHOOK_SECRET && !verifyMoonPaySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // MoonPay transaction_updated event with status = completed
  // externalCustomerId = label@nftmail.box (set when building the MoonPay URL)
  if (event.type === 'transaction_updated' && event.data?.status === 'completed') {
    const tx = event.data;
    const email = tx.externalCustomerId as string | undefined;   // e.g. "alice.ops@nftmail.box"
    const walletAddress = tx.walletAddress as string | undefined;
    const cryptoAmount = tx.cryptoAmount as number | undefined;
    const currencyCode = tx.cryptoCurrencyCode as string | undefined; // "XDAI" or "EURE"

    if (!email || !walletAddress) {
      return NextResponse.json({ error: 'Missing externalCustomerId or walletAddress' }, { status: 400 });
    }

    // Determine tier from amount
    let tier: string | null = null;
    if (cryptoAmount !== undefined) {
      if (cryptoAmount >= 24) tier = 'premium';     // Imago / Pro
      else if (cryptoAmount >= 10) tier = 'lite';   // Pupa
    }

    if (!tier) {
      return NextResponse.json({ error: `Amount ${cryptoAmount} does not match any tier` }, { status: 400 });
    }

    // Derive label from email
    const label = email.replace('@nftmail.box', '').replace('.', '-');

    // Activate tier via worker
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        },
        body: JSON.stringify({
          action: 'upgradeTierWebhook',
          label,
          ownerWallet: walletAddress.toLowerCase(),
          newTier: tier,
          paymentRef: tx.id,
          paymentToken: currencyCode?.toLowerCase() === 'eure' ? 'eure' : 'xdai',
          paymentValue: `${cryptoAmount} ${currencyCode}`,
          source: 'moonpay',
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        console.error('[moonpay-webhook] Worker tier upgrade failed:', data);
        return NextResponse.json({ error: data.error || 'Tier upgrade failed' }, { status: 500 });
      }
    } catch (err) {
      console.error('[moonpay-webhook] Worker call failed:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
