import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

/**
 * POST /api/toggle-privacy
 * Body: { name: string, enabled: boolean, walletAddress: string }
 * 
 * Authenticated owner flips the privacy toggle for their .gno name.
 * Stores privacy_enabled flag in Cloudflare KV via the Worker.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, enabled, walletAddress } = await req.json();

    if (!name || typeof enabled !== 'boolean' || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing name, enabled (boolean), or walletAddress' },
        { status: 400 }
      );
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setPrivacy',
        localPart: name,
        privacyEnabled: enabled,
        walletAddress,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Worker error' }, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
