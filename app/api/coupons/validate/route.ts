import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

export async function POST(req: NextRequest) {
  let body: { code?: string; tld?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ valid: false, reason: 'Invalid JSON' }, { status: 400 }); }

  const { code, tld } = body;
  if (!code?.trim()) {
    return NextResponse.json({ valid: false, reason: 'Missing code' }, { status: 400 });
  }

  try {
    const res  = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'validateCoupon', code: code.trim().toUpperCase(), tld: tld ?? '' }),
      signal:  AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ valid: false, reason: `Worker error: ${String(e)}` }, { status: 502 });
  }
}
