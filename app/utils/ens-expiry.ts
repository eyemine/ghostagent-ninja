/**
 * ENS expiry utilities — read registration expiry for .eth names via viem.
 *
 * Used by:
 *  - Agent profile pages  → warn if parent ENS domain is expiring / expired
 *  - registerSovereign guard → validate parent still owned by same wallet
 *
 * ENS BaseRegistrar on mainnet: 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85
 * tokenId = uint256(keccak256(label))  (label = the part before .eth, e.g. "vitalik")
 */

import { createPublicClient, http, keccak256, toBytes, type Address } from 'viem';
import { mainnet } from 'viem/chains';

const ETH_RPC = process.env.NEXT_PUBLIC_ETH_RPC_URL
  ?? process.env.ETH_RPC_URL
  ?? 'https://cloudflare-eth.com';

const ENS_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85' as Address;

const client = createPublicClient({
  chain: mainnet,
  transport: http(ETH_RPC, { retryCount: 2, timeout: 8_000 }),
});

// ── ENS BaseRegistrar ABI (minimal) ─────────────────────────────────────────
const REGISTRAR_ABI = [
  {
    name: 'nameExpires',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/** Derive the ENS tokenId from a label (e.g. "vitalik" from "vitalik.eth") */
function labelToTokenId(label: string): bigint {
  return BigInt(keccak256(toBytes(label.toLowerCase())));
}

export interface EnsExpiryInfo {
  label: string;          // e.g. "vitalik"
  ensName: string;        // e.g. "vitalik.eth"
  expiresAt: Date | null; // null = not registered / error
  isExpired: boolean;
  isGracePeriod: boolean; // within 90-day ENS grace window post-expiry
  daysRemaining: number | null;
  owner: string | null;   // current registrant address
}

const ENS_GRACE_PERIOD_DAYS = 90;
const WARN_THRESHOLD_DAYS = 90; // surface warning if < 90 days to expiry

/**
 * Fetch ENS expiry for a label. Non-throwing — returns null fields on error.
 * Only applies to .eth names (ENS mainnet). Returns null for non-ENS labels.
 */
export async function getEnsExpiry(label: string): Promise<EnsExpiryInfo | null> {
  if (!label || label.includes('.')) return null; // only bare labels
  const ensName = `${label}.eth`;
  const tokenId = labelToTokenId(label);

  try {
    const [expiresBigInt, owner] = await Promise.all([
      client.readContract({
        address: ENS_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: 'nameExpires',
        args: [tokenId],
      }).catch(() => 0n),
      client.readContract({
        address: ENS_REGISTRAR,
        abi: REGISTRAR_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      }).catch(() => null as Address | null),
    ]);

    if (!expiresBigInt || expiresBigInt === 0n) {
      return { label, ensName, expiresAt: null, isExpired: false, isGracePeriod: false, daysRemaining: null, owner: owner ?? null };
    }

    const expiresAt = new Date(Number(expiresBigInt) * 1000);
    const now = new Date();
    const msRemaining = expiresAt.getTime() - now.getTime();
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const isExpired = daysRemaining < 0;
    const isGracePeriod = isExpired && daysRemaining > -ENS_GRACE_PERIOD_DAYS;

    return { label, ensName, expiresAt, isExpired, isGracePeriod, daysRemaining, owner: owner ?? null };
  } catch {
    return null;
  }
}

/** True if the expiry info warrants surfacing a warning to the user */
export function shouldWarnExpiry(info: EnsExpiryInfo | null): boolean {
  if (!info || info.daysRemaining === null) return false;
  return info.daysRemaining < WARN_THRESHOLD_DAYS;
}

export { WARN_THRESHOLD_DAYS };
