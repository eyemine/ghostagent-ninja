/**
 * @module chonk-molt
 * Chonk NFT molt flow — verified collection identity overlay for a GhostAgent.
 *
 * Flow:
 *   1. Verify caller owns Chonk #tokenId on Base (ownerOf on-chain)
 *   2. Derive beacon label: chonk.{tokenId}  (sovereign nftmail.gno subname)
 *   3. Mint beacon NFT: chonk.{tokenId}.nftmail.gno  → owner's wallet (treasury gas)
 *   4. Register alias in worker KV: CHONK_{tokenId}_ → primaryName
 *   5. Store chonk-molt record in worker KV: molt:{primaryName}
 *   6. Upgrade agent tier to 'pupa' (lite) if currently 'larva'
 *
 * Invariants:
 *   - Primary email (primaryName_@nftmail.box) is NEVER changed
 *   - Agent brain always reads/writes primary inbox
 *   - Alias display toggle is user-controlled (default: show Chonk identity)
 *   - Zero lock-in: deleteAlias restores original identity, no data loss
 *   - Fee: 2 xDAI (collected on-chain before calling this service; txHash verified here)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const CHONK_CONTRACT = '0x07152bfde079b5319e5308C43fB1DCf86F040B84' as const;
export const CHONK_CHAIN_ID = 8453; // Base
export const CHONK_BASE_RPC = 'https://mainnet.base.org';
export const CHONK_MOLT_FEE_XDAI = 2;

// Treasury receives fee on Gnosis (same treasury wallet used for minting)
export const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3' as const;

const NFTMAIL_GNO_REGISTRAR = '0x46c37365572C9994812AAA41fD04eB56D05469D0' as const;
const NFTMAIL_WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChonkMoltParams {
  primaryName: string;       // bare agent name, no _  e.g. "paymastr"
  tokenId: string;           // Chonk token ID         e.g. "123"
  ownerWallet: string;       // caller's EVM address
  paymentTxHash: string;     // Gnosis tx hash proving 2 xDAI fee
  webhookSecret: string;     // NFTMAIL_WEBHOOK_SECRET from env
  treasuryPrivateKey: string;// TREASURY_PRIVATE_KEY from env
}

export interface ChonkMoltResult {
  status: 'ok';
  primaryEmail: string;        // paymastr_@nftmail.box  (unchanged)
  aliasEmail: string;          // CHONK_123_@nftmail.box
  beaconNft: string;           // chonk.123.nftmail.gno
  beaconTxHash: string;        // Gnosis mint tx
  beaconTokenId: number | null;
  displayEmail: 'alias';       // default: show Chonk identity
  message: string;
}

export interface ChonkMoltError {
  status: 'error';
  error: string;
  step: 'ownership' | 'fee' | 'beacon-mint' | 'alias' | 'worker';
}

export type ChonkMoltOutcome = ChonkMoltResult | ChonkMoltError;

// ─── Step 1: Verify Chonk ownership on Base ───────────────────────────────────

export async function verifyChonkOwnership(
  tokenId: string,
  claimedOwner: string,
): Promise<{ verified: boolean; actualOwner: string | null }> {
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const calldata = '0x6352211e' + tokenIdHex; // ownerOf(uint256)

    const res = await fetch(CHONK_BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: CHONK_CONTRACT, data: calldata }, 'latest'],
      }),
    });
    const data = await res.json() as { result?: string; error?: any };
    if (data.error || !data.result || data.result === '0x') {
      return { verified: false, actualOwner: null };
    }
    const actualOwner = ('0x' + data.result.slice(26)).toLowerCase();
    return {
      verified: actualOwner === claimedOwner.toLowerCase(),
      actualOwner,
    };
  } catch {
    return { verified: false, actualOwner: null };
  }
}

// ─── Step 2: Verify 2 xDAI fee payment on Gnosis ─────────────────────────────

export async function verifyFeePayment(
  txHash: string,
  fromWallet: string,
): Promise<{ verified: boolean; amountXdai: number; error?: string }> {
  try {
    const res = await fetch('https://rpc.gnosischain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }),
    });
    const data = await res.json() as { result?: any; error?: any };
    if (!data.result) return { verified: false, amountXdai: 0, error: 'Transaction not found' };

    const tx = data.result;
    const toAddr = (tx.to || '').toLowerCase();
    const fromAddr = (tx.from || '').toLowerCase();
    const valueWei = BigInt(tx.value || '0x0');
    const valueXdai = Number(valueWei) / 1e18;

    if (fromAddr !== fromWallet.toLowerCase()) {
      return { verified: false, amountXdai: valueXdai, error: 'Transaction sender does not match wallet' };
    }
    if (toAddr !== GNOSIS_TREASURY.toLowerCase()) {
      return { verified: false, amountXdai: valueXdai, error: 'Transaction recipient is not the treasury' };
    }
    if (valueXdai < CHONK_MOLT_FEE_XDAI) {
      return { verified: false, amountXdai: valueXdai, error: `Insufficient fee: ${valueXdai} xDAI < ${CHONK_MOLT_FEE_XDAI} xDAI required` };
    }

    return { verified: true, amountXdai: valueXdai };
  } catch (err: any) {
    return { verified: false, amountXdai: 0, error: err?.message ?? 'Fee verification failed' };
  }
}

// ─── Step 3: Mint beacon NFT chonk.{tokenId}.nftmail.gno ──────────────────────
// Reuses the gnosis-mint endpoint internally via server-side fetch.

export async function mintChonkBeacon(
  tokenId: string,
  ownerWallet: string,
  appUrl: string,
  webhookSecret: string,
): Promise<{
  success: boolean;
  txHash?: string;
  beaconTokenId?: number | null;
  beaconNft?: string;
  email?: string;
  error?: string;
}> {
  // Label format: chonk.{tokenId}  — dot-delimited, all lowercase digits for segment2
  const label = `chonk.${tokenId}`;

  try {
    const res = await fetch(`${appUrl}/api/gnosis-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        ownerWallet,
        legacyIdentity: `chonk.${tokenId}`,
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
      beaconTokenId: data.tokenId ?? null,
      beaconNft: `chonk.${tokenId}.nftmail.gno`,
      email: data.email,
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Beacon mint failed' };
  }
}

// ─── Step 4: Register alias in worker KV ─────────────────────────────────────

export async function registerChonkAlias(
  primaryName: string,
  tokenId: string,
  ownerWallet: string,
): Promise<{ success: boolean; aliasEmail: string; error?: string }> {
  const aliasLocalPart = `CHONK_${tokenId}_`;
  const aliasEmail = `${aliasLocalPart}@nftmail.box`;

  try {
    const res = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createAlias',
        primaryName,
        aliasLocalPart,
        collectionName: 'chonk',
        tokenId,
        ownerAddress: ownerWallet.toLowerCase(),
        displayEmail: 'alias', // Default: show Chonk identity publicly
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

// ─── Step 5: Store molt record + upgrade tier if larva ──────────────────────

export async function recordChonkMolt(
  primaryName: string,
  tokenId: string,
  ownerWallet: string,
  beaconNft: string,
  beaconTxHash: string,
  webhookSecret: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Store molt record in worker KV
    await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setMoltRecord',
        secret: webhookSecret,
        primaryName,
        moltType: 'chonk',
        collectionName: 'chonk',
        tokenId,
        ownerAddress: ownerWallet.toLowerCase(),
        beaconNft,
        beaconTxHash,
        moltedAt: Date.now(),
      }),
    });

    // Upgrade tier from larva → pupa (lite) if not already higher
    // Non-fatal: tier check is best-effort
    await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upgradeTierIfBelow',
        secret: webhookSecret,
        label: primaryName,
        minTier: 'lite',
        retention: '30-day',
      }),
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Molt record failed' };
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runChonkMolt(
  params: ChonkMoltParams,
  appUrl: string,
): Promise<ChonkMoltOutcome> {
  const { primaryName, tokenId, ownerWallet, paymentTxHash, webhookSecret, treasuryPrivateKey } = params;

  // Step 1 — Verify Chonk NFT ownership on Base
  const ownership = await verifyChonkOwnership(tokenId, ownerWallet);
  if (!ownership.verified) {
    return {
      status: 'error',
      step: 'ownership',
      error: ownership.actualOwner
        ? `Wallet ${ownerWallet} does not own Chonk #${tokenId} — owner is ${ownership.actualOwner}`
        : `Chonk #${tokenId} not found on Base`,
    };
  }

  // Step 2 — Verify fee payment
  const fee = await verifyFeePayment(paymentTxHash, ownerWallet);
  if (!fee.verified) {
    return { status: 'error', step: 'fee', error: fee.error ?? 'Fee verification failed' };
  }

  // Step 3 — Mint beacon NFT chonk.{tokenId}.nftmail.gno
  const beacon = await mintChonkBeacon(tokenId, ownerWallet, appUrl, webhookSecret);
  if (!beacon.success) {
    return { status: 'error', step: 'beacon-mint', error: beacon.error ?? 'Beacon mint failed' };
  }

  // Step 4 — Register alias CHONK_{tokenId}_ → primaryName
  const alias = await registerChonkAlias(primaryName, tokenId, ownerWallet);
  if (!alias.success) {
    return { status: 'error', step: 'alias', error: alias.error ?? 'Alias registration failed' };
  }

  // Step 5 — Record molt + upgrade tier (non-fatal)
  await recordChonkMolt(
    primaryName,
    tokenId,
    ownerWallet,
    beacon.beaconNft!,
    beacon.txHash!,
    webhookSecret,
  );

  return {
    status: 'ok',
    primaryEmail: `${primaryName}_@nftmail.box`,
    aliasEmail: `CHONK_${tokenId}_@nftmail.box`,
    beaconNft: beacon.beaconNft!,
    beaconTxHash: beacon.txHash!,
    beaconTokenId: beacon.beaconTokenId ?? null,
    displayEmail: 'alias',
    message: `Chonk Molt Complete: Now CHONK_${tokenId}`,
  };
}
