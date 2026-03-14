/// API Route: Chonk NFT Molt
/// POST /api/chonk-molt
///
/// Orchestrates the full Chonk molt flow:
///   1. Verify Chonk #tokenId ownership on Base
///   2. Verify 2 xDAI fee payment on Gnosis
///   3. Mint chonk.{tokenId}.nftmail.gno beacon NFT
///   4. Register CHONK_{tokenId}_@nftmail.box alias → primaryName inbox
///   5. Record molt + upgrade tier larva→pupa
///
/// Body: { primaryName, tokenId, ownerWallet, paymentTxHash }
/// Returns: ChonkMoltResult

import { NextRequest, NextResponse } from 'next/server';
import { runChonkMolt, type ChonkMoltParams } from '../../services/chonk-molt';
import { WORKER_URL } from '../../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

export async function POST(req: NextRequest) {
  try {
    const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryPrivateKey) {
      return NextResponse.json(
        { error: 'Chonk molt not configured (missing TREASURY_PRIVATE_KEY)' },
        { status: 503 }
      );
    }

    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'Chonk molt not configured (missing NFTMAIL_WEBHOOK_SECRET)' },
        { status: 503 }
      );
    }

    const body = await req.json() as {
      primaryName?: string;
      tokenId?: string;
      ownerWallet?: string;
      paymentTxHash?: string;
    };

    const { primaryName, tokenId, ownerWallet, paymentTxHash } = body;

    if (!primaryName || typeof primaryName !== 'string') {
      return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
    }
    if (!tokenId || typeof tokenId !== 'string' || !/^\d+$/.test(tokenId)) {
      return NextResponse.json({ error: 'Missing or invalid tokenId (must be numeric string)' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }
    if (!paymentTxHash || !/^0x[a-fA-F0-9]{64}$/.test(paymentTxHash)) {
      return NextResponse.json({ error: 'Invalid paymentTxHash' }, { status: 400 });
    }

    const params: ChonkMoltParams = {
      primaryName: primaryName.toLowerCase().replace(/_$/, ''),
      tokenId,
      ownerWallet,
      paymentTxHash,
      webhookSecret,
      treasuryPrivateKey,
    };

    const result = await runChonkMolt(params, APP_URL);

    if (result.status === 'error') {
      const statusCode =
        result.step === 'ownership' ? 403 :
        result.step === 'fee'       ? 402 :
        502;
      return NextResponse.json(result, { status: statusCode });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[chonk-molt]', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal error', status: 'error', step: 'worker' },
      { status: 500 }
    );
  }
}

/// GET /api/chonk-molt?primaryName=paymastr
/// Returns existing molt record for a primary agent, if any.
export async function GET(req: NextRequest) {
  const primaryName = req.nextUrl.searchParams.get('primaryName');
  if (!primaryName) {
    return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
  }


  try {
    // Check alias record
    const aliasRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAlias', primaryName }),
    });

    if (aliasRes.status === 404) {
      return NextResponse.json({ molted: false, primaryName });
    }

    const aliasData = await aliasRes.json() as any;
    if (!aliasData.exists || aliasData.collectionName !== 'chonk') {
      return NextResponse.json({ molted: false, primaryName });
    }

    return NextResponse.json({
      molted: true,
      primaryName,
      primaryEmail: `${primaryName}_@nftmail.box`,
      aliasEmail: `${aliasData.aliasLocalPart}@nftmail.box`,
      beaconNft: `chonk.${aliasData.tokenId}.nftmail.gno`,
      tokenId: aliasData.tokenId,
      displayEmail: aliasData.displayEmail,
    });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
