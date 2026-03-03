import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

export type PrivacyTier = 'exposed' | 'private' | 'hard-privacy';

/**
 * GET /api/privacy?name=victor&tld=agent.gno
 * Returns the current privacy tier for an agent.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  const tld  = req.nextUrl.searchParams.get('tld') || 'agent.gno';

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getPrivacy', localPart: name, tld }),
    });

    const data = await res.json() as { tier?: PrivacyTier; privacyEnabled?: boolean };
    const tier: PrivacyTier = data.tier ?? (data.privacyEnabled ? 'private' : 'exposed');
    return NextResponse.json({ tier, privacyEnabled: tier !== 'exposed' });
  } catch {
    return NextResponse.json({ tier: 'exposed', privacyEnabled: false });
  }
}

/**
 * POST /api/privacy
 * Body: { name, tld, tier, walletAddress, signature }
 *
 * Authenticated wallet toggles privacy tier for their agent.
 * - molt.gno: only 'private' tier costs $0.20/email (enforced downstream)
 * - All other tlds: 'exposed' ↔ 'private' free toggle
 * - 'hard-privacy' requires on-chain payment (enforced downstream)
 */
export async function POST(req: NextRequest) {
  try {
    const { name, tld, tier, walletAddress, signature } = await req.json() as {
      name: string;
      tld: string;
      tier: PrivacyTier;
      walletAddress: string;
      signature?: string;
    };

    if (!name || !tld || !tier || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: name, tld, tier, walletAddress' },
        { status: 400 }
      );
    }

    if (!['exposed', 'private', 'hard-privacy'].includes(tier)) {
      return NextResponse.json(
        { error: 'Invalid tier — must be exposed | private | hard-privacy' },
        { status: 400 }
      );
    }

    // molt.gno: private tier charges $0.20/email — flag for downstream billing
    const isMoltPrivatePaid = tld === 'molt.gno' && tier === 'private';

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setPrivacy',
        localPart: name,
        tld,
        tier,
        walletAddress,
        signature: signature ?? null,
        moltPrivatePaid: isMoltPrivatePaid,
      }),
    });

    const data = await res.json() as { status?: string; tier?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({
      status: 'ok',
      tier: data.tier ?? tier,
      privacyEnabled: tier !== 'exposed',
      moltPrivatePaid: isMoltPrivatePaid,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
