import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

const PICOCLAW_TLD = 'picoclaw.gno';

/**
 * GET /api/xmtp/toggle?name=alice&tld=openclaw.gno
 * Returns current XMTP enabled state for an agent.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  const tld  = req.nextUrl.searchParams.get('tld');
  if (!name || !tld) {
    return NextResponse.json({ error: 'Missing name or tld' }, { status: 400 });
  }
  if (tld === PICOCLAW_TLD) {
    return NextResponse.json({ enabled: false, locked: true, reason: 'PICOCLAW tier — upgrade to PUPA' });
  }
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getXMTPStatus', agentName: name, tld }),
    });
    if (res.status === 404) {
      const defaultEnabled = tld === 'agent.gno';
      return NextResponse.json({ enabled: defaultEnabled, exists: false });
    }
    const data = await res.json() as { enabled?: boolean; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json({ enabled: data.enabled ?? false });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * POST /api/xmtp/toggle
 * Body: { name, tld, enabled, walletAddress }
 * Updates XMTP enabled state. Syncs to Glass Box audit.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, tld, enabled, walletAddress } = await req.json() as {
      name: string;
      tld: string;
      enabled: boolean;
      walletAddress: string;
    };

    if (!name || !tld || typeof enabled !== 'boolean' || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: name, tld, enabled, walletAddress' },
        { status: 400 }
      );
    }

    if (tld === PICOCLAW_TLD) {
      return NextResponse.json(
        { error: 'PICOCLAW tier cannot enable XMTP — upgrade to PUPA first' },
        { status: 403 }
      );
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setXMTPStatus',
        agentName: name.toLowerCase(),
        tld,
        enabled,
        ownerAddress: walletAddress.toLowerCase(),
        auditNote: `XMTP ${enabled ? 'enabled' : 'disabled'} by owner at ${new Date().toISOString()}`,
      }),
    });

    const data = await res.json() as { status?: string; enabled?: boolean; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({ status: 'ok', enabled: data.enabled ?? enabled });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
