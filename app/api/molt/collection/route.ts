/// API Route: Collection NFT Molt
/// POST /api/molt/collection
///
/// Generic endpoint for all approved NFT collection molts:
///   Chonk, POWNFT, CryptoPunks, Normies
///
/// Body: { collectionId, primaryName, tokenId, ownerWallet, paymentTxHash }
/// Returns: CollectionMoltOutcome

import { NextRequest, NextResponse } from 'next/server';
import { runCollectionMolt } from '../../../services/collection-molt';
import { workerTierToLevel } from '../../../services/evolve-level';
import { WORKER_URL } from '../../../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const MOLT_PERMITTED_TIERS = new Set(['lite', 'premium', 'ghost']);

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'Collection molt not configured (missing NFTMAIL_WEBHOOK_SECRET)' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json() as {
      collectionId?: string;
      primaryName?: string;
      tokenId?: string;
      ownerWallet?: string;
      safeAddress?: string;
      paymentTxHash?: string;
    };

    const { collectionId, primaryName, tokenId, ownerWallet, safeAddress, paymentTxHash } = body;

    if (!collectionId) return NextResponse.json({ error: 'Missing collectionId' }, { status: 400 });
    if (!primaryName)  return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
    if (!ownerWallet || !/^0x[0-9a-fA-F]{40}$/.test(ownerWallet)) return NextResponse.json({ error: 'Missing or invalid ownerWallet' }, { status: 400 });
    // safeAddress is optional: if provided, TBA will be added as a Safe signer post-molt

    // Tier gate — check before any payment is requested
    try {
      const tierRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAcctTier', localPart: primaryName }),
      });
      if (tierRes.ok) {
        const tierData = await tierRes.json() as any;
        const agentLevel = workerTierToLevel(tierData?.tier ?? tierData?.raw ? JSON.parse(tierData.raw ?? '{}').tier : undefined);
        if (!MOLT_PERMITTED_TIERS.has(agentLevel)) {
          return NextResponse.json({
            error: 'Molt requires Pro tier or above — evolve your agent first. Basic tier and free picoclaw accounts cannot molt.',
            currentTier: tierData?.tier ?? 'basic',
            requiredTier: 'lite',
            upgradeUrl: '/nftmail?upgrade=1',
          }, { status: 402 });
        }
      }
    } catch {
      // Tier check non-fatal if worker unreachable — proceed, server-side molt will re-check
    }

    if (!tokenId || !/^\d+$/.test(tokenId)) return NextResponse.json({ error: 'Missing or invalid tokenId' }, { status: 400 });
    if (!paymentTxHash || !/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) return NextResponse.json({ error: 'Missing or invalid paymentTxHash' }, { status: 400 });

    const result = await runCollectionMolt({
      collectionId,
      primaryName,
      tokenId,
      ownerWallet,
      safeAddress,
      paymentTxHash,
      webhookSecret,
      appUrl: APP_URL,
    });

    if (result.status === 'error') {
      const statusCode = result.step === 'ownership' ? 403 : result.step === 'fee' ? 402 : 500;
      return NextResponse.json(result, { status: statusCode });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Collection molt failed' }, { status: 500 });
  }
}
