import { NextRequest, NextResponse } from 'next/server';
import { fetchNftImageOnChain } from '../../../utils/nft-image';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET ?? '';

const NFT_CONTRACTS: Record<string, { contract: string; chain: 'base' | 'mainnet' }> = {
  chonk:  { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', chain: 'base' },
  pownft: { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', chain: 'mainnet' },
  normie: { contract: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', chain: 'mainnet' },
};

// One-time admin endpoint to backfill byo-origin-image KV for existing molts.
// Uses on-chain tokenURI — no API key required.
// Usage: POST /api/admin/backfill-byo-image
// Body: { secret, entries: [{ agentName, nftType, tokenId, ownerWallet? }] }
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    secret?: string;
    entries?: Array<{ agentName: string; nftType: string; tokenId: string; ownerWallet?: string }>;
  };

  if (!body.secret || body.secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Array<{ agentName: string; status: string; imageUrl?: string; error?: string }> = [];

  for (const entry of (body.entries ?? [])) {
    const { agentName, nftType, tokenId, ownerWallet } = entry;
    try {
      const nftConfig = NFT_CONTRACTS[nftType];
      if (!nftConfig) { results.push({ agentName, status: 'skip', error: `Unknown nftType: ${nftType}` }); continue; }

      const { imageUrl } = await fetchNftImageOnChain(nftConfig.contract, tokenId, nftConfig.chain);
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
