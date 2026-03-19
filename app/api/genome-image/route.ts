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

const VALID_SLD_KEYS = Object.keys(SLD_VISUAL) as SldKey[];

// Module-level cache: CID → base64 data URI.
// Shared across requests within the same serverless function instance,
// preventing repeated Lighthouse fetches for the same SLD background image.
const IMAGE_CACHE = new Map<string, string>();

async function fetchImageDataUri(cid: string): Promise<string | undefined> {
  if (IMAGE_CACHE.has(cid)) return IMAGE_CACHE.get(cid);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const imgRes = await fetch(`${IPFS_GATEWAY}/${cid}`, {
      headers: { 'User-Agent': 'ghostagent-nft-compositor/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (imgRes.ok) {
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
      const buf = await imgRes.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');
      const dataUri = `data:${contentType};base64,${b64}`;
      IMAGE_CACHE.set(cid, dataUri);
      return dataUri;
    }
  } catch {
    // Non-fatal — caller falls back to gradient SVG
  }
  return undefined;
}

export async function GET(req: NextRequest) {
  const rawSld = req.nextUrl.searchParams.get('sld') ?? 'agent';
  const sld: SldKey = VALID_SLD_KEYS.includes(rawSld as SldKey) ? (rawSld as SldKey) : 'agent';
  const name = req.nextUrl.searchParams.get('name') ?? 'agent';

  const visual = SLD_VISUAL[sld];

  // Fetch (or reuse cached) base image as embedded data URI.
  const imageDataUri = await fetchImageDataUri(visual.imageCid);

  const svg = generateSubnameSvg(name, sld, imageDataUri);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      'Vary': 'Accept',
      'X-SLD': sld,
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
