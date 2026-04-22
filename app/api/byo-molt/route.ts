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
import { fetchNftImageOnChain } from '../../utils/nft-image';
import { createSafeForByoMolt } from '../../services/create-safe';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY ?? '';
const ETH_RPC = ALCHEMY_KEY
  ? `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : 'https://ethereum.publicnode.com';

const NFT_CONTRACTS: Record<string, { contract: string; rpc: string; chain: string }> = {
  chonk:  { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', rpc: 'https://mainnet.base.org', chain: 'base' },
  ens:    { contract: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85', rpc: ETH_RPC, chain: 'mainnet' },
  pownft: { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', rpc: ETH_RPC, chain: 'mainnet' },
  normie: { contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', rpc: ETH_RPC, chain: 'mainnet' },
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
      body: JSON.stringify({ action: 'redeemCoupon', code: code.toUpperCase() }),
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
      targetTld?: string;
      buildVersion?: string;
    };

    const {
      primaryName, tokenId, ownerWallet, paymentTxHash, couponCode,
      nftType = 'chonk', contractAddress, nftName, moltTarget = 'new-agent', targetAgent, targetTld, buildVersion
    } = body as any;

    // Debug: Log targetTld to verify it's being sent
    console.log('BYO MOLT DEBUG:', { 
      primaryName, 
      targetTld, 
      couponCode: couponCode ? 'PRESENT' : 'NONE',
      buildVersion,
      timestamp: new Date().toISOString()
    });

    const type = nftType ?? 'chonk';
    const isOverlay = moltTarget === 'existing-agent' && targetAgent;
    const targetNamespace = targetTld ?? 'nftmail.gno';

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
      console.log('COUPON DEBUG:', { 
        couponCode: couponCode!.trim(), 
        targetTld, 
        targetNamespace,
        'Are they equal?': targetTld === targetNamespace 
      });
      const couponResult = await redeemCoupon(couponCode!.trim());
      console.log('COUPON RESULT:', couponResult);
      if (!couponResult.ok) {
        return NextResponse.json({ status: 'error', step: 'fee', error: couponResult.error ?? 'Coupon invalid or already used' }, { status: 402 });
      }
    } else {
      const fee = await verifyFeePayment(paymentTxHash!, ownerWallet);
      if (!fee.verified) {
        return NextResponse.json({ status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' }, { status: 402 });
      }
    }

    // ── Step 3: Mint beacon NFT ──
    // Beacon labels use hyphens (not dots) to avoid sub.sub.name interpretation
    // e.g. chonk-123.nftmail.gno, atom-1234.nftmail.gno, eyemine.nftmail.gno
    const cleanName = primaryName.toLowerCase().replace(/_$/, '');
    const beaconPrefix = type === 'pownft' ? 'atom' : type === 'normie' ? 'normie' : type === 'chonk' ? 'chonk' : 'nft';
    const displayLabel = type === 'ens' && nftName ? nftName.replace(/\.eth$/i, '').toLowerCase() : tokenId.slice(0, 20);
    const beaconLabel = type === 'ens' ? displayLabel : `${beaconPrefix}-${displayLabel}`;

    // Calculate humanLocalPart early - needed for Safe creation saltNonce
    const humanLocalPart = type === 'ens'
      ? (nftName ?? `ens.${tokenId.slice(0, 8)}`)
      : `${beaconPrefix}.${displayLabel}`;

    // Safe address for new-agent molts (will be set during beacon mint step)
    let safeAddress: string | null = null;

    let beacon: { success: boolean; beaconNft?: string; txHash?: string; beaconTokenId?: number | null; error?: string };
    if (isOverlay) {
      // Overlay: still mint beacon NFT for provenance, but to the agent's Safe
      safeAddress = ownerWallet; // fallback to owner if Safe lookup fails
      try {
        const identityRes = await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAgentIdentity', name: targetAgent }),
        });
        if (identityRes.ok) {
          const identity = await identityRes.json() as { safeAddress?: string };
          if (identity.safeAddress) safeAddress = identity.safeAddress;
        }
      } catch {
        // Safe lookup failed, mint to owner wallet instead
      }
      beacon = await mintChonkBeacon(tokenId, ownerWallet, APP_URL, webhookSecret, beaconLabel, safeAddress ?? undefined, targetNamespace);
      if (!beacon.success) {
        return NextResponse.json({ status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' }, { status: 502 });
      }
    } else {
      // New agent: create Safe first (vessel), but mint beacon to owner wallet (key)
      // BYO NFT stays in principal wallet as the "key" that controls the Safe
      const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
      if (treasuryKey) {
        const safeResult = await createSafeForByoMolt(humanLocalPart, ownerWallet, treasuryKey);
        if (safeResult.safeAddress) {
          safeAddress = safeResult.safeAddress;
          console.log(`Safe created for ${humanLocalPart}: ${safeAddress}`);

          // Register BYO NFT as governor of Safe in GhostRegistry
          try {
            const nftContract = NFT_CONTRACTS[type]?.contract ?? contractAddress;
            if (nftContract && safeAddress) {
              const ghostRegistry = '0x194f200b2C624e27a14865292d1C50cF46211565'; // GhostRegistry v2
              const { createPublicClient, createWalletClient, http, encodeFunctionData } = await import('viem');
              const { privateKeyToAccount } = await import('viem/accounts');
              const { gnosis } = await import('viem/chains');

              const account = privateKeyToAccount(treasuryKey as `0x${string}`);
              const publicClient = createPublicClient({ chain: gnosis, transport: http() });
              const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

              const registerByoData = encodeFunctionData({
                abi: [{
                  name: 'registerByoGovernor',
                  type: 'function',
                  inputs: [
                    { name: 'byoContract', type: 'address' },
                    { name: 'byoTokenId', type: 'uint256' },
                    { name: 'safe', type: 'address' },
                  ],
                  outputs: [],
                  stateMutability: 'nonpayable',
                }],
                functionName: 'registerByoGovernor',
                args: [nftContract as Address, BigInt(tokenId), safeAddress as Address],
              });

              await walletClient.writeContract({
                address: ghostRegistry as Address,
                abi: [{
                  name: 'registerByoGovernor',
                  type: 'function',
                  inputs: [
                    { name: 'byoContract', type: 'address' },
                    { name: 'byoTokenId', type: 'uint256' },
                    { name: 'safe', type: 'address' },
                  ],
                  outputs: [],
                  stateMutability: 'nonpayable',
                }],
                functionName: 'registerByoGovernor',
                args: [nftContract as Address, BigInt(tokenId), safeAddress as Address],
              });

              console.log(`BYO NFT ${nftContract}#${tokenId} registered as governor of Safe ${safeAddress}`);
            }
          } catch (err) {
            console.error('BYO governor registration failed (non-fatal):', err);
          }
        } else {
          console.error('Safe creation failed (non-fatal):', safeResult.error);
        }
      }
      // Mint beacon to owner wallet (key stays with principal)
      beacon = await mintChonkBeacon(tokenId, ownerWallet, APP_URL, webhookSecret, beaconLabel, undefined, targetNamespace);
      if (!beacon.success) {
        return NextResponse.json({ status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' }, { status: 502 });
      }
    }

    // Track Safe address for new-agent molts (for registerSovereign and brain attachment)
    const controllerForRegister = safeAddress ?? ownerWallet;

    // ── Step 4: Register aliases (both human + agent emails) ──
    // Human HITL email: chonk.123@nftmail.box (dot separator, no underscore)
    // Agent A2A email:  chonk.123_@nftmail.box (dot separator, trailing underscore)
    // ENS: eyemine.eth@nftmail.box / eyemine.eth_@nftmail.box
    const agentLocalPart = `${humanLocalPart}_`;
    const humanEmail = `${humanLocalPart}@nftmail.box`;
    const agentEmail = `${agentLocalPart}@nftmail.box`;

    // For overlays, the primaryName is the existing agent (targetAgent)
    // For new-agent BYO molts, the primary is the dot-format NFT name (atom.158, chonk.676)
    // NOT the base cleanName (atom, chonk) which belongs to the original agent brain
    const finalPrimaryName = isOverlay ? targetAgent! : humanLocalPart;

    // For overlay molts: createAlias so the NFT identity (atom.158, atom.158_) forwards
    // into the existing target agent's inbox.
    // For new-agent molts: skip createAlias — registerSovereign (step 4b) creates two
    // standalone inbox accounts (atom.158@ and atom.158_@) owned by the EOA wallet,
    // exactly like ghostagent@ and ghostagent_@ are separate accounts.
    if (isOverlay) {
      try {
        await Promise.all([
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart: humanLocalPart,
              collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'human',
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'createAlias', primaryName: finalPrimaryName, aliasLocalPart: agentLocalPart,
              collectionName: type, tokenId, ownerAddress: ownerWallet.toLowerCase(), displayEmail: 'agent',
            }),
          }),
        ]);
      } catch {
        // Non-fatal
      }
    }

    // ── Step 5: Set TLD in KV for dashboard listing ──
    // BYO NFT molts need tld:* KV entry to appear in dashboard "My Agents"
    try {
      await fetch(NFTMAIL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setTld',
          agentName: finalPrimaryName,
          tld: targetNamespace,
        }),
      });
    } catch {
      // Non-fatal — dashboard listing is best-effort
    }

    // ── Step 5b: Register nftmailgno accounts so emails appear in nftmail.box dropdown ──
    // Uses registerSovereign with WEBHOOK_SECRET which bypasses the account limit.
    // For new-agent molts with Safe, use Safe address as controller.
    if (!isOverlay) {
      const controllerForRegister = safeAddress ?? ownerWallet;
      try {
        await Promise.all([
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: humanLocalPart,
              controller: controllerForRegister.toLowerCase(),
              originNft: beacon.beaconNft,
              accountTier: 'lite',
              safe: safeAddress ?? null,
            }),
          }),
          fetch(NFTMAIL_WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label: agentLocalPart,
              controller: controllerForRegister.toLowerCase(),
              originNft: beacon.beaconNft,
              accountTier: 'lite',
              safe: safeAddress ?? null,
            }),
          }),
        ]);
      } catch {
        // Non-fatal
      }
    }

    // ── Step 6: Record molt + upgrade tier ──
    await recordChonkMolt(finalPrimaryName, tokenId, ownerWallet, beacon.beaconNft!, beacon.txHash!, webhookSecret);

    // ── Step 6 (non-fatal): Fetch + store origin NFT image URL for agent card display ──
    // Stored under KV key byo-origin-image:{agentName} — read by /api/agent-card to override default genome image.
    try {
      let originImageUrl: string | null = null;
      if (type === 'ens') {
        const ENS_META_URL = `https://metadata.ens.domains/mainnet/0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/${tokenId}`;
        const imgRes = await fetch(ENS_META_URL);
        if (imgRes.ok) {
          const meta = await imgRes.json() as { image?: string; image_url?: string };
          originImageUrl = meta.image ?? meta.image_url ?? null;
        }
      } else {
        // Use on-chain tokenURI — no API key required, works from any origin
        const chain = (type === 'chonk' || type === 'normie') ? 'base' : 'mainnet';
        const nftContract = NFT_CONTRACTS[type]?.contract ?? contractAddress;
        if (nftContract) {
          const { imageUrl } = await fetchNftImageOnChain(nftContract, tokenId, chain);
          originImageUrl = imageUrl;
        }
      }
      if (originImageUrl) {
        await fetch(NFTMAIL_WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'kvPut',
            key: `byo-origin-image:${finalPrimaryName}`,
            value: JSON.stringify({ imageUrl: originImageUrl, nftType: type, storedAt: Date.now() }),
            ownerAddress: ownerWallet.toLowerCase(),
            webhookSecret,
          }),
        });
      }
    } catch {
      // Non-fatal — image storage is best-effort
    }

    return NextResponse.json({
      status: 'ok',
      primaryEmail: isOverlay ? `${finalPrimaryName}_@nftmail.box` : `${humanLocalPart}@nftmail.box`,
      humanEmail,
      agentEmail,
      aliasEmail: agentEmail,
      beaconNft: beacon.beaconNft,
      beaconTxHash: beacon.txHash,
      beaconTokenId: beacon.beaconTokenId ?? null,
      displayEmail: 'alias',
      message: `BYO NFT Molt Complete: Now ${humanLocalPart}`,
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
