/// POST /api/admin/resync-byo-image
///
/// Retroactively fetch and store the origin NFT image for a BYO molt agent.
/// Secured by NFTMAIL_WEBHOOK_SECRET.
///
/// Body: { agentName, nftType, tokenId, contractAddress?, secret }
/// Returns: { status, imageUrl }

import { NextRequest, NextResponse } from 'next/server';

const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const ENS_CONTRACT = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';

const NFT_CONTRACTS: Record<string, { contract: string; alchemy: string }> = {
  chonk:  { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', alchemy: 'https://base-mainnet.g.alchemy.com/nft/v3' },
  pownft: { contract: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405', alchemy: 'https://eth-mainnet.g.alchemy.com/nft/v3' },
  normie: { contract: '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB', alchemy: 'https://base-mainnet.g.alchemy.com/nft/v3' },
};

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const body = await req.json() as {
    agentName?: string;
    nftType?: string;
    tokenId?: string;
    contractAddress?: string;
    secret?: string;
  };

  const { agentName, nftType, tokenId, contractAddress, secret } = body;

  if (secret !== webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!agentName || !nftType || !tokenId) {
    return NextResponse.json({ error: 'Missing agentName, nftType, or tokenId' }, { status: 400 });
  }

  let originImageUrl: string | null = null;

  try {
    if (nftType === 'ens') {
      const metaRes = await fetch(`https://metadata.ens.domains/mainnet/${ENS_CONTRACT}/${tokenId}`);
      if (metaRes.ok) {
        const meta = await metaRes.json() as { image?: string; image_url?: string };
        originImageUrl = meta.image ?? meta.image_url ?? null;
      }
    } else if (nftType === 'pownft') {
      // POW NFT: `image` = video, `poster` = still PNG
      const metaRes = await fetch(`https://www.pownftmetadata.com/t/${tokenId}`, { signal: AbortSignal.timeout(8000) });
      if (metaRes.ok) {
        const data = await metaRes.json() as { name?: string; image?: string; poster?: string };
        originImageUrl = data.poster ?? null;
      }
    } else {
      const alchemyKey = process.env.ALCHEMY_API_KEY ?? '';
      const nftConfig = NFT_CONTRACTS[nftType];
      const contract = nftConfig?.contract ?? contractAddress;
      const alchemyBase = nftConfig?.alchemy ?? 'https://eth-mainnet.g.alchemy.com/nft/v3';
      if (alchemyKey && contract) {
        const imgRes = await fetch(`${alchemyBase}/${alchemyKey}/getNFTMetadata?contractAddress=${contract}&tokenId=${tokenId}&refreshCache=false`);
        if (imgRes.ok) {
          const data = await imgRes.json() as { image?: { cachedUrl?: string; originalUrl?: string; pngUrl?: string; contentType?: string } };
          const isVideo = data?.image?.contentType?.startsWith('video/');
          originImageUrl = isVideo
            ? (data?.image?.pngUrl ?? null)
            : (data?.image?.cachedUrl ?? data?.image?.originalUrl ?? null);
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: `Image fetch failed: ${(err as Error).message}` }, { status: 502 });
  }

  if (!originImageUrl) {
    return NextResponse.json({ status: 'no-image', agentName, nftType, tokenId });
  }

  // Store in KV
  const kvRes = await fetch(NFTMAIL_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'kvPut',
      key: `byo-origin-image:${agentName}`,
      value: JSON.stringify({ imageUrl: originImageUrl, nftType, tokenId, storedAt: Date.now() }),
      ownerAddress: '0x0000000000000000000000000000000000000001',
      webhookSecret,
    }),
  });

  if (!kvRes.ok) {
    return NextResponse.json({ error: 'KV write failed' }, { status: 502 });
  }

  return NextResponse.json({ status: 'ok', agentName, imageUrl: originImageUrl });
}
