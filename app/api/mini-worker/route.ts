/// Retired. This proxy attached WORKER_SECRET to any action from any caller,
/// which let anyone read, purge, re-key or send from any nftmail inbox. The
/// ghostagent.ninja mini app is inactive; the nftmail.box mini app has its own
/// authenticated proxy (Quick Auth / Privy + inbox ownership).
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Gone — use https://nftmail.box/mini' }, { status: 410 });
}
