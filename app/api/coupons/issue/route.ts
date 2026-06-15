import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL     = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET  = process.env.WORKER_SECRET ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const secret     = authHeader.replace(/^Bearer\s+/, '') || (req.headers.get('X-Webhook-Secret') ?? '');
  if (!WORKER_SECRET || secret !== WORKER_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { tld?: string; maxUses?: number; note?: string };
  try { body = await req.json(); }
  catch { body = {}; }

  try {
    const res  = await fetch(WORKER_URL, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        action:   'issueCoupon',
        secret:   WEBHOOK_SECRET,
        tld:      body.tld      ?? 'nftmail.gno',
        maxUses:  body.maxUses  ?? 1,
        note:     body.note     ?? '',
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: `Worker error: ${String(e)}` }, { status: 502 });
  }
}
