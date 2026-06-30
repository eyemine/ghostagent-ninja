import { NextResponse } from 'next/server';

// Mini App is paused — return 404 so Farcaster does not embed ghostagent.ninja
// URLs as a mini app frame. Re-enable by restoring the accountAssociation +
// miniapp sections once the mini app is ready to re-launch.
export async function GET() {
  return NextResponse.json({ error: 'mini app not active' }, { status: 404 });
}
