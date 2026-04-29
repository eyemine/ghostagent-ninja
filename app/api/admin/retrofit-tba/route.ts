/// POST /api/admin/retrofit-tba
///
/// Retroactively deploys the Gnosis-side mirror TBA for an existing BYO molt agent
/// and stores tbaAddress in KV. Does NOT modify the Safe — you must manually:
///   1. Add the TBA as Safe owner via app.safe.global → Settings → Owners → Add
///   2. Remove the EOA as Safe owner via Settings → Owners → Remove
///
/// Secured by NFTMAIL_WEBHOOK_SECRET.
///
/// Body: { secret, agentName, nftType, tokenId, contractAddress? }
/// Returns: { status, agentName, tbaAddress, alreadyDeployed, safeStepsRequired }

import { NextRequest, NextResponse } from 'next/server';
import { type Address } from 'viem';
import { deployGnosisTba, computeGnosisTba, isTbaDeployed } from '../../../services/gnosis-tba';

const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const NFT_CONTRACTS: Record<string, { contract: string; sourceChainId: number }> = {
  chonk:   { contract: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9', sourceChainId: 8453 },
  normie:  { contract: '0x9eb6e2025b64f340691e424b7fe7022ffde12438', sourceChainId: 8453 },
  pownft:  { contract: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b', sourceChainId: 1 },
  mooncat: { contract: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69', sourceChainId: 1 },
};

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
  const treasuryKey   = process.env.TREASURY_PRIVATE_KEY;

  if (!webhookSecret) return NextResponse.json({ error: 'Not configured (NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
  if (!treasuryKey)   return NextResponse.json({ error: 'Not configured (TREASURY_PRIVATE_KEY)' }, { status: 503 });

  const body = await req.json() as {
    secret?: string;
    agentName?: string;
    nftType?: string;
    tokenId?: string;
    contractAddress?: string;
  };

  if (body.secret !== webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!body.agentName || !body.nftType || !body.tokenId) {
    return NextResponse.json({ error: 'Missing agentName, nftType, or tokenId' }, { status: 400 });
  }

  const { agentName, nftType, tokenId } = body;

  if (nftType === 'ens') {
    return NextResponse.json({
      error: 'ENS molts use EOA as Safe owner — TBA retrofit not applicable',
    }, { status: 400 });
  }

  const nftConfig = NFT_CONTRACTS[nftType];
  const nftContract = nftConfig?.contract ?? body.contractAddress;
  const sourceChainId = nftConfig?.sourceChainId ?? 1;

  if (!nftContract) {
    return NextResponse.json({ error: `Unknown nftType "${nftType}" and no contractAddress provided` }, { status: 400 });
  }

  // ── Step 1: Compute the deterministic Gnosis mirror TBA address ──
  let tbaAddress: Address;
  try {
    tbaAddress = await computeGnosisTba({
      sourceChainId,
      contractAddress: nftContract as Address,
      tokenId: BigInt(tokenId),
    });
  } catch (err) {
    return NextResponse.json({ error: `TBA compute failed: ${(err as Error).message}` }, { status: 502 });
  }

  // ── Step 2: Deploy if not already deployed ──
  let alreadyDeployed = false;
  let deployTxHash: string | null = null;
  try {
    alreadyDeployed = await isTbaDeployed(tbaAddress);
    if (!alreadyDeployed) {
      const { createWalletClient, http } = await import('viem');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { gnosis } = await import('viem/chains');
      const account = privateKeyToAccount(treasuryKey as `0x${string}`);
      const wc = createWalletClient({ chain: gnosis, transport: http(), account });
      const result = await deployGnosisTba(
        { sourceChainId, contractAddress: nftContract as Address, tokenId: BigInt(tokenId) },
        wc,
      );
      deployTxHash = result.deployTxHash ?? null;
      console.log(`Retrofit TBA deployed for ${agentName}: ${tbaAddress} tx=${deployTxHash}`);
    } else {
      console.log(`Retrofit TBA already deployed for ${agentName}: ${tbaAddress}`);
    }
  } catch (err) {
    return NextResponse.json({ error: `TBA deployment failed: ${(err as Error).message}` }, { status: 502 });
  }

  // ── Step 3: Store tbaAddress in KV ──
  try {
    const kvRes = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'kvPut',
        key: `tba:${agentName}`,
        value: JSON.stringify({ tbaAddress, sourceChainId, nftType, tokenId, storedAt: Date.now(), retrofitted: true }),
        ownerAddress: '0x0000000000000000000000000000000000000001',
        webhookSecret,
      }),
    });
    if (!kvRes.ok) {
      console.error('KV tba write failed (non-fatal):', await kvRes.text());
    }
  } catch (err) {
    console.error('KV tba write failed (non-fatal):', err);
  }

  // ── Step 4: Look up current Safe address from KV for the manual steps ──
  let safeAddress: string | null = null;
  try {
    const identityRes = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentIdentity', name: agentName }),
    });
    if (identityRes.ok) {
      const identity = await identityRes.json() as { safeAddress?: string; principal?: string };
      safeAddress = identity.safeAddress ?? null;
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json({
    status: 'ok',
    agentName,
    nftType,
    tokenId,
    tbaAddress,
    alreadyDeployed,
    ...(deployTxHash ? { deployTxHash } : {}),
    safeAddress,
    safeStepsRequired: safeAddress ? [
      `1. Go to https://app.safe.global/home?safe=gno:${safeAddress}`,
      `2. Settings → Owners → Add owner → ${tbaAddress} (threshold: keep at 1)`,
      `3. Settings → Owners → Remove current EOA owner (after TBA is confirmed added)`,
    ] : ['Safe address not found in KV — locate it manually and add TBA as owner, remove EOA'],
  });
}
