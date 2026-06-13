/// POST /api/fakenormies/claim
/// Verifies on-chain that `wallet` currently owns `tokenId`, then updates the
/// worker KV controller so the new holder sees the agent in their Dashboard.
/// Safe to call on every page load — idempotent if nothing changed.

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  type Address,
} from 'viem';
import { defineChain } from 'viem';
import fs from 'fs';
import path from 'path';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

const FAKENORMIES_ADDRESS = (
  process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT || '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29'
) as Address;

const ERC721_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

function buildTokenIdToSlug(): Record<number, string> {
  try {
    const manifestPath = path.join(process.cwd(), 'public', 'FakeNormies', 'manifest.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { slugIndex: Record<string, number> };
    const map: Record<number, string> = {};
    for (const [slug, id] of Object.entries(raw.slugIndex)) map[id] = slug;
    return map;
  } catch {
    return {};
  }
}
const tokenIdToSlug = buildTokenIdToSlug();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { wallet?: string; tokenId?: number };

    const wallet = body.wallet?.trim().toLowerCase();
    const tokenId = typeof body.tokenId === 'number' ? body.tokenId : null;

    if (!wallet || !/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }
    if (tokenId === null || tokenId < 0) {
      return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
    }

    const publicClient = createPublicClient({ chain: gnosis, transport: http() });

    // Verify on-chain: wallet must currently own tokenId
    const onChainOwner = await publicClient.readContract({
      address: FAKENORMIES_ADDRESS,
      abi: ERC721_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });

    if (onChainOwner.toLowerCase() !== wallet) {
      return NextResponse.json(
        { error: `Wallet does not own token #${tokenId} (owner: ${onChainOwner})` },
        { status: 403 },
      );
    }

    const slug = tokenIdToSlug[tokenId] ?? `token${tokenId}`;
    const humanEmail = `${slug}@nftmail.box`;
    const agentEmail = `${slug}_@nftmail.box`;

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (!webhookSecret) {
      return NextResponse.json({ error: 'Worker secret not configured' }, { status: 503 });
    }

    // Update nftmailgno:{slug} controller
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setAgentRecord',
        secret: webhookSecret,
        agentName: slug,
        controller: wallet,
        originNft: `${slug}.fakenormie`,
        mintedTokenId: tokenId,
        registrar: FAKENORMIES_ADDRESS,
      }),
    });

    // Update profile:{slug} owner
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setAgentProfile',
        secret: webhookSecret,
        name: slug,
        profile: {
          email: humanEmail,
          agentEmail,
          tokenId,
          contractAddress: FAKENORMIES_ADDRESS,
          chain: 'gnosis',
          owner: wallet,
          tier: 'basic',
          claimedAt: new Date().toISOString(),
        },
      }),
    });

    // Ensure tld: key present so agent appears in listAgents
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setTld',
        secret: webhookSecret,
        agentName: slug,
        tld: 'fakenormie',
      }),
    });

    return NextResponse.json({ success: true, slug, humanEmail, agentEmail });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Claim failed';
    console.error('[fakenormies/claim]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
