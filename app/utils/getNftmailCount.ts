/// Utility function to get total registered nftmail.box accounts
/// Queries the Cloudflare Worker KV (listAgents) which is the source of truth
/// On-chain registrars have ABI mismatches on deployed contracts; KV is reliable

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const TLD_LIST = ['molt.gno', 'nftmail.gno', 'openclaw.gno', 'picoclaw.gno', 'vault.gno', 'agent.gno'] as const;

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

interface WorkerAgent {
  name: string;
  tld: string | null;
}

/**
 * Get total registered nftmail.box accounts from the Worker KV via getStats.
 * getStats returns tld_breakdown + total_accounts covering all KV prefixes.
 * Agents without a TLD assignment default to nftmail.gno (BYO mints).
 */
export async function getNftmailCount(): Promise<NftmailStats> {
  try {
    console.log('Fetching nftmail agent counts from worker KV (getStats)');

    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getStats' }),
    });

    if (!response.ok) {
      throw new Error(`Worker getStats returned ${response.status}`);
    }

    const data = await response.json() as {
      total_accounts: number;
      nft_accounts: number;
      sandbox_accounts: number;
      active_inboxes: number;
      agents: string[];
      tld_breakdown: Record<string, string[]>;
    };

    const total = data.total_accounts || 0;
    const tldBreakdown = data.tld_breakdown || {};

    // Count agents per TLD from the worker's tld_breakdown
    const counts: Record<string, number> = {};
    for (const tld of TLD_LIST) counts[tld] = 0;

    let assignedCount = 0;
    for (const [tld, agents] of Object.entries(tldBreakdown)) {
      const key = tld as string;
      const count = Array.isArray(agents) ? agents.length : 0;
      if (key in counts) {
        counts[key] = count;
      }
      assignedCount += count;
    }

    // Agents without a TLD are BYO mints → count as nftmail.gno
    const unassigned = total - assignedCount;
    if (unassigned > 0) {
      counts['nftmail.gno'] += unassigned;
    }

    console.log('Nftmail count results (from getStats):', {
      molt_gno: counts['molt.gno'],
      nftmail_gno: counts['nftmail.gno'],
      openclaw_gno: counts['openclaw.gno'],
      picoclaw_gno: counts['picoclaw.gno'],
      vault_gno: counts['vault.gno'],
      agent_gno: counts['agent.gno'],
      total,
      unassigned,
    });

    return {
      totalAccounts: BigInt(total),
      formattedTotal: total.toString(),
      breakdown: {
        molt_gno: (counts['molt.gno'] || 0).toString(),
        nftmail_gno: (counts['nftmail.gno'] || 0).toString(),
        openclaw_gno: (counts['openclaw.gno'] || 0).toString(),
        picoclaw_gno: (counts['picoclaw.gno'] || 0).toString(),
        vault_gno: (counts['vault.gno'] || 0).toString(),
        agent_gno: (counts['agent.gno'] || 0).toString(),
      },
      lastUpdated: new Date(),
      chainId: 100,
    };
  } catch (error) {
    console.error('Failed to fetch nftmail count from worker:', error);
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
      chainId: 100,
    };
  }
}

/**
 * Get formatted count with caching (5 minutes)
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
