/**
 * @module optional-ip-minter
 * Optional additional .ip mint during molt (user-initiated, +5 xDAI).
 *
 * Called from /api/molt when:
 *   - optionalIPMint === true in request body
 *   - FEATURES.optionalIPMint === true (server-side flag check)
 *
 * Behaviour:
 *   - Mints a second .ip asset of the targetIPType into the agent's Safe
 *   - Stores both .ip types in Safe (existing + new); both transfer on molt
 *   - Updates beacon metadata with new ip_domains[] entry
 *   - Logs to Glass Box Audit
 *   - If mint fails: molt still succeeds (non-fatal, fee already collected)
 *
 * To enable: set FEATURES.optionalIPMint = true in constants/features.ts
 */

import { mintIPOnPUPA } from './ip-minter';
import type { IPDomainEntry } from './beacon-metadata';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

export interface OptionalIPMintParams {
  agentName: string;
  tld: string;
  targetIPType: 'creation.ip' | 'moltbook.ip';
  safeAddress: string;
  tbaAddress: string;
  ownerWallet: string;
  webhookSecret: string;
}

export interface OptionalIPMintResult {
  minted: boolean;
  newEntry?: IPDomainEntry;
  error?: string;
}

/**
 * Mint an additional .ip asset of targetIPType into the agent's Safe.
 * Non-fatal — caller should proceed with molt regardless of result.
 */
export async function mintOptionalIP(
  params: OptionalIPMintParams,
): Promise<OptionalIPMintResult> {
  const { agentName, tld, targetIPType, safeAddress, tbaAddress, ownerWallet, webhookSecret } = params;

  try {
    // Override domain lookup — pass targetIPType directly to gasless-ip-mint
    const res = await fetch(`${APP_URL}/api/gasless-ip-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName,
        tbaAddress,
        ownerWallet,
        safeAddress,
        ipType: targetIPType,
        fullDomain: `${agentName}.${targetIPType}`,
        tld,
        fromLevel: 'molt-optional',
        toLevel:   'molt-optional',
      }),
    });

    const data = await res.json() as {
      fullDomain?: string;
      ipAccount?: string;
      tokenId?: string;
      txHash?: string;
      error?: string;
    };

    if (!res.ok || data.error) {
      return { minted: false, error: data.error ?? `gasless-ip-mint ${res.status}` };
    }

    const newEntry: IPDomainEntry = {
      type:      targetIPType,
      cid:       data.txHash ?? '',         // Story tx hash as provenance CID until IPFS re-pin
      minted_at: Date.now(),
      domain:    data.fullDomain ?? `${agentName}.${targetIPType}`,
      txHash:    data.txHash,
      ipAccount: data.ipAccount,
    };

    return { minted: true, newEntry };

  } catch (err: any) {
    return { minted: false, error: err?.message ?? 'Optional IP mint failed' };
  }
}
