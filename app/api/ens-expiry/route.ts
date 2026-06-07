/**
 * GET /api/ens-expiry?label=vitalik
 *
 * Returns ENS expiry info for a bare label (no .eth suffix).
 * Returns 204 if the name has no ENS registration (not a .eth name).
 * Used by agent profile pages to show a warning banner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEnsExpiry } from '../../utils/ens-expiry';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const label = req.nextUrl.searchParams.get('label')?.toLowerCase().trim() ?? '';
  if (!label || label.includes('.') || label.includes('-')) {
    return new NextResponse(null, { status: 204 });
  }

  const info = await getEnsExpiry(label);
  if (!info || info.expiresAt === null) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json(info, {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}
