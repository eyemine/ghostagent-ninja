import { getIPType } from '../constants/ip-types';
import { WORKER_URL } from '../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

export interface IPMintResult {
  ipAsset: {
    fullDomain: string;
    ipAccount?: string;
    tokenId?: string;
    txHash?: string;
    nftAddress?: string;
  } | null;
  ipType: string;
  error?: string;
}

// ─── Glass Box Audit — logged to worker KV ───────────────────────────────────

async function logAudit(domain: string, result: IPMintResult, webhookSecret: string): Promise<void> {
  try {
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'appendAuditLog',
        secret: webhookSecret,
        key: `ip-audit:${domain.split('.')[0]}`,
        entry: {
          timestamp: Date.now(),
          domain,
          ipType: result.ipType,
          fullDomain: result.ipAsset?.fullDomain,
          txHash: result.ipAsset?.txHash,
          success: !result.error,
          error: result.error,
        },
      }),
    });
  } catch {
    // Non-fatal
  }
}

// ─── Main export — matches user's interface ───────────────────────────────────

/**
 * Mints a Story Protocol .ip asset on Basic→Lite evolution.
 *
 * @param domain     Full GNS domain, e.g. 'agent.gno' | 'nftmail.gno'
 * @param safeAddress Gnosis Safe address — .ip NFT stored here, transfers on molt automatically
 * @param tbaAddress  Tokenbound account address (IP asset owner on Story L1)
 * @param agentName   Bare agent name, e.g. 'ghostagent'
 * @param webhookSecret Internal secret for KV writes
 */
export async function mintIPOnLITE(
  domain: string,
  safeAddress: string,
  tbaAddress: string,
  agentName: string,
  webhookSecret: string,
): Promise<IPMintResult> {
  const ipType = getIPType(domain);              // 'creation.ip' | 'moltbook.ip'
  const ipName = `${agentName}.${ipType}`;       // e.g. 'ghostagent.creation.ip'

  try {
    // Register on Story Protocol via treasury-funded gasless relay
    const res = await fetch(`${APP_URL}/api/gasless-ip-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName,
        tbaAddress,
        ownerWallet: safeAddress,
        ipType,
        fullDomain: ipName,
        tld: domain,
      }),
    });

    const data = await res.json() as {
      fullDomain?: string;
      ipAccount?: string;
      tokenId?: string;
      txHash?: string;
      nftAddress?: string;
      error?: string;
    };

    if (!res.ok || data.error) {
      const result: IPMintResult = { ipAsset: null, ipType, error: data.error ?? `gasless-ip-mint ${res.status}` };
      await logAudit(domain, result, webhookSecret);
      return result;
    }

    // Store .ip NFT reference in Safe's acct-tier KV (transfers automatically on molt)
    await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upgradeTier',
        secret: webhookSecret,
        label: agentName,
        newTier: 'lite',
        safe: safeAddress,
        storyIp: agentName,
        retention: '30-day',
      }),
    });

    const result: IPMintResult = {
      ipAsset: {
        fullDomain:  data.fullDomain  ?? ipName,
        ipAccount:   data.ipAccount,
        tokenId:     data.tokenId,
        txHash:      data.txHash,
        nftAddress:  data.nftAddress,
      },
      ipType,
    };

    // Glass Box Audit log
    await logAudit(domain, result, webhookSecret);

    return result;

  } catch (err: any) {
    const result: IPMintResult = { ipAsset: null, ipType, error: err?.message ?? 'IP mint failed' };
    await logAudit(domain, result, webhookSecret);
    return result;
  }
}

// ─── Legacy alias used by evolve route ───────────────────────────────────────

export type { IPMintResult as IPMintLegacyResult };
export const mintIPAsset = async (params: {
  agentName: string; tld: string; tbaAddress: string;
  ownerWallet: string; safeAddress?: string;
  fromLevel: string; toLevel: string; webhookSecret: string;
}): Promise<{ success: boolean; ipType: string; fullDomain?: string; ipAccount?: string; tokenId?: string; txHash?: string; error?: string; skipped?: boolean }> => {
  if (params.fromLevel !== 'basic' || params.toLevel !== 'lite') {
    return { success: true, skipped: true, ipType: getIPType(params.tld) };
  }
  const r = await mintIPOnLITE(params.tld, params.safeAddress ?? params.ownerWallet, params.tbaAddress, params.agentName, params.webhookSecret);
  return {
    success: !r.error,
    ipType: r.ipType,
    fullDomain: r.ipAsset?.fullDomain,
    ipAccount:  r.ipAsset?.ipAccount,
    tokenId:    r.ipAsset?.tokenId,
    txHash:     r.ipAsset?.txHash,
    error:      r.error,
  };
};
