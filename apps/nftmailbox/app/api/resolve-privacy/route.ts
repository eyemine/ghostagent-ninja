import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

/**
 * GET /api/resolve-privacy?name=richard
 * 
 * Public endpoint — anyone can check if a .gno name has privacy enabled.
 * Returns { privacyEnabled: boolean }
 * Default: false (Exposed) for names that haven't toggled yet.
 */
export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get('name');
    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getPrivacy',
        localPart: name,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ privacyEnabled: false });
    }

    return NextResponse.json({ privacyEnabled: data.privacyEnabled ?? false });
  } catch {
    return NextResponse.json({ privacyEnabled: false });
  }
}
