/// API Route: Gnosis TBA deployment helper for legacy NFTs
/// POST /api/gnosis-tba
///
/// Given a legacy NFT (on any chain), computes the deterministic Gnosis-side
/// ERC-6551 TBA address and deploys it if not already deployed.
/// Treasury pays the Gnosis deployment gas.
///
/// Body: {
///   sourceChainId: number,     // chain where NFT lives (1=ETH, 8453=Base, etc.)
///   contractAddress: string,   // NFT contract on source chain
///   tokenId: string,           // token ID (as string to handle bigint)
///   claimedOwner: string,      // wallet claiming ownership (verified via eth_call)
///   salt?: string,             // optional ERC-6551 salt (default "0")
/// }
/// Returns: {
///   tbaAddress: string,
///   alreadyDeployed: boolean,
///   deployTxHash?: string,
///   verified: boolean,
/// }

import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { prepareMolt, computeGnosisTba, isTbaDeployed } from '../../services/gnosis-tba';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sourceChainId: number;
      contractAddress: string;
      tokenId: string;
      claimedOwner: string;
      salt?: string;
      deployIfNeeded?: boolean; // default true
    };

    const { sourceChainId, contractAddress, tokenId, claimedOwner, salt, deployIfNeeded = true } = body;

    if (!sourceChainId || !contractAddress || !tokenId || !claimedOwner) {
      return NextResponse.json(
        { error: 'Missing required fields: sourceChainId, contractAddress, tokenId, claimedOwner' },
        { status: 400 },
      );
    }

    const saltHex = salt
      ? (`0x${BigInt(salt).toString(16).padStart(64, '0')}` as `0x${string}`)
      : (`0x${'00'.repeat(32)}` as `0x${string}`);

    const nft = {
      sourceChainId,
      contractAddress: contractAddress as Address,
      tokenId:         BigInt(tokenId),
      salt:            saltHex,
    };

    // If just computing address (no deploy), skip ownership check and wallet
    if (!deployIfNeeded) {
      const tbaAddress  = await computeGnosisTba(nft);
      const deployed    = await isTbaDeployed(tbaAddress);
      return NextResponse.json({ tbaAddress, alreadyDeployed: deployed, verified: null });
    }

    // Deploy path — requires treasury private key
    const rawKey = process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;
    if (!rawKey) {
      return NextResponse.json({ error: 'Treasury key not configured' }, { status: 500 });
    }
    const normalizedKey = rawKey.startsWith('0x') ? rawKey as `0x${string}` : `0x${rawKey}` as `0x${string}`;
    const account       = privateKeyToAccount(normalizedKey);
    const walletClient  = createWalletClient({ chain: gnosis, transport: http(), account });

    const result = await prepareMolt({
      nft,
      claimedOwner: claimedOwner as Address,
      walletClient,
    });

    if (!result.verified) {
      return NextResponse.json({ error: result.error ?? 'Ownership verification failed' }, { status: 403 });
    }

    if (!result.tbaAddress) {
      return NextResponse.json({ error: result.error ?? 'TBA deployment failed' }, { status: 500 });
    }

    return NextResponse.json({
      tbaAddress:      result.tbaAddress,
      alreadyDeployed: !result.deployed,
      deployTxHash:    result.deployTxHash ?? null,
      verified:        true,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
