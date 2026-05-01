/// payments.ts — xDAI on-chain payment verification for NFTMail tier upgrades
///
/// Flow:
///   1. User sends xDAI from their wallet to TREASURY_SAFE on Gnosis (chain 100)
///   2. User pastes the tx hash into the upgrade UI
///   3. Server calls verifyXDAIPayment(txHash, expectedWei)
///   4. Checks: correct recipient, sufficient value, confirmed, not already used
///   5. Burns txHash in KV to prevent double-spend

import { createPublicClient, http, parseEther, parseUnits, type Hex, type Log } from 'viem';
import { gnosis } from 'viem/chains';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

// Treasury Safe on Gnosis — receives all tier upgrade payments
export const TREASURY_SAFE = (process.env.TREASURY_SAFE_ADDRESS || '0xb7e493e3d226f8fE722CC9916fF164B793af13F4').toLowerCase();

// EURe (Monerium EUR) on Gnosis — Gnosis Pay's stablecoin. 6 decimals.
export const EURE_CONTRACT = '0xcB444e90D8198415266c6a2724b7900fb12FC56E'.toLowerCase();

// Tier prices in xDAI (18 decimals)
export const TIER_PRICES_XDAI: Record<string, bigint> = {
  lite: parseEther('10'),   // Pupa — 10 xDAI
  premium: parseEther('24'), // Imago — 24 xDAI/yr
  pro: parseEther('24'),
  ghost: parseEther('24'),
  agent: parseEther('12'),  // GhostAgent.ninja mint
};

// Tier prices in EURe (6 decimals). xDAI ≈ USD, EUR ≈ 1.08 USD → round to clean amounts.
export const TIER_PRICES_EURE: Record<string, bigint> = {
  lite: parseUnits('10', 6),    // ~10 EUR (close enough to 10 xDAI)
  premium: parseUnits('22', 6), // ~22 EUR ≈ 24 xDAI/yr
  pro: parseUnits('22', 6),
  ghost: parseUnits('22', 6),
  agent: parseUnits('11', 6),   // ~11 EUR ≈ 12 xDAI
};

export const TIER_PRICES_USD: Record<string, number> = {
  lite: 10,
  premium: 24,
  pro: 24,
  ghost: 24,
  agent: 12,
};

// ERC-20 Transfer event ABI (used for EURe payment verification)
const ERC20_TRANSFER_ABI = [{
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true,  name: 'from',  type: 'address' },
    { indexed: true,  name: 'to',    type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
}] as const;

export interface PaymentVerificationResult {
  valid: boolean;
  error?: string;
  txHash?: string;
  from?: string;
  value?: string;
  blockNumber?: number;
}

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
});

/// Check if a txHash has already been used (double-spend prevention)
async function isTxHashBurned(txHash: string): Promise<boolean> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'checkPaymentTx', txHash: txHash.toLowerCase() }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { used?: boolean };
    return data.used === true;
  } catch {
    return false;
  }
}

/// Burn a txHash in KV so it can never be reused
export async function burnTxHash(txHash: string, label: string, tier: string): Promise<void> {
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'recordPaymentTx',
        secret: WEBHOOK_SECRET,
        txHash: txHash.toLowerCase(),
        label,
        tier,
        recordedAt: Date.now(),
      }),
    });
  } catch {
    // Non-fatal — log and continue
    console.error('[burnTxHash] failed to burn txHash', txHash);
  }
}

/// Verify an xDAI payment tx on Gnosis chain
export async function verifyXDAIPayment(
  txHash: string,
  tier: string,
  minConfirmations = 2
): Promise<PaymentVerificationResult> {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { valid: false, error: 'Invalid tx hash format (must be 0x + 64 hex chars)' };
  }

  const expectedMinValue = TIER_PRICES_XDAI[tier];
  if (!expectedMinValue) {
    return { valid: false, error: `Unknown tier: ${tier}` };
  }

  // Double-spend check first (fast, no RPC needed)
  const burned = await isTxHashBurned(txHash);
  if (burned) {
    return { valid: false, error: 'This transaction has already been used to activate a tier upgrade' };
  }

  let tx: Awaited<ReturnType<typeof publicClient.getTransaction>>;
  try {
    tx = await publicClient.getTransaction({ hash: txHash as Hex });
  } catch {
    return { valid: false, error: 'Transaction not found on Gnosis chain. Check the hash and try again.' };
  }

  // Check recipient is treasury
  if (!tx.to || tx.to.toLowerCase() !== TREASURY_SAFE) {
    return {
      valid: false,
      error: `Payment must be sent to ${TREASURY_SAFE}. This tx was sent to ${tx.to?.toLowerCase() || 'unknown'}.`,
    };
  }

  // Check value >= expected
  if (tx.value < expectedMinValue) {
    const sentXdai = Number(tx.value) / 1e18;
    const expectedXdai = Number(expectedMinValue) / 1e18;
    return {
      valid: false,
      error: `Insufficient payment: sent ${sentXdai.toFixed(2)} xDAI, expected at least ${expectedXdai.toFixed(2)} xDAI`,
    };
  }

  // Check confirmations
  if (tx.blockNumber === null || tx.blockNumber === undefined) {
    return { valid: false, error: 'Transaction is still pending. Wait for it to confirm on Gnosis and try again.' };
  }

  try {
    const currentBlock = await publicClient.getBlockNumber();
    const confirmations = Number(currentBlock - tx.blockNumber);
    if (confirmations < minConfirmations) {
      return {
        valid: false,
        error: `Transaction has ${confirmations} confirmation${confirmations === 1 ? '' : 's'}. Please wait for ${minConfirmations} confirmations (~${minConfirmations * 5}s) and try again.`,
      };
    }
  } catch {
    // If block number check fails, proceed — the tx exists and block is set
  }

  return {
    valid: true,
    txHash: txHash.toLowerCase(),
    from: tx.from.toLowerCase(),
    value: (Number(tx.value) / 1e18).toFixed(4),
    blockNumber: tx.blockNumber ? Number(tx.blockNumber) : undefined,
  };
}

/// Auto-detect a recent xDAI payment from ownerWallet to treasury (no tx hash needed).
/// Uses Gnosisscan API to scan the last 100 transactions to the treasury.
export async function autoDetectXDAIPayment(
  ownerWallet: string,
  tier: string,
): Promise<PaymentVerificationResult> {
  const expectedMinValue = TIER_PRICES_XDAI[tier];
  if (!expectedMinValue) return { valid: false, error: `Unknown tier: ${tier}` };

  const apiKey = process.env.GNOSISSCAN_API_KEY || '';
  const url = `https://api.gnosisscan.io/api?module=account&action=txlist&address=${TREASURY_SAFE}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${apiKey}`;

  let txs: any[];
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const data = await res.json() as any;
    txs = Array.isArray(data.result) ? data.result : [];
  } catch {
    return { valid: false, error: 'Could not reach Gnosisscan. Try again in a moment.' };
  }

  // Look for a tx from ownerWallet to treasury within the last 15 minutes
  const cutoff = Math.floor(Date.now() / 1000) - 900;
  for (const tx of txs) {
    if (tx.from?.toLowerCase() !== ownerWallet.toLowerCase()) continue;
    if (Number(tx.timeStamp) < cutoff) continue;
    if (tx.isError === '1') continue;
    const value = BigInt(tx.value || '0');
    if (value < expectedMinValue) continue;
    // Double-spend check
    const burned = await isTxHashBurned(tx.hash);
    if (burned) continue;
    return {
      valid: true,
      txHash: tx.hash,
      from: tx.from.toLowerCase(),
      value: (Number(value) / 1e18).toFixed(4),
      blockNumber: Number(tx.blockNumber),
    };
  }
  return { valid: false, error: 'No matching payment found yet.' };
}

/// Auto-detect a recent EURe payment from ownerWallet to treasury (no tx hash needed).
export async function autoDetectEUREPayment(
  ownerWallet: string,
  tier: string,
): Promise<PaymentVerificationResult> {
  const expectedMinValue = TIER_PRICES_EURE[tier];
  if (!expectedMinValue) return { valid: false, error: `Unknown tier: ${tier}` };

  const apiKey = process.env.GNOSISSCAN_API_KEY || '';
  const url = `https://api.gnosisscan.io/api?module=account&action=tokentx&contractaddress=${EURE_CONTRACT}&address=${TREASURY_SAFE}&page=1&offset=50&sort=desc&apikey=${apiKey}`;

  let txs: any[];
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    const data = await res.json() as any;
    txs = Array.isArray(data.result) ? data.result : [];
  } catch {
    return { valid: false, error: 'Could not reach Gnosisscan. Try again in a moment.' };
  }

  const cutoff = Math.floor(Date.now() / 1000) - 900;
  for (const tx of txs) {
    if (tx.from?.toLowerCase() !== ownerWallet.toLowerCase()) continue;
    if (Number(tx.timeStamp) < cutoff) continue;
    const value = BigInt(tx.value || '0');
    if (value < expectedMinValue) continue;
    const burned = await isTxHashBurned(tx.hash);
    if (burned) continue;
    return {
      valid: true,
      txHash: tx.hash,
      from: tx.from.toLowerCase(),
      value: (Number(value) / 1e6).toFixed(2) + ' EURe',
      blockNumber: Number(tx.blockNumber),
    };
  }
  return { valid: false, error: 'No matching EURe payment found yet.' };
}

/// Verify an EURe (Gnosis Pay) ERC-20 payment tx on Gnosis chain.
/// EURe has 6 decimals. We check for a Transfer event from the EURe contract
/// where `to` == TREASURY_SAFE and `value` >= TIER_PRICES_EURE[tier].
export async function verifyEUREPayment(
  txHash: string,
  tier: string,
  minConfirmations = 2
): Promise<PaymentVerificationResult> {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { valid: false, error: 'Invalid tx hash format (must be 0x + 64 hex chars)' };
  }

  const expectedMinValue = TIER_PRICES_EURE[tier];
  if (!expectedMinValue) {
    return { valid: false, error: `Unknown tier: ${tier}` };
  }

  // Double-spend check first (fast, no RPC needed)
  const burned = await isTxHashBurned(txHash);
  if (burned) {
    return { valid: false, error: 'This transaction has already been used to activate a tier upgrade' };
  }

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    return { valid: false, error: 'Transaction not found on Gnosis chain. Check the hash and try again.' };
  }

  if (receipt.status === 'reverted') {
    return { valid: false, error: 'Transaction reverted on-chain — payment was not completed.' };
  }

  // Find a Transfer log from the EURe contract where `to` == TREASURY_SAFE
  const { decodeEventLog } = await import('viem');
  let transferFrom: string | null = null;
  let transferValue: bigint | null = null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== EURE_CONTRACT) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC20_TRANSFER_ABI,
        data: log.data,
        topics: log.topics as any,
      });
      if (
        decoded.eventName === 'Transfer' &&
        (decoded.args as any).to?.toLowerCase() === TREASURY_SAFE
      ) {
        transferFrom = (decoded.args as any).from as string;
        transferValue = (decoded.args as any).value as bigint;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!transferFrom || transferValue === null) {
    return {
      valid: false,
      error: `No EURe Transfer to treasury found in this tx. Ensure you sent EURe (Gnosis Pay) to ${TREASURY_SAFE}.`,
    };
  }

  // Check amount >= expected
  if (transferValue < expectedMinValue) {
    const sentEure = Number(transferValue) / 1e6;
    const expectedEure = Number(expectedMinValue) / 1e6;
    return {
      valid: false,
      error: `Insufficient EURe payment: sent ${sentEure.toFixed(2)} EURe, expected at least ${expectedEure.toFixed(2)} EURe`,
    };
  }

  // Check confirmations
  if (receipt.blockNumber === null || receipt.blockNumber === undefined) {
    return { valid: false, error: 'Transaction is still pending. Wait for confirmation on Gnosis and try again.' };
  }

  try {
    const currentBlock = await publicClient.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);
    if (confirmations < minConfirmations) {
      return {
        valid: false,
        error: `Transaction has ${confirmations} confirmation${confirmations === 1 ? '' : 's'}. Please wait for ${minConfirmations} (~${minConfirmations * 5}s) and try again.`,
      };
    }
  } catch {
    // Block number check failure is non-fatal
  }

  return {
    valid: true,
    txHash: txHash.toLowerCase(),
    from: transferFrom.toLowerCase(),
    value: (Number(transferValue) / 1e6).toFixed(2) + ' EURe',
    blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
  };
}
