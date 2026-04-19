/// Utility function to get total registered nftmail.box accounts from on-chain registry
/// Uses viem to query the nftmail registrar contracts on Gnosis

import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

// nftmail.gno registrar contract on Gnosis mainnet (chain 100)
const NFTMAIL_REGISTRAR_ADDRESS = '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50' as `0x${string}`;

// Minimal ABI for nftmail registrar
const REGISTRAR_ABI = [
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
 * Get the total number of registered nftmail.box accounts from the on-chain registrar
 * This is the single source of truth for account count
 */
export async function getRegistryCount(): Promise<RegistryStats> {
  try {
    console.log('Fetching nftmail registrar count from contract:', NFTMAIL_REGISTRAR_ADDRESS);
    const totalAccounts = await publicClient.readContract({
      address: NFTMAIL_REGISTRAR_ADDRESS,
      abi: REGISTRAR_ABI,
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
