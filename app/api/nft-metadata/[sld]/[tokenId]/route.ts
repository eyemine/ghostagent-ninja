/**
 * GET /api/nft-metadata/[sld]/[tokenId]
 *
 * ERC-721 tokenURI metadata endpoint for .gno subname NFTs.
 * Called on-chain via BaseRegistrar._baseURI() + tokenId.
 *
 * setBaseURI("https://ghostagent.ninja/api/nft-metadata/vault/")
 * → tokenURI(1) = "https://ghostagent.ninja/api/nft-metadata/vault/1"
 *
 * Returns OpenSea-compatible ERC-721 metadata JSON:
 * { name, description, image, external_url, attributes[] }
 *
 * Image: /api/genome-image?sld={sld}&name={label}  (SVG — SLD base image + label overlay)
 *
 * Label resolution: KV reverse index nft-token:{sld}:{tokenId} → { label, sld }
 * Written at mint time by worker registerSovereign handler.
 * Falls back to "token-{tokenId}" if KV lookup misses.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SLD_VISUAL, type SldKey } from '../../../../services/genome-metadata';
import { WORKER_URL } from '../../../../utils/config';

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

const VALID_SLDS: SldKey[] = ['agent', 'openclaw', 'molt', 'picoclaw', 'vault', 'nftmail'];

export async function GET(
  _req: NextRequest,
  { params }: { params: { sld: string; tokenId: string } },
) {
  const sld     = (params.sld     ?? '').toLowerCase() as SldKey;
  const tokenId = (params.tokenId ?? '').replace(/\D/g, '');

  if (!VALID_SLDS.includes(sld)) {
    return NextResponse.json({ error: `Unknown SLD: ${sld}` }, { status: 404 });
  }
  if (!tokenId) {
    return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
  }

  const visual = SLD_VISUAL[sld];

  // ── Resolve label from KV reverse index ─────────────────────────────────────
  let label: string | null = null;
  try {
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kvGet', key: `nft-token:${sld}:${tokenId}` }),
    });
    if (kvRes.ok) {
      const kvData = await kvRes.json() as { value?: string };
      if (kvData.value) {
        const parsed = JSON.parse(kvData.value) as { label?: string };
        label = parsed.label ?? null;
      }
    }
  } catch {
    // Non-fatal — fall through to default label
  }

  const resolvedLabel = label ?? `token-${tokenId}`;
  const fullName      = `${resolvedLabel}.${sld}.gno`;
  const imageUrl      = `${APP_URL}/api/genome-image?sld=${sld}&name=${encodeURIComponent(resolvedLabel)}`;
  const externalUrl   = `${APP_URL}/agent/${resolvedLabel}`;

  const metadata = {
    name:         fullName,
    description:  `${visual.label} AI Agent — sovereign on-chain identity registered on GhostAgent. ${visual.tagline}`,
    image:        imageUrl,
    external_url: externalUrl,
    attributes: [
      { trait_type: 'Namespace',  value: `${sld}.gno` },
      { trait_type: 'Agent Name', value: resolvedLabel },
      { trait_type: 'Token ID',   value: tokenId },
      { trait_type: 'Chain',      value: 'Gnosis' },
      { trait_type: 'Tier',       value: visual.label },
    ],
  };

  return NextResponse.json(metadata, {
    headers: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
    },
  });
}
