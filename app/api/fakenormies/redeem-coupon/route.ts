import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

const WORKER_URL    = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET  ?? '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

type CouponPayload = {
  slug: string;
  tier: 'basic' | 'pro' | 'premium';
  expiry: number;
  issuedAt: number;
};

export async function POST(req: Request) {
  const { coupon } = (await req.json().catch(() => ({}))) as { coupon?: string };
  if (!coupon) return NextResponse.json({ error: 'coupon required' }, { status: 400 });
  if (!WEBHOOK_SECRET) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const [payloadB64, sig] = coupon.split('.');
  if (!payloadB64 || !sig) return NextResponse.json({ error: 'invalid coupon format' }, { status: 400 });

  // Verify HMAC-SHA256
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(payloadB64).digest('base64url');
  try {
    const a = new Uint8Array(Buffer.from(sig, 'base64url'));
    const b = new Uint8Array(Buffer.from(expected, 'base64url'));
    if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'invalid coupon' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid coupon' }, { status: 403 });
  }

  let payload: CouponPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as CouponPayload;
  } catch {
    return NextResponse.json({ error: 'malformed coupon' }, { status: 400 });
  }

  const { slug, tier, expiry } = payload;

  if (expiry > 0 && Date.now() / 1000 > expiry) {
    return NextResponse.json({ error: 'coupon expired' }, { status: 410 });
  }

  const VALID_TIERS = ['basic', 'pro', 'premium'];
  if (!slug || !VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: 'invalid coupon payload' }, { status: 400 });
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Worker-Secret': WORKER_SECRET,
    'X-Webhook-Secret': WEBHOOK_SECRET,
  };

  // beacon naming pattern: {slug-with-hyphens}.agent.gno
  const beaconLabel = slug.replace(/\./g, '-');
  const tld = 'agent.gno';

  const [tierRes, tldRes] = await Promise.all([
    fetch(WORKER_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'setAgentRecord', agentName: slug, tier, secret: WEBHOOK_SECRET }),
    }).then(r => r.json()).catch(() => null),
    fetch(WORKER_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'setTld', agentName: slug, tld, webhookSecret: WEBHOOK_SECRET }),
    }).then(r => r.json()).catch(() => null),
  ]);

  const tierOk = tierRes?.status === 'updated' || tierRes?.ok;
  const tldOk  = tldRes?.status === 'ok' || tldRes?.tld;

  if (!tierOk && !tldOk) {
    return NextResponse.json({ error: 'worker update failed', tierRes, tldRes }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    slug,
    tier,
    beacon: `${beaconLabel}.${tld}`,
    message: `${slug} upgraded to ${tier}. Re-claim at /normies-lab to activate.`,
  });
}
