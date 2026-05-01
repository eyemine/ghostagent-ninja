import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const AUDIT_WORKER = process.env.NEXT_PUBLIC_GHOSTAGENT_PROXY_URL || 'https://ghostagent-proxy.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      walletAddress?: string;
      email?: string;
      agreedAt?: number;
      termsVersion?: string;
    };

    const { walletAddress, email, agreedAt = Date.now(), termsVersion = '2026-03-01' } = body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/i.test(walletAddress)) {
      return NextResponse.json({ error: 'Invalid walletAddress' }, { status: 400 });
    }

    // Agreement hash: SHA-256 of wallet + version + timestamp (non-repudiation)
    const agreementHash = createHash('sha256')
      .update(`${walletAddress.toLowerCase()}:${termsVersion}:${agreedAt}`)
      .digest('hex');

    // Log to Glass Box Audit
    try {
      await fetch(`${AUDIT_WORKER}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WEBHOOK_SECRET}`,
        },
        body: JSON.stringify({
          action: 'terms_agreed',
          subject: `Terms v${termsVersion} agreed by ${walletAddress.slice(0, 10)}...`,
          wallet: walletAddress.toLowerCase(),
          email: email || null,
          termsVersion,
          agreedAt,
          agreementHash,
        }),
      });
    } catch {
      // Non-fatal — log locally and continue
      console.error('[record-terms] Failed to write to Glass Box Audit');
    }

    return NextResponse.json({ ok: true, agreementHash, termsVersion, agreedAt });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
