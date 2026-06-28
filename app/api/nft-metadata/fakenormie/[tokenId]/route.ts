/**
 * GET /api/nft-metadata/fakenormie/[tokenId]
 *
 * ERC-721 tokenURI metadata endpoint for FakeNormies NFT.
 * Contract: 0x1d6b9e2af40322d2311ff0df66dade4490ac4c29 (Gnosis chain 100)
 *
 * After calling setBaseURI("https://ghostagent.ninja/api/nft-metadata/fakenormie/"):
 *   tokenURI(0) → https://ghostagent.ninja/api/nft-metadata/fakenormie/0
 *
 * Returns OpenSea-compatible ERC-721 metadata JSON with SVG image inline.
 * SVG source: ipfs://bafybeibn726tei6kue2ixjqfyeiefjnlvd5wm3cc6r76qqwixebvqlfaga/{padded}.svg
 * Served via /public/FakeNormies/SVGS/ for reliability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

const IPFS_SVG_BASE = 'ipfs://bafybeibn726tei6kue2ixjqfyeiefjnlvd5wm3cc6r76qqwixebvqlfaga';

let _manifest: ManifestToken[] | null = null;

interface ManifestToken {
  tokenId: number;
  svgFilename: string;
  name: string;
  adjective: string;
  type: string;
  slug: string;
  ghostAgent?: {
    tier?: string;
    email?: string;
    gnoIdentity?: string;
  };
}

function getManifest(): ManifestToken[] {
  if (_manifest) return _manifest;
  try {
    const raw = readFileSync(join(process.cwd(), 'public/FakeNormies/manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { tokens: ManifestToken[] };
    _manifest = parsed.tokens;
    return _manifest;
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId: tokenIdParam } = await params;
  const tokenId = parseInt(tokenIdParam ?? '', 10);

  if (isNaN(tokenId) || tokenId < 0 || tokenId > 9999) {
    return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
  }

  const manifest = getManifest();
  const token = manifest.find(t => t.tokenId === tokenId) ?? null;

  if (!token) {
    return NextResponse.json({ error: `Token ${tokenId} not found in manifest` }, { status: 404 });
  }

  const padded = String(tokenId).padStart(2, '0');
  const svgFilename = token.svgFilename ?? `${padded}.svg`;

  const imageUrl = `${APP_URL}/FakeNormies/SVGS/${svgFilename}`;
  const ipfsImage = `${IPFS_SVG_BASE}/${svgFilename}`;
  const externalUrl = `${APP_URL}/agent/${token.slug}`;

  const attributes = [
    { trait_type: 'Type',       value: token.type },
    { trait_type: 'Adjective',  value: token.adjective },
    { trait_type: 'Slug',       value: token.slug },
    { trait_type: 'Chain',      value: 'Gnosis' },
    { trait_type: 'Token ID',   value: String(tokenId) },
  ];

  if (token.ghostAgent?.tier) {
    attributes.push({ trait_type: 'Agent Tier', value: token.ghostAgent.tier });
  }
  if (token.ghostAgent?.gnoIdentity) {
    attributes.push({ trait_type: 'GNO Identity', value: token.ghostAgent.gnoIdentity });
  }

  const metadata = {
    name:         token.name,
    description:  `FakeNormie #${padded} — ${token.adjective} ${token.type}. On-chain agent identity on Gnosis. Spawn an ERC-8004 agent with a Safe wallet. ${token.ghostAgent?.email ? `Email: ${token.ghostAgent.email}` : ''}`.trim(),
    image:        imageUrl,
    image_ipfs:   ipfsImage,
    external_url: externalUrl,
    attributes,
  };

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
    },
  });
}
