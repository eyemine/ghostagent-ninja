import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../utils/config';


export interface AliasRecord {
  primary: string;          // e.g. "paymastr_"  (agent local-part)
  alias: string;            // e.g. "CHONK_123_" (collection identity alias)
  displayEmail: 'primary' | 'alias';
  collectionName: string;   // e.g. "chonk"
  tokenId: string;          // e.g. "123"
  ownerAddress: string;
  createdAt: number;
}

/**
 * GET /api/alias?primary=paymastr
 * Returns alias record for a primary agent name (strip trailing _).
 */
export async function GET(req: NextRequest) {
  const primary = req.nextUrl.searchParams.get('primary');
  if (!primary) {
    return NextResponse.json({ error: 'Missing primary' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAlias', primaryName: primary }),
    });
    if (res.status === 404) {
      return NextResponse.json({ exists: false, primary }, { status: 200 });
    }
    const data = await res.json() as AliasRecord & { exists?: boolean };
    return NextResponse.json({ exists: true, ...data });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * POST /api/alias
 * Body: { primary, collectionName, tokenId, ownerAddress, displayEmail? }
 *
 * Creates alias:  CHONK_{tokenId}_@nftmail.box  →  primary_@nftmail.box
 * Requires NFT ownership proof (ownerAddress verified against on-chain ownerOf).
 */
export async function POST(req: NextRequest) {
  try {
    const {
      primary,
      collectionName,
      tokenId,
      ownerAddress,
      displayEmail = 'primary',
    } = await req.json() as {
      primary: string;
      collectionName: string;
      tokenId: string;
      ownerAddress: string;
      displayEmail?: 'primary' | 'alias';
    };

    if (!primary || !collectionName || !tokenId || !ownerAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: primary, collectionName, tokenId, ownerAddress' },
        { status: 400 }
      );
    }

    // Normalise: primary strips trailing _ if caller passes full local-part
    const primaryName = primary.replace(/_$/, '');
    const aliasLocalPart = `${collectionName.toUpperCase()}_${tokenId}_`;

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createAlias',
        primaryName,
        aliasLocalPart,
        collectionName: collectionName.toLowerCase(),
        tokenId,
        ownerAddress: ownerAddress.toLowerCase(),
        displayEmail,
      }),
    });

    const data = await res.json() as { status?: string; error?: string } & Partial<AliasRecord>;
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({
      status: 'ok',
      primary: `${primaryName}_@nftmail.box`,
      alias: `${aliasLocalPart}@nftmail.box`,
      displayEmail: data.displayEmail ?? displayEmail,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

/**
 * PATCH /api/alias
 * Body: { primary, displayEmail: 'primary' | 'alias' }
 *
 * Toggle which email is shown as the display address.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { primary, displayEmail } = await req.json() as {
      primary: string;
      displayEmail: 'primary' | 'alias';
    };

    if (!primary || !displayEmail) {
      return NextResponse.json(
        { error: 'Missing required fields: primary, displayEmail' },
        { status: 400 }
      );
    }

    if (!['primary', 'alias'].includes(displayEmail)) {
      return NextResponse.json(
        { error: 'displayEmail must be "primary" or "alias"' },
        { status: 400 }
      );
    }

    const primaryName = primary.replace(/_$/, '');

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setAliasDisplay',
        primaryName,
        displayEmail,
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({ status: 'ok', displayEmail });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
