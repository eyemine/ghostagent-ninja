import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';

/**
 * POST /api/burn
 * Server-side proxy for the Sovereign Kill-Switch.
 * Keeps WEBHOOK_SECRET server-side while forwarding the wallet signature.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      localPart?: string;
      signature?: string;
      scope?: 'messages' | 'full';
    };

    const { localPart, signature, scope = 'messages' } = body;

    if (!localPart || !signature) {
      return NextResponse.json({ error: 'Missing localPart or signature' }, { status: 400 });
    }

    if (scope === 'full' && !WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Full burn not configured (missing WEBHOOK_SECRET)' }, { status: 503 });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'purgeInbox',
        localPart,
        signature,
        scope,
        ...(scope === 'full' ? { secret: WEBHOOK_SECRET } : {}),
      }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
