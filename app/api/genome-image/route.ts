/**
 * POST /api/genome-image
 * Accepts a multipart form upload (file, agentName, sld).
 * Pins the image to IPFS via Lighthouse.
 * Returns { cid, url } for storage in GenomeMetadata.imageUri / imageCid.
 *
 * GET /api/genome-image?sld=agent
 * Returns a placeholder SVG for the given SLD (no auth needed).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  generateSubnameSvg,
  generatePlaceholderSvg,
  SLD_VISUAL,
  type SldKey,
} from '../../services/genome-metadata';

const LIGHTHOUSE_API_KEY = process.env.LIGHTHOUSE_API_KEY;
const LIGHTHOUSE_UPLOAD = 'https://node.lighthouse.storage/api/v0/add';
const IPFS_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── GET — composited NFT image SVG ────────────────────────────────────────────
// Usage: /api/genome-image?sld=molt&name=ghostagent
// Returns an SVG with the IPFS base image + subname text overlay in top 25%.
// The base image is fetched server-side and embedded as a data URI so the SVG
// is fully self-contained (works in wallets, OpenSea, IPFS gateways).

export async function GET(req: NextRequest) {
  const sld  = (req.nextUrl.searchParams.get('sld')  ?? 'agent') as SldKey;
  const name =  req.nextUrl.searchParams.get('name') ?? 'agent';

  const visual = SLD_VISUAL[sld];

  // Fetch the base image from Lighthouse and embed as data URI
  let imageDataUri: string | undefined;
  try {
    const imgRes = await fetch(`${IPFS_GATEWAY}/${visual.imageCid}`, {
      headers: { 'User-Agent': 'ghostagent-nft-compositor/1.0' },
      // next: { revalidate: 86400 } — only valid in Next 13+ fetch, fine here
    });
    if (imgRes.ok) {
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
      const buf = await imgRes.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');
      imageDataUri = `data:${contentType};base64,${b64}`;
    }
  } catch {
    // Non-fatal — fall back to remote href in the SVG
  }

  const svg = generateSubnameSvg(name, sld, imageDataUri);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  });
}

// ── POST — upload image, pin to IPFS ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const agentName = (formData.get('agentName') as string | null) ?? 'agent';
    const sld = ((formData.get('sld') as string | null) ?? 'agent') as SldKey;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate size
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large (max 5 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 413 },
      );
    }

    // Validate MIME
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Use PNG, JPG, WebP, GIF, or SVG.` },
        { status: 415 },
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);

    // ── Pin to Lighthouse ──────────────────────────────────────────────────
    const uploadForm = new FormData();
    const blob = new Blob([uint8], { type: file.type });
    const filename = `${agentName}-${sld}-genome.${file.type.split('/')[1]}`;
    uploadForm.append('file', blob, filename);

    const headers: Record<string, string> = {};
    if (LIGHTHOUSE_API_KEY) {
      headers['Authorization'] = `Bearer ${LIGHTHOUSE_API_KEY}`;
    }

    const lhRes = await fetch(LIGHTHOUSE_UPLOAD, {
      method: 'POST',
      headers,
      body: uploadForm,
    });

    if (!lhRes.ok) {
      const errText = await lhRes.text();
      console.error('[genome-image] Lighthouse error:', errText.slice(0, 200));
      return NextResponse.json(
        { error: `IPFS pin failed (${lhRes.status}). ${errText.slice(0, 100)}` },
        { status: 502 },
      );
    }

    const lhData = await lhRes.json() as { Hash?: string; Name?: string; Size?: string };
    const cid = lhData.Hash;

    if (!cid) {
      return NextResponse.json({ error: 'Lighthouse returned no CID' }, { status: 502 });
    }

    const url = `${IPFS_GATEWAY}/${cid}`;

    return NextResponse.json({
      cid,
      url,
      gateway: IPFS_GATEWAY,
      filename,
      sizeBytes: file.size,
      pinnedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[genome-image] error:', err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
