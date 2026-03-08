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
 *   3. Mint beacon NFT: {prefix}.{tokenId}.nftmail.gno
 *   4. Register alias: {PREFIX}_{tokenId}_@nftmail.box → primaryName
 *   5. Record molt + upgrade tier larva→pupa if needed
 */

import {
  getCollection,
  verifyNFTOwnership,
  moltEmailLocalPart,
  moltBeaconLabel,
  type CollectionConfig,
} from './collection-registry';
import { verifyFeePayment } from './chonk-molt';

const NFTMAIL_WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CollectionMoltParams {
  collectionId: string;     // e.g. 'chonk' | 'pownft' | 'punks' | 'normies'
  primaryName: string;      // bare agent name, no _
  tokenId: string;          // NFT token ID
  ownerWallet: string;      // caller's EVM address
  paymentTxHash: string;    // Gnosis tx hash proving 2 xDAI fee
  webhookSecret: string;
  appUrl: string;
}

export interface CollectionMoltResult {
  status: 'ok';
  collection: string;
  primaryEmail: string;
  aliasEmail: string;
  beaconNft: string;
  beaconTxHash: string;
  beaconTokenId: number | null;
  displayEmail: 'alias';
  message: string;
}

export interface CollectionMoltError {
  status: 'error';
  error: string;
  step: 'collection' | 'ownership' | 'fee' | 'beacon-mint' | 'alias' | 'worker';
}

export type CollectionMoltOutcome = CollectionMoltResult | CollectionMoltError;

// ─── Mint beacon NFT via gnosis-mint API ─────────────────────────────────────

async function mintBeacon(
  collection: CollectionConfig,
  tokenId: string,
  ownerWallet: string,
  appUrl: string,
): Promise<{ success: boolean; txHash?: string; tokenId?: number | null; beaconNft?: string; error?: string }> {
  const label = moltBeaconLabel(collection, tokenId);
  try {
    const res = await fetch(`${appUrl}/api/gnosis-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        ownerWallet,
        legacyIdentity: label,
        privacyTier: 'private',
      }),
    });
    const data = await res.json() as any;
    if (!res.ok || !data.success) {
      return { success: false, error: data.error ?? 'Beacon mint failed' };
    }
    return {
      success: true,
      txHash: data.txHash,
      tokenId: data.tokenId ?? null,
      beaconNft: `${label}.nftmail.gno`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Beacon mint failed' };
  }
}

// ─── Register alias in worker KV ─────────────────────────────────────────────

async function registerAlias(
  collection: CollectionConfig,
  primaryName: string,
  tokenId: string,
  ownerWallet: string,
): Promise<{ success: boolean; aliasEmail: string; error?: string }> {
  const aliasLocalPart = moltEmailLocalPart(collection, tokenId);
  const aliasEmail = `${aliasLocalPart}@nftmail.box`;
  try {
    const res = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createAlias',
        primaryName,
        aliasLocalPart,
        collectionName: collection.id,
        tokenId,
        ownerAddress: ownerWallet.toLowerCase(),
        displayEmail: 'alias',
      }),
    });
    const data = await res.json() as any;
    if (!res.ok) {
      return { success: false, aliasEmail, error: data.error ?? 'Alias registration failed' };
    }
    return { success: true, aliasEmail };
  } catch (err: any) {
    return { success: false, aliasEmail, error: err?.message ?? 'Alias registration failed' };
  }
}

// ─── Record molt + upgrade tier ──────────────────────────────────────────────

async function recordMolt(
  collection: CollectionConfig,
  primaryName: string,
  tokenId: string,
  ownerWallet: string,
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
  const { collectionId, primaryName, tokenId, ownerWallet, paymentTxHash, webhookSecret, appUrl } = params;

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

  // 3. Mint beacon NFT
  const beacon = await mintBeacon(collection, tokenId, ownerWallet, appUrl);
  if (!beacon.success) {
    return { status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' };
  }

  // 4. Register alias
  const alias = await registerAlias(collection, primaryName, tokenId, ownerWallet);
  if (!alias.success) {
    return { status: 'error', step: 'alias', error: alias.error ?? 'Alias registration failed' };
  }

  // 5. Record molt + upgrade tier (non-fatal)
  await recordMolt(collection, primaryName, tokenId, ownerWallet, beacon.beaconNft!, beacon.txHash!, webhookSecret);

  const aliasLocalPart2 = moltEmailLocalPart(collection, tokenId);
  return {
    status: 'ok',
    collection: collection.name,
    primaryEmail: `${primaryName}_@nftmail.box`,
    aliasEmail: `${aliasLocalPart2}@nftmail.box`,
    beaconNft: beacon.beaconNft!,
    beaconTxHash: beacon.txHash!,
    beaconTokenId: beacon.tokenId ?? null,
    displayEmail: 'alias',
    message: `${collection.name} Molt Complete: Now ${aliasLocalPart2}@nftmail.box`,
  };
}
