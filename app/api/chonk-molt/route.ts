/// API Route: BYO NFT Molt
/// POST /api/chonk-molt
///
/// Orchestrates the full BYO NFT molt flow:
///   1. Verify NFT ownership on-chain (any supported type)
///   2. Verify 2 xDAI fee payment on Gnosis  OR  redeem coupon
///   3. Mint beacon NFT: {type}.{tokenId}.nftmail.gno
///   4. Register alias email → primaryName inbox
///   5. Record molt + upgrade tier larva→pupa
///
/// Body: { primaryName, tokenId, ownerWallet, paymentTxHash?, couponCode?,
///         nftType, contractAddress?, nftName? }

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyChonkOwnership,
  verifyFeePayment,
  mintChonkBeacon,
  registerChonkAlias,
  recordChonkMolt,
} from '../../services/chonk-molt';
import { WORKER_URL } from '../../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const NFT_CONTRACTS: Record<string, { contract: string; rpc: string; chain: string }> = {
  chonk:  { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', rpc: 'https://mainnet.base.org', chain: 'base' },
  ens:    { contract: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85', rpc: 'https://ethereum.publicnode.com', chain: 'mainnet' },
  pownft: { contract: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405', rpc: 'https://ethereum.publicnode.com', chain: 'mainnet' },
  normie: { contract: '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB', rpc: 'https://mainnet.base.org', chain: 'base' },
};

async function verifyGenericOwnership(
  contract: string, tokenId: string, rpc: string, claimedOwner: string,
): Promise<{ verified: boolean; actualOwner: string | null }> {
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'] }),
    });
    const data = await res.json() as { result?: string; error?: unknown };
    if (data.error || !data.result || data.result === '0x' || data.result === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return { verified: false, actualOwner: null };
    }
    const actualOwner = ('0x' + data.result.slice(26)).toLowerCase();
    return { verified: actualOwner === claimedOwner.toLowerCase(), actualOwner };
  } catch {
    return { verified: false, actualOwner: null };
  }
}

async function redeemCoupon(code: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeemCoupon', code: code.toUpperCase(), tld: 'nftmail.gno' }),
    });
    return await res.json() as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'Coupon redemption failed' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryPrivateKey) {
      return NextResponse.json({ error: 'BYO NFT molt not configured (missing TREASURY_PRIVATE_KEY)' }, { status: 503 });
    }

    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'BYO NFT molt not configured (missing NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
    }

    const body = await req.json() as {
      primaryName?: string;
      tokenId?: string;
      ownerWallet?: string;
      paymentTxHash?: string;
      couponCode?: string;
      nftType?: string;
      contractAddress?: string;
      nftName?: string;
      moltTarget?: string;
      targetAgent?: string;
    };

    const { primaryName, tokenId, ownerWallet, paymentTxHash, couponCode, nftType, contractAddress, nftName, moltTarget, targetAgent } = body;
    const type = nftType ?? 'chonk';
    const isOverlay = moltTarget === 'existing-agent' && targetAgent;

    if (!primaryName || typeof primaryName !== 'string') {
      return NextResponse.json({ error: 'Missing primaryName' }, { status: 400 });
    }
    if (!tokenId || typeof tokenId !== 'string') {
      return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }

    const hasCoupon = couponCode && couponCode.trim().length > 0;
    const hasTxHash = paymentTxHash && /^0x[a-fA-F0-9]{64}$/.test(paymentTxHash);

    if (!hasCoupon && !hasTxHash) {
      return NextResponse.json({ error: 'Either paymentTxHash or couponCode is required' }, { status: 400 });
    }

    // ── Step 1: Verify NFT ownership ──
    const nftConfig = NFT_CONTRACTS[type];
    const contract = nftConfig?.contract ?? contractAddress;
    const rpc = nftConfig?.rpc ?? 'https://ethereum.publicnode.com';
    if (!contract) {
      return NextResponse.json({ error: 'Missing contract address for NFT type' }, { status: 400 });
    }

    const ownership = await verifyGenericOwnership(contract, tokenId, rpc, ownerWallet);
    if (!ownership.verified) {
      return NextResponse.json({
        status: 'error', step: 'ownership',
        error: ownership.actualOwner
          ? `Wallet does not own ${nftName ?? `#${tokenId}`} — owner is ${ownership.actualOwner}`
          : `Token #${tokenId} not found on-chain`,
      }, { status: 403 });
    }

    // ── Step 2: Verify payment OR redeem coupon ──
    if (hasCoupon) {
      const couponResult = await redeemCoupon(couponCode!.trim());
      if (!couponResult.ok) {
        return NextResponse.json({ status: 'error', step: 'fee', error: couponResult.error ?? 'Coupon invalid or already used' }, { status: 402 });
      }
    } else {
      const fee = await verifyFeePayment(paymentTxHash!, ownerWallet);
      if (!fee.verified) {
        return NextResponse.json({ status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' }, { status: 402 });
      }
    }

    // ── Step 3: Mint beacon NFT (skip for overlay) ──
    const cleanName = primaryName.toLowerCase().replace(/_$/, '');
    const beaconPrefix = type === 'ens' ? 'ens' : type === 'pownft' ? 'atom' : type === 'normie' ? 'normie' : type === 'chonk' ? 'chonk' : 'nft';
    // For ENS, use the actual name (e.g. "vitalik") without ens. prefix
    const displayLabel = type === 'ens' && nftName ? nftName.replace(/\.eth$/i, '').toLowerCase() : tokenId.slice(0, 20);
    const beaconLabel = type === 'ens' ? displayLabel : `${beaconPrefix}.${displayLabel}`;

    let beacon: { success: boolean; beaconNft?: string; txHash?: string; beaconTokenId?: number | null; error?: string };
    if (isOverlay) {
      // Overlay: no new beacon minted, use existing agent's beacon
      beacon = { success: true, beaconNft: `${targetAgent}.nftmail.gno`, txHash: 'overlay', beaconTokenId: null };
    } else {
      // New agent: mint fresh beacon
      beacon = await mintChonkBeacon(tokenId, ownerWallet, APP_URL, webhookSecret);
      if (!beacon.success) {
        return NextResponse.json({ status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' }, { status: 502 });
      }
    }

    // ── Step 4: Register alias ──
    const aliasPrefix = type === 'ens' ? (nftName ?? `ENS_${tokenId.slice(0, 8)}`) : type === 'pownft' ? `ATOM_${tokenId}` : type === 'normie' ? `NORMIE_${tokenId}` : `CHONK_${tokenId}`;
    // For ENS, use the name directly without underscore; for others, use prefix with underscore
    const aliasLocalPart = type === 'ens' ? aliasPrefix : `${aliasPrefix}_`;
    const aliasEmail = `${aliasLocalPart}@nftmail.box`;

    // For overlays, the primaryName is the existing agent (targetAgent); for new agents, it's the NFT-derived name
    const finalPrimaryName = isOverlay ? targetAgent! : cleanName;

    try {
      await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart,
          collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'alias',
        }),
      });
    } catch {
      // Non-fatal — alias is cosmetic
    }

    // ── Step 5: Record molt + upgrade tier ──
    await recordChonkMolt(finalPrimaryName, tokenId, ownerWallet, beacon.beaconNft!, beacon.txHash!, webhookSecret);

    return NextResponse.json({
      status: 'ok',
      primaryEmail: `${finalPrimaryName}_@nftmail.box`,
      aliasEmail,
      beaconNft: beacon.beaconNft,
      beaconTxHash: beacon.txHash,
      beaconTokenId: beacon.beaconTokenId ?? null,
      displayEmail: 'alias',
      message: `BYO NFT Molt Complete: Now ${aliasPrefix}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chonk-molt]', msg);
    return NextResponse.json({ error: msg, status: 'error', step: 'worker' }, { status: 500 });
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
