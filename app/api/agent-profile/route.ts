/// POST /api/agent-profile
/// Saves agent profile data to KV via the worker
/// Requires authenticated session (Privy wallet)

import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../utils/config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name: string;
      description?: string;
      webUrl?: string;
      socialLinks?: Record<string, string>;
    };

    const { name, description, webUrl, socialLinks } = body;

    if (!name) {
      return NextResponse.json({ error: 'Missing agent name' }, { status: 400 });
    }

    // Call worker to set agent profile
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'setAgentProfile',
        name: name.toLowerCase(),
        profile: {
          description,
          webUrl,
          socialLinks,
          updatedAt: new Date().toISOString(),
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[agent-profile] Worker error:', errorText);
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch (err: any) {
    console.error('[agent-profile] Error:', err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
