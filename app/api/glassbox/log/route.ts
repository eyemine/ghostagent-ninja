import { NextRequest, NextResponse } from 'next/server';
import { buildGlassBoxEntry, type LogOptions } from '../../../services/glassbox-xmtp-logger';
import { WORKER_URL } from '../../../utils/config';


/**
 * GET /api/glassbox/log?name=alice&tld=openclaw.gno
 * Returns Glass Box audit entries for an agent.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  const tld  = req.nextUrl.searchParams.get('tld');
  if (!name || !tld) {
    return NextResponse.json({ error: 'Missing name or tld' }, { status: 400 });
  }
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getGlassBoxLog', agentName: name, tld }),
    });
    if (res.status === 404) return NextResponse.json({ entries: [] });
    const data = await res.json() as { entries?: unknown[]; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json({ entries: data.entries ?? [] });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * POST /api/glassbox/log
 * Body: LogOptions + walletAddress
 * Appends a new Glass Box entry, tiered by xmtpEnabled.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as LogOptions & { walletAddress: string };
    const { walletAddress, ...opts } = body;

    if (!opts.agentName || !opts.tld || !opts.eventType || !opts.contentHash) {
      return NextResponse.json(
        { error: 'Missing required fields: agentName, tld, eventType, contentHash' },
        { status: 400 }
      );
    }

    const entry = buildGlassBoxEntry({ ...opts, enhancedLogging: opts.enhancedLogging ?? false });

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendGlassBoxEntry',
        agentName: opts.agentName,
        tld: opts.tld,
        ownerAddress: walletAddress?.toLowerCase() ?? '',
        entry,
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json({ status: 'ok', entry });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

/**
 * PATCH /api/glassbox/log
 * Body: { name, tld, enhancedLogging, walletAddress }
 * Toggles enhanced logging preference for an agent.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { name, tld, enhancedLogging, walletAddress } = await req.json() as {
      name: string; tld: string; enhancedLogging: boolean; walletAddress: string;
    };

    if (!name || !tld || typeof enhancedLogging !== 'boolean' || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: name, tld, enhancedLogging, walletAddress' },
        { status: 400 }
      );
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setEnhancedLogging',
        agentName: name.toLowerCase(),
        tld,
        enhancedLogging,
        ownerAddress: walletAddress.toLowerCase(),
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json({ status: 'ok', enhancedLogging });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
