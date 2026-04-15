import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET ?? '';

const NFT_CONTRACTS: Record<string, { contract: string; chain: 'base' | 'eth' }> = {
  chonk:  { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', chain: 'base' },
  pownft: { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', chain: 'eth' },
  normie: { contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', chain: 'eth' },
};

// One-time admin endpoint to backfill byo-origin-image KV for existing molts.
// Usage: POST /api/admin/backfill-byo-image
// Body: { secret, entries: [{ agentName, nftType, tokenId }] }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    secret?: string;
    entries?: Array<{ agentName: string; nftType: string; tokenId: string; ownerWallet?: string }>;
  };

  if (!body.secret || body.secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const alchemyKey = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_KEY ?? '';
  if (!alchemyKey) {
    return NextResponse.json({ error: 'ALCHEMY_API_KEY not set' }, { status: 503 });
  }

  const results: Array<{ agentName: string; status: string; imageUrl?: string; error?: string }> = [];

  for (const entry of (body.entries ?? [])) {
    const { agentName, nftType, tokenId, ownerWallet } = entry;
    try {
      const nftConfig = NFT_CONTRACTS[nftType];
      if (!nftConfig) { results.push({ agentName, status: 'skip', error: `Unknown nftType: ${nftType}` }); continue; }

      const alchemyBase = nftConfig.chain === 'base'
        ? `https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTMetadata`
        : `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTMetadata`;

      const imgRes = await fetch(`${alchemyBase}?contractAddress=${nftConfig.contract}&tokenId=${tokenId}&refreshCache=false`);
      if (!imgRes.ok) { results.push({ agentName, status: 'error', error: `Alchemy ${imgRes.status}` }); continue; }

      const data = await imgRes.json() as { image?: { cachedUrl?: string; originalUrl?: string; pngUrl?: string; contentType?: string } };
      const isVideo = data?.image?.contentType?.startsWith('video/');
      const imageUrl = isVideo
        ? (data?.image?.pngUrl ?? null)
        : (data?.image?.cachedUrl ?? data?.image?.originalUrl ?? null);

      if (!imageUrl) { results.push({ agentName, status: 'no-image' }); continue; }

      const kvRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'kvPut',
          key: `byo-origin-image:${agentName}`,
          value: JSON.stringify({ imageUrl, nftType, storedAt: Date.now() }),
          ownerAddress: (ownerWallet ?? '0x0000000000000000000000000000000000000000').toLowerCase(),
          webhookSecret: WEBHOOK_SECRET,
        }),
      });
      const kvData = await kvRes.json() as { status?: string };
      results.push({ agentName, status: kvData.status === 'ok' ? 'stored' : 'kv-error', imageUrl });
    } catch (e: unknown) {
      results.push({ agentName, status: 'exception', error: String(e) });
    }
  }

  return NextResponse.json({ results });
}
