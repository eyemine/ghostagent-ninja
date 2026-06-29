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
    const beaconLabel = slug.replace(/\./g, '-');

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    const webhookSecret = process.env.WEBHOOK_SECRET;
    const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

    if (!webhookSecret) {
      return NextResponse.json({ error: 'Worker secret not configured' }, { status: 503 });
    }

    // ── Read existing KV records so we do not overwrite an upgrade ─────────
    async function kvGet(key: string) {
      try {
        const r = await fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
          body: JSON.stringify({ action: 'kvGet', key }),
        });
        if (!r.ok) return null;
        const d = await r.json() as { value?: string | null };
        return d.value ?? null;
      } catch { return null; }
    }

    const [existingGnoRaw, existingTierRaw, existingTldRaw, existingTbaRaw] = await Promise.all([
      kvGet(`nftmailgno:${slug}`),
      kvGet(`acct-tier:${slug}`),
      kvGet(`tld:${slug}`),
      kvGet(`tba:${slug}`),
    ]);

    let existingGno: Record<string, unknown> = {};
    let existingTier: Record<string, unknown> = {};
    let existingTbaKv: Record<string, unknown> = {};
    try { if (existingGnoRaw) existingGno = JSON.parse(existingGnoRaw); } catch {}
    try { if (existingTierRaw) existingTier = JSON.parse(existingTierRaw); } catch {}
    try { if (existingTbaRaw) existingTbaKv = JSON.parse(existingTbaRaw); } catch {}
    const existingTld = existingTldRaw && existingTldRaw !== 'null' ? existingTldRaw : null;

    // Detect whether this agent has already been upgraded (BYO molt / Pro / Premium)
    const existingTierName = String(existingTier.tier || 'basic').toLowerCase();
    const hasRealBeacon = existingGno.origin_nft && !String(existingGno.origin_nft).endsWith('.fakenormie');
    const hasPaidTld    = existingTld && existingTld !== 'fakenormie' && existingTld !== 'null';
    // Tier alone is insufficient — a stale KV value (e.g. from a test upgrade script run)
    // must be corroborated by a non-fakenormie TLD or a real beacon origin NFT.
    const isUpgraded = hasPaidTld || (existingTierName !== 'basic' && !!hasRealBeacon);

    // Repair legacy wrong data: tier is upgraded but TLD/origin still point to fakenormie
    const targetTld = isUpgraded
      ? (existingTld && existingTld !== 'fakenormie' ? existingTld : 'agent.gno')
      : (existingTld ?? 'fakenormie');
    const targetOriginNft = isUpgraded
      ? (hasRealBeacon ? existingGno.origin_nft : `${beaconLabel}.agent.gno`)
      : `${slug}.fakenormie`;
    const targetTier = isUpgraded ? existingTierName : 'basic';
    const targetSafe = isUpgraded ? (existingTier.safe || existingGno.safe || null) : null;
    const targetTba = isUpgraded
      ? (existingGno.tba || existingTbaKv.tbaAddress || null)
      : null;

    // Update nftmailgno:{slug} controller + identity (preserve upgrade data)
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'setAgentRecord',
        secret: webhookSecret,
        agentName: slug,
        controller: wallet,
        originNft: targetOriginNft,
        mintedTokenId: tokenId,
        registrar: FAKENORMIES_ADDRESS,
        ...(targetTba ? { tba: targetTba } : {}),
      }),
    });

    // Also ensure the agent alias record (slug_) exists so it appears in the nftmail dashboard
    const agentAlias = `${slug}_`;
    const existingAlias = await kvGet(`nftmailgno:${agentAlias}`);
    if (!existingAlias) {
      await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
          action: 'setAgentRecord',
          secret: webhookSecret,
          agentName: agentAlias,
          controller: wallet,
          originNft: targetOriginNft,
          mintedTokenId: tokenId,
          registrar: FAKENORMIES_ADDRESS,
          ...(targetTba ? { tba: targetTba } : {}),
        }),
      });
    }

    // If upgraded, also repair the tier/safe record
    if (isUpgraded && (targetTier !== 'basic' || targetSafe)) {
      await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
        body: JSON.stringify({
          action: 'setAgentRecord',
          secret: webhookSecret,
          agentName: slug,
          tier: targetTier,
          ...(targetSafe ? { safe: targetSafe } : {}),
        }),
      });
    }

    // Update agentprofile:{slug} (agentName is the correct param, not name)
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'setAgentProfile',
        secret: webhookSecret,
        agentName: slug,
        profile: {
          email: humanEmail,
          agentEmail,
          tokenId,
          contractAddress: FAKENORMIES_ADDRESS,
          chain: 'gnosis',
          owner: wallet,
          tier: targetTier,
          claimedAt: new Date().toISOString(),
        },
      }),
    });

    // Store FakeNormies IPFS SVG image so agent-card shows correct NFT image (byo-origin-image:{slug})
    const FN_SVG_BASE = 'https://ipfs.io/ipfs/bafybeibn726tei6kue2ixjqfyeiefjnlvd5wm3cc6r76qqwixebvqlfaga';
    const svgFilename = String(tokenId).padStart(2, '0') + '.svg';
    const fnImageUrl = `${FN_SVG_BASE}/${svgFilename}`;
    fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'kvPut',
        key: `byo-origin-image:${slug}`,
        value: JSON.stringify({ imageUrl: fnImageUrl, nftType: 'fakenormie', tokenId: String(tokenId), storedAt: Date.now() }),
        ownerAddress: wallet,
        webhookSecret,
      }),
    }).catch(() => {/* non-fatal */});

    // Ensure tld: key is present and correct for listAgents
    await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'setTld',
        secret: webhookSecret,
        agentName: slug,
        tld: targetTld,
      }),
    });

    return NextResponse.json({
      success: true,
      slug,
      humanEmail,
      agentEmail,
      tier: targetTier,
      tld: targetTld,
      originNft: targetOriginNft,
      ...(targetSafe ? { safe: targetSafe } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Claim failed';
    console.error('[fakenormies/claim]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
