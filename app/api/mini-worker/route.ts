/// Server-side proxy for mini app worker calls.
/// Adds X-Worker-Secret so the browser never sees the secret.
import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (WORKER_SECRET) {
      headers['X-Worker-Secret'] = WORKER_SECRET;
    }
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers,
      body,
    });
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Proxy error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
