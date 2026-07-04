import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../utils/config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({ action: 'listAgents' }),
      cache: 'no-store',
    });

    const bodyText = await res.text();
    
    return NextResponse.json({
      workerUrl: WORKER_URL,
      hasSecret: !!WORKER_SECRET,
      secretLength: WORKER_SECRET.length,
      status: res.status,
      ok: res.ok,
      body: bodyText.slice(0, 1000),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
