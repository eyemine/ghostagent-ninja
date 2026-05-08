/**
 * GET /api/nft-preview?type=pownft&tokenId=158
 *
 * Server-side proxy for NFT metadata that doesn't send CORS headers.
 * Currently supports: pownft
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const type    = req.nextUrl.searchParams.get('type') || '';
  const tokenId = req.nextUrl.searchParams.get('tokenId')?.replace(/\D/g, '') || '';

  if (!tokenId) {
    return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
  }

  if (type === 'pownft') {
    try {
      const res = await fetch(`https://www.pownftmetadata.com/t/${tokenId}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return NextResponse.json({ name: `ATOM #${tokenId}`, imageUrl: null });
      }
      const data = await res.json() as { name?: string; image?: string; poster?: string };
      // poster is a redirect — resolve to the direct GCS URL so the browser img tag doesn't need to follow redirects
      let imageUrl: string | null = null;
      if (data.poster) {
        try {
          const posterRes = await fetch(data.poster, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
          imageUrl = posterRes.url || data.poster;
        } catch {
          imageUrl = data.poster;
        }
      } else if (data.image) {
        imageUrl = data.image;
      }
      return NextResponse.json({
        name:     data.name || `ATOM #${tokenId}`,
        imageUrl,
      }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
    } catch {
      return NextResponse.json({ name: `ATOM #${tokenId}`, imageUrl: null });
    }
  }

  return NextResponse.json({ error: `Unsupported type: ${type}` }, { status: 400 });
}
