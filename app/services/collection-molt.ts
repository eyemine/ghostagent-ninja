/**
 * @module collection-molt
 * Generic NFT collection molt orchestrator.
 *
 * Works for any collection in the registry:
 *   Chonk, POWNFT, CryptoPunks, Normies
 *
 * Flow:
 *   1. Verify caller owns tokenId on the collection's chain
 *   2. Verify 2 xDAI fee payment on Gnosis
 *   3. Deploy Gnosis-side ERC-6551 TBA for the legacy NFT (deterministic, idempotent)
 *   4. Mint beacon NFT: {prefix}.{tokenId}.nftmail.gno — owned by the Gnosis TBA
 *   5. Record molt + upgrade tier larva→pupa if needed
 *
 * Ownership chain (transfer-safe):
 *   Legacy NFT (any chain) → Gnosis TBA → owns beacon NFT → beacon TBA → Safe signer
 *   Transfer legacy NFT → new owner controls TBA → controls Safe → inherits everything
 */

import {
  getCollection,
  verifyNFTOwnership,
  moltBeaconLabel,
  type CollectionConfig,
} from './collection-registry';
import { verifyFeePayment } from './chonk-molt';
import { prepareMolt, type LegacyNft } from './gnosis-tba';
import { createWalletClient, http, type Address } from 'viem';
import { gnosis } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const NFTMAIL_WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CollectionMoltParams {
  collectionId: string;     // e.g. 'chonk' | 'pownft' | 'punks' | 'normies'
  primaryName: string;      // bare agent name, no _
  tokenId: string;          // NFT token ID
  ownerWallet: string;      // caller's EVM address (used for fee verification only)
  safeAddress: string;      // agent's Gnosis Safe — TBA will be added as signer here
  paymentTxHash: string;    // Gnosis tx hash proving 2 xDAI fee
  webhookSecret: string;
  appUrl: string;
}

export interface CollectionMoltResult {
  status: 'ok';
  collection: string;
  tbaAddress: string;       // Gnosis TBA deployed for the legacy NFT
  beaconNft: string;
  beaconTxHash: string;
  beaconTokenId: number | null;
  safeAddress: string;      // Safe that TBA signs for
  message: string;
}

export interface CollectionMoltError {
  status: 'error';
  error: string;
  step: 'collection' | 'ownership' | 'fee' | 'tba-deploy' | 'beacon-mint' | 'worker';
}

export type CollectionMoltOutcome = CollectionMoltResult | CollectionMoltError;

// ─── Deploy Gnosis TBA for legacy NFT ────────────────────────────────────────

async function deployTba(
  collection: CollectionConfig,
  tokenId: string,
  ownerWallet: string,
): Promise<{ success: boolean; tbaAddress?: string; error?: string }> {
  const rawKey = process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;
  if (!rawKey) return { success: false, error: 'Treasury key not configured' };
  const normalizedKey = rawKey.startsWith('0x') ? rawKey as `0x${string}` : `0x${rawKey}` as `0x${string}`;
  const account      = privateKeyToAccount(normalizedKey);
  const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

  const nft: LegacyNft = {
    sourceChainId:   collection.chainId,
    contractAddress: collection.contract as Address,
    tokenId:         BigInt(tokenId),
  };

  const result = await prepareMolt({ nft, claimedOwner: ownerWallet as Address, walletClient });
  if (!result.verified) return { success: false, error: result.error };
  if (!result.tbaAddress) return { success: false, error: result.error ?? 'TBA deployment failed' };
  return { success: true, tbaAddress: result.tbaAddress };
}

// ─── Mint beacon NFT to Gnosis TBA (not EOA) ─────────────────────────────────

async function mintBeacon(
  collection: CollectionConfig,
  tokenId: string,
  tbaAddress: string,   // beacon NFT minted to the Gnosis TBA, not the user's EOA
  appUrl: string,
): Promise<{ success: boolean; txHash?: string; tokenId?: number | null; beaconNft?: string; error?: string }> {
  const label = moltBeaconLabel(collection, tokenId);
  try {
    const res = await fetch(`${appUrl}/api/gnosis-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        ownerWallet: tbaAddress,   // TBA owns the beacon NFT — transfers with legacy NFT
        legacyIdentity: label,
        privacyTier: 'private',
      }),
    });
    const data = await res.json() as unknown as Record<string, unknown>;
    if (!res.ok || !data.success) {
      return { success: false, error: (data.error as string) ?? 'Beacon mint failed' };
    }
    return {
      success: true,
      txHash: data.txHash as string,
      tokenId: (data.tokenId as number) ?? null,
      beaconNft: `${label}.nftmail.gno`,
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Beacon mint failed' };
  }
}

// ─── Record molt + upgrade tier ──────────────────────────────────────────────

async function recordMolt(
  collection: CollectionConfig,
  primaryName: string,
  tokenId: string,
  ownerWallet: string,
  tbaAddress: string,
  safeAddress: string,
  beaconNft: string,
  beaconTxHash: string,
  webhookSecret: string,
): Promise<void> {
  await Promise.allSettled([
    fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setMoltRecord',
        secret: webhookSecret,
        primaryName,
        moltType: collection.id,
        collectionName: collection.id,
        tokenId,
        ownerAddress: ownerWallet.toLowerCase(),
        tbaAddress,
        safeAddress,
        beaconNft,
        beaconTxHash,
        moltedAt: Date.now(),
      }),
    }),
    fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upgradeTierIfBelow',
        secret: webhookSecret,
        label: primaryName,
        minTier: 'lite',
        retention: '30-day',
      }),
    }),
  ]);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runCollectionMolt(
  params: CollectionMoltParams,
): Promise<CollectionMoltOutcome> {
  const { collectionId, primaryName, tokenId, ownerWallet, safeAddress, paymentTxHash, webhookSecret, appUrl } = params;

  // 0. Resolve collection from registry
  const collection = getCollection(collectionId);
  if (!collection) {
    return {
      status: 'error',
      step: 'collection',
      error: `Unknown collection "${collectionId}". Approved: chonk, pownft, punks, normies`,
    };
  }

  // 1. Verify NFT ownership on collection's chain
  const ownership = await verifyNFTOwnership(collection, tokenId, ownerWallet);
  if (!ownership.verified) {
    return {
      status: 'error',
      step: 'ownership',
      error: ownership.actualOwner
        ? `Wallet ${ownerWallet} does not own ${collection.name} #${tokenId} — owner is ${ownership.actualOwner}`
        : `${collection.name} #${tokenId} not found on chain ${collection.chainId}`,
    };
  }

  // 2. Verify 2 xDAI fee payment on Gnosis
  const fee = await verifyFeePayment(paymentTxHash, ownerWallet);
  if (!fee.verified) {
    return { status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' };
  }

  // 3. Deploy Gnosis-side ERC-6551 TBA for the legacy NFT (idempotent)
  //    Beacon NFT will be minted to this TBA — ownership chain is:
  //    legacy NFT holder (EOA) → controls TBA → owns beacon NFT → Safe signer
  const tba = await deployTba(collection, tokenId, ownerWallet);
  if (!tba.success || !tba.tbaAddress) {
    return { status: 'error', step: 'tba-deploy', error: tba.error ?? 'TBA deployment failed' };
  }

  // 4. Mint beacon NFT — owner = Gnosis TBA (not user EOA)
  const beacon = await mintBeacon(collection, tokenId, tba.tbaAddress, appUrl);
  if (!beacon.success) {
    return { status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' };
  }

  // 5. Record molt + upgrade tier (non-fatal)
  await recordMolt(
    collection, primaryName, tokenId, ownerWallet,
    tba.tbaAddress, safeAddress,
    beacon.beaconNft!, beacon.txHash!,
    webhookSecret,
  );

  return {
    status: 'ok',
    collection: collection.name,
    tbaAddress: tba.tbaAddress,
    beaconNft: beacon.beaconNft!,
    beaconTxHash: beacon.txHash!,
    beaconTokenId: beacon.tokenId ?? null,
    safeAddress,
    message: `${collection.name} Molt Complete: ${collection.name} #${tokenId} TBA is now a key to your Safe`,
  };
}
