/// Utility function to get total registered nftmail.box accounts from on-chain registry
/// Uses viem to query the ERC-8004 Identity Registry contract on Gnosis

import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

// ERC-8004 Identity Registry contract on Gnosis mainnet (chain 100)
const IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`;

// Minimal ABI for ERC-8004 Identity Registry
const REGISTRY_ABI = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
] as const;

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
});

export interface RegistryStats {
  totalAccounts: bigint;
  formattedTotal: string;
  lastUpdated: Date;
  chainId: number;
}

/**
 * Get the total number of registered nftmail.box accounts from the on-chain registry
 * This is the single source of truth for account count
 */
export async function getRegistryCount(): Promise<RegistryStats> {
  try {
    console.log('Fetching registry count from contract:', IDENTITY_REGISTRY_ADDRESS);
    const totalAccounts = await publicClient.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalSupply',
    });

    console.log('Registry count result:', totalAccounts.toString());
    return {
      totalAccounts,
      formattedTotal: totalAccounts.toString(),
      lastUpdated: new Date(),
      chainId: gnosis.id,
    };
  } catch (error) {
    console.error('Failed to fetch registry count:', error);
    // Return fallback values on error
    return {
      totalAccounts: 0n,
      formattedTotal: '0',
      lastUpdated: new Date(),
      chainId: gnosis.id,
    };
  }
}

/**
 * Get formatted count with caching (5 minutes)
 * Reduces on-chain calls for performance
 */
let cachedStats: RegistryStats | null = null;
let cacheExpiry: number = 0;

export async function getCachedRegistryCount(): Promise<RegistryStats> {
  const now = Date.now();
  
  if (cachedStats && now < cacheExpiry) {
    return cachedStats;
  }

  const stats = await getRegistryCount();
  cachedStats = stats;
  cacheExpiry = now + (5 * 60 * 1000); // 5 minutes
  
  return stats;
}
