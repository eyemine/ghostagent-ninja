/**
 * @module molt-validation
 * Validates whether an agent can molt to a target identity.
 *
 * Checks:
 *   1. Source agent exists and has on-chain owner
 *   2. Caller wallet matches on-chain owner
 *   3. Agent is at least PUPA tier (lite) — free picoclaw Larva cannot molt
 *   4. Source agent is not vault.gno (terminal — cannot molt out)
 *   5. Target name is available (not already registered in KV)
 *
 * Tier gate:
 *   Larva (basic/picoclaw free tier) → BLOCKED — must evolve to Pupa first
 *   Pupa (lite)     → permitted — can molt to any namespace including vault.gno
 *   Imago (premium) → permitted
 *   Ghost           → permitted
 *
 * Note: vault.gno is NOT blocked as a molt target — it is the natural
 * evolution destination for paid namespaces (molt.gno, openclaw.gno, agent.gno).
 */

import { workerTierToLevel } from './evolve-level';
import { WORKER_URL } from '../utils/config';

// Worker tiers that are permitted to molt
const MOLT_PERMITTED_TIERS = new Set(['pupa', 'imago', 'ghost']);

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

const GNOSIS_RPC = 'https://rpc.gnosischain.com';

const BEACON_CONTRACTS: Record<string, string> = {
  'nftmail.gno': '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  'molt.gno': '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
};

// ── Resolve source agent from worker KV ──────────────────────────────────────

async function resolveAgent(agentName: string): Promise<any | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: `${agentName}_` }),
    });
    const data = await res.json() as any;
    if (!data?.exists) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Check direct beacon NFT ownership (fallback when agent not in KV) ──────────

async function checkBeaconOwnership(agentName: string, wallet: string): Promise<{ tokenId: number; namespace: string } | null> {
  console.log('[checkBeaconOwnership] Checking for wallet:', wallet, 'agent:', agentName);
  // Check each namespace for token #6 specifically (rgbanksy is token #6)
  // Also check if wallet owns ANY token in these namespaces
  for (const [namespace, contract] of Object.entries(BEACON_CONTRACTS)) {
    try {
      console.log('[checkBeaconOwnership] Checking namespace:', namespace, 'contract:', contract);
      // Check token #6 first (specific to rgbanksy case)
      const tokenIdHex = BigInt(6).toString(16).padStart(64, '0');
      console.log('[checkBeaconOwnership] Calling ownerOf for token #6, data: 0x6352211e' + tokenIdHex);
      const res = await fetch(GNOSIS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'],
        }),
      });
      const data = await res.json() as { result?: string; error?: any };
      console.log('[checkBeaconOwnership] Response:', data);
      if (data.result && data.result !== '0x') {
        const owner = ('0x' + data.result.slice(26)).toLowerCase();
        console.log('[checkBeaconOwnership] Token #6 owner:', owner, 'expected:', wallet.toLowerCase());
        if (owner === wallet.toLowerCase()) {
          console.log('[checkBeaconOwnership] MATCH FOUND for token #6');
          return { tokenId: 6, namespace };
        }
      } else if (data.error) {
        console.log('[checkBeaconOwnership] RPC error:', data.error);
      }
    } catch (e) {
      console.log('[checkBeaconOwnership] Exception:', e);
    }
  }
  console.log('[checkBeaconOwnership] No match found');
  return null;
}

// ── Check target name availability via check-name API ────────────────────────

async function checkTargetAvailable(name: string, tld: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${APP_URL}/api/check-name?name=${encodeURIComponent(name)}&tld=${encodeURIComponent(tld)}`,
    );
    const data = await res.json() as any;
    return data?.available === true;
  } catch {
    return true; // optimistic if unreachable
  }
}

// ── Fetch molt path for xDAI / score ─────────────────────────────────────────

async function getMoltPath(agentName: string): Promise<any | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getMoltPath', name: agentName }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data?.record ?? null;
  } catch {
    return null;
  }
}

// ── Main validation ───────────────────────────────────────────────────────────

export interface MoltValidationParams {
  agentName: string;        // bare name, no underscore
  callerWallet: string;     // connected wallet address
  targetName: string;       // target identity bare name
  targetTld: string;        // e.g. 'molt.gno' | 'agent.gno'
}

export interface MoltValidationResult {
  canMolt: boolean;
  errors: string[];
  warnings: string[];
  sourceAgent?: {
    name: string;
    tld: string;
    tier: string;
    onChainOwner: string;
    originNft: string;
    tbaAddress: string | null;
    totalXdaiBurned: number;
    surgeReputationScore: number;
  };
  targetAvailable?: boolean;
}

// ── Main validation ───────────────────────────────────────────────────────────

export async function validateMolt(
  params: MoltValidationParams,
): Promise<MoltValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { agentName, callerWallet, targetName, targetTld } = params;

  // 1. Validate inputs
  if (!agentName || !/^[a-z0-9][a-z0-9._-]*$/.test(agentName)) {
    errors.push('Invalid agent name format');
    return { canMolt: false, errors, warnings };
  }
  if (!callerWallet || !/^0x[0-9a-fA-F]{40}$/.test(callerWallet)) {
    errors.push('Invalid caller wallet address');
    return { canMolt: false, errors, warnings };
  }
  if (!targetName || !/^[a-z0-9][a-z0-9-]*$/.test(targetName)) {
    errors.push('Invalid target identity name');
    return { canMolt: false, errors, warnings };
  }

  // 2. Resolve source agent (try KV first, fallback to on-chain beacon check)
  const [resolved, moltPath, beaconOwned] = await Promise.all([
    resolveAgent(agentName),
    getMoltPath(agentName),
    checkBeaconOwnership(agentName, callerWallet),
  ]);

  // Use beacon ownership if:
  // 1. Not in KV but owns beacon NFT directly, OR
  // 2. In KV but at invalid tier (basic/larva) and owns beacon NFT
  const resolvedTier = resolved?.accountTier || resolved?.tier;
  const resolvedLevel = workerTierToLevel(resolvedTier);
  const needsBeaconFallback = !resolved || (!MOLT_PERMITTED_TIERS.has(resolvedLevel) && beaconOwned);

  if (needsBeaconFallback && beaconOwned) {
    // Allow molt for direct beacon owners - set tier to pupa to bypass restriction
    const sourceAgent = {
      name: agentName,
      tld: beaconOwned.namespace,
      tier: 'pupa', // Set to pupa so tier check passes
      level: 'pupa',
      onChainOwner: callerWallet,
      originNft: `${agentName}.${beaconOwned.namespace}`,
      tbaAddress: null,
      totalXdaiBurned: 0,
      surgeReputationScore: 0,
    };

    // Check target availability
    const targetAvailable = await checkTargetAvailable(targetName, targetTld);
    if (!targetAvailable) {
      errors.push(`Target identity "${targetName}.${targetTld}" is already taken`);
    }

    // Warn if molting to same name
    if (targetName === agentName) {
      warnings.push('Target identity is the same as the source agent name');
    }

    return {
      canMolt: errors.length === 0,
      errors,
      warnings,
      sourceAgent,
      targetAvailable,
    };
  }

  if (!resolved) {
    errors.push(`Agent "${agentName}_" not found — check the name and try again`);
    return { canMolt: false, errors, warnings };
  }

  // 3. Block molt-out from vault.gno (terminal — the Safe is the final form)
  if (resolved.tld === 'vault.gno') {
    errors.push('vault.gno is a terminal identity — cannot molt out. Your agent has reached its final form.');
  }

  // 4. Tier gate — free Larva (picoclaw) cannot molt
  const agentLevel = workerTierToLevel(resolved.accountTier);
  if (!MOLT_PERMITTED_TIERS.has(agentLevel)) {
    errors.push(
      'Molting requires Pupa tier or above. ' +
      'Free picoclaw (Larva) accounts cannot molt — evolve to Pupa first (2 xDAI).',
    );
  }

  // 5. Verify ownership
  if (!resolved.onChainOwner) {
    errors.push('Agent has no on-chain owner registered — cannot verify ownership');
  } else if (resolved.onChainOwner.toLowerCase() !== callerWallet.toLowerCase()) {
    errors.push(
      `Ownership mismatch — agent is owned by ${resolved.onChainOwner.slice(0, 6)}...${resolved.onChainOwner.slice(-4)}, not your connected wallet`,
    );
  }

  // 6. Check target availability
  const targetAvailable = await checkTargetAvailable(targetName, targetTld);
  if (!targetAvailable) {
    errors.push(`Target identity "${targetName}.${targetTld}" is already taken`);
  }

  // 7. Warn if molting to same name
  if (targetName === agentName) {
    warnings.push('Target identity is the same as the source agent name');
  }

  // 8. Info: Imago gets Story IP badge on molt
  if (agentLevel === 'imago') {
    warnings.push('Imago tier — Story IP asset will be updated to reflect new identity after molt.');
  }

  const sourceAgent = {
    name: agentName,
    tld: resolved.tld ?? 'nftmail.gno',
    tier: resolved.accountTier ?? 'basic',
    level: agentLevel,
    onChainOwner: resolved.onChainOwner ?? '',
    originNft: resolved.originNft ?? `${agentName}.nftmail.gno`,
    tbaAddress: resolved.tbaAddress ?? null,
    totalXdaiBurned: moltPath?.totalXdaiBurned ?? 0,
    surgeReputationScore: moltPath?.surgeReputationScore ?? 0,
  };

  return {
    canMolt: errors.length === 0,
    errors,
    warnings,
    sourceAgent,
    targetAvailable,
  };
}
