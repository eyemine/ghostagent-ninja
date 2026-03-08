import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

export interface StealthAliasRecord {
  token: string;          // e.g. "x7r2m9"
  address: string;        // full address: "x7r2m9@nftmail.box"
  primary: string;        // primary agent local-part (without _)
  ownerAddress: string;   // wallet that created it
  label?: string;         // optional human label e.g. "Twitter signup"
  createdAt: number;
  active: boolean;
}

function generateToken(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // omit confusables
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/**
 * POST /api/stealth-alias
 * Body: { primary, ownerAddress, label? }
 * Creates a random stealth alias that forwards to primary_@nftmail.box
 */
export async function POST(req: NextRequest) {
  try {
    const { primary, ownerAddress, label } = await req.json() as {
      primary: string;
      ownerAddress: string;
      label?: string;
    };

    if (!primary || !ownerAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: primary, ownerAddress' },
        { status: 400 }
      );
    }

    const primaryName = primary.replace(/_$/, '').toLowerCase();
    const token = generateToken();
    const stealthAddress = `st.${token}@nftmail.box`;

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createStealthAlias',
        token,
        primaryName,
        ownerAddress: ownerAddress.toLowerCase(),
        label: label ?? '',
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({
      status: 'ok',
      token,
      address: stealthAddress,
      primary: `${primaryName}_@nftmail.box`,
      label: label ?? '',
      createdAt: Date.now(),
      active: true,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

/**
 * GET /api/stealth-alias?primary=alice&owner=0x...
 * Returns all stealth aliases for a primary agent
 */
export async function GET(req: NextRequest) {
  const primary = req.nextUrl.searchParams.get('primary');
  const owner = req.nextUrl.searchParams.get('owner');

  if (!primary) {
    return NextResponse.json({ error: 'Missing primary' }, { status: 400 });
  }

  try {
    const primaryName = primary.replace(/_$/, '').toLowerCase();
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listStealthAliases',
        primaryName,
        ownerAddress: owner?.toLowerCase() ?? '',
      }),
    });

    if (res.status === 404) {
      return NextResponse.json({ aliases: [] });
    }

    const data = await res.json() as { aliases?: StealthAliasRecord[]; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({ aliases: data.aliases ?? [] });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * DELETE /api/stealth-alias
 * Body: { token, ownerAddress }
 * Revokes (deactivates) a stealth alias
 */
export async function DELETE(req: NextRequest) {
  try {
    const { token, ownerAddress } = await req.json() as {
      token: string;
      ownerAddress: string;
    };

    if (!token || !ownerAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: token, ownerAddress' },
        { status: 400 }
      );
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'revokeStealthAlias',
        token,
        ownerAddress: ownerAddress.toLowerCase(),
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({ status: 'ok', token, revoked: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
