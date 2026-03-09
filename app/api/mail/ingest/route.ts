import { NextRequest, NextResponse } from 'next/server';
import { buildGlassBoxEntry } from '../../../services/glassbox-xmtp-logger';

/**
 * POST /api/mail/ingest
 * Called by the Cloudflare Email Worker after it stores the mail in KV.
 * Appends a GlassBox audit entry via the worker.
 *
 * Authenticated via x-worker-secret header.
 */

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

const WORKER_API_SECRET = process.env.WORKER_API_SECRET ?? '';

export async function POST(req: NextRequest) {
  // Authenticate worker callback
  const secret = req.headers.get('x-worker-secret');
  if (!WORKER_API_SECRET || secret !== WORKER_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      agentName: string;
      tld: string;
      from: string;
      subject?: string;
      contentHash: string;
      mailId: string;
      glassbox: boolean;
    };

    const { agentName, tld, from, subject, contentHash, mailId, glassbox } = body;

    if (!agentName || !tld || !contentHash || !mailId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const entry = buildGlassBoxEntry({
      agentName,
      tld,
      eventType: 'email-received',
      contentHash,
      xmtpEnabled: false,
      enhancedLogging: glassbox,
      from: glassbox ? from : undefined,
      subject: glassbox ? (subject ?? undefined) : undefined,
      protocol: 'email',
    });

    // Persist to worker KV via existing worker action
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendGlassBoxEntry',
        agentName,
        tld,
        ownerAddress: '0x0000000000000000000000000000000000000000',
        entry,
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) {
      console.error('GlassBox append failed:', data.error);
    }

    return NextResponse.json({ status: 'ok', entryId: entry.id, glassbox });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
