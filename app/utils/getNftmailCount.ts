/// Utility function to get total registered nftmail.box accounts from on-chain registrars
/// Uses viem to query the BaseRegistrar contracts on Gnosis using nextTokenId()
/// Registrars: molt.gno, nftmail.gno, openclaw.gno, picoclaw.gno, vault.gno, agent.gno

import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

// nftmail BaseRegistrar contracts on Gnosis mainnet (chain 100)
const NFTMAIL_REGISTRARS = {
  molt_gno: '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50' as `0x${string}`,
  nftmail_gno: '0x46c37365572C9994812AAA41fD04eB56D05469D0' as `0x${string}`,
  openclaw_gno: '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe' as `0x${string}`,
  picoclaw_gno: '0xe5fd65562698f46ea9762bd38141535b1fd875b5' as `0x${string}`,
  vault_gno: '0xc6b184a38da64d1d535674dafb9ce2440058ec4e' as `0x${string}`,
  agent_gno: '0x608071875bcc0ef0b934f8a2367672d8c472cacf' as `0x${string}`,
} as const;

// BaseRegistrar uses nextTokenId() — token count = nextTokenId - 1 (tokens start at 1)
const REGISTRAR_ABI = [
  {
    inputs: [],
    name: 'nextTokenId',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
] as const;

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
});

export interface NftmailStats {
  totalAccounts: bigint;
  formattedTotal: string;
  breakdown: {
    molt_gno: string;
    nftmail_gno: string;
    openclaw_gno: string;
    picoclaw_gno: string;
    vault_gno: string;
    agent_gno: string;
  };
  lastUpdated: Date;
  chainId: number;
}

/**
 * Get token count from a BaseRegistrar by calling nextTokenId().
 * Tokens start at 1, so count = nextTokenId - 1.
 */
async function getRegistrarCount(address: `0x${string}`): Promise<bigint> {
  try {
    const nextId = await publicClient.readContract({
      address,
      abi: REGISTRAR_ABI,
      functionName: 'nextTokenId',
    });
    return nextId > 0n ? nextId - 1n : 0n;
  } catch (err) {
    console.error(`Failed to read nextTokenId from ${address}:`, err);
    return 0n;
  }
}

/**
 * Get the total number of registered nftmail.box accounts from all registrar contracts
 * Queries: molt.gno, nftmail.gno, openclaw.gno, picoclaw.gno, vault.gno, agent.gno
 */
export async function getNftmailCount(): Promise<NftmailStats> {
  try {
    console.log('Fetching nftmail registrar counts from contracts');

    const [moltCount, nftmailCount, openclawCount, picoclawCount, vaultCount, agentCount] = await Promise.all([
      getRegistrarCount(NFTMAIL_REGISTRARS.molt_gno),
      getRegistrarCount(NFTMAIL_REGISTRARS.nftmail_gno),
      getRegistrarCount(NFTMAIL_REGISTRARS.openclaw_gno),
      getRegistrarCount(NFTMAIL_REGISTRARS.picoclaw_gno),
      getRegistrarCount(NFTMAIL_REGISTRARS.vault_gno),
      getRegistrarCount(NFTMAIL_REGISTRARS.agent_gno),
    ]);

    const totalAccounts = moltCount + nftmailCount + openclawCount + picoclawCount + vaultCount + agentCount;

    console.log('Nftmail count results:', {
      molt_gno: moltCount.toString(),
      nftmail_gno: nftmailCount.toString(),
      openclaw_gno: openclawCount.toString(),
      picoclaw_gno: picoclawCount.toString(),
      vault_gno: vaultCount.toString(),
      agent_gno: agentCount.toString(),
      total: totalAccounts.toString(),
    });

    return {
      totalAccounts,
      formattedTotal: totalAccounts.toString(),
      breakdown: {
        molt_gno: moltCount.toString(),
        nftmail_gno: nftmailCount.toString(),
        openclaw_gno: openclawCount.toString(),
        picoclaw_gno: picoclawCount.toString(),
        vault_gno: vaultCount.toString(),
        agent_gno: agentCount.toString(),
      },
      lastUpdated: new Date(),
      chainId: gnosis.id,
    };
  } catch (error) {
    console.error('Failed to fetch nftmail count:', error);
    return {
      totalAccounts: 0n,
      formattedTotal: '0',
      breakdown: {
        molt_gno: '0',
        nftmail_gno: '0',
        openclaw_gno: '0',
        picoclaw_gno: '0',
        vault_gno: '0',
        agent_gno: '0',
      },
      lastUpdated: new Date(),
      chainId: gnosis.id,
    };
  }
}

/**
 * Get formatted count with caching (5 minutes)
 * Reduces on-chain calls for performance
 */
let cachedStats: NftmailStats | null = null;
let cacheExpiry: number = 0;

export async function getCachedNftmailCount(): Promise<NftmailStats> {
  const now = Date.now();
  
  if (cachedStats && now < cacheExpiry) {
    return cachedStats;
  }

  const stats = await getNftmailCount();
  cachedStats = stats;
  cacheExpiry = now + (5 * 60 * 1000); // 5 minutes
  
  return stats;
}
