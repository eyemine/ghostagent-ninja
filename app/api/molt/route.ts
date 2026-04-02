/// API Route: Identity Molt
/// POST /api/molt
///
/// Orchestrates an identity molt for a GhostAgent:
///   1. Verify caller owns the agent (resolveAddress → onChainOwner matches wallet)
///   2. Verify 2 xDAI fee payment on Gnosis (tx receipt check)
///   3. Update molt_path record in worker KV
///   4. Update beacon metadata on IPFS
///
/// Body: { agentName, targetIdentity, ownerWallet, paymentTxHash }
/// Returns: MoltResult

import { NextRequest, NextResponse } from 'next/server';
import { trackMolt } from '../../services/molt-path-tracker';
import { workerTierToLevel } from '../../services/evolve-level';
import { mintOptionalIP } from '../../services/optional-ip-minter';
import { FEATURES } from '../../constants/features';
import { WORKER_URL } from '../../utils/config';

const MOLT_PERMITTED_TIERS = new Set(['pupa', 'imago', 'ghost']);


const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const GNOSIS_RPC = process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com';
const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3';
const MOLT_FEE_XDAI = 14n * 10n ** 18n; // 14 xDAI in wei

async function verifyPayment(txHash: string, ownerWallet: string, expectedFee: bigint = MOLT_FEE_XDAI): Promise<boolean> {
  try {
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }),
    });
    const { result: tx } = await res.json() as { result: any };
    if (!tx) return false;

    const isToTreasury = tx.to?.toLowerCase() === GNOSIS_TREASURY.toLowerCase();
    const isFromOwner = tx.from?.toLowerCase() === ownerWallet.toLowerCase();
    const value = BigInt(tx.value ?? '0x0');
    const isSufficientFee = value >= expectedFee;

    return isToTreasury && isFromOwner && isSufficientFee;
  } catch {
    return false;
  }
}

async function resolveAgent(agentName: string): Promise<any | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: `${agentName}_` }),
    });
    const data = await res.json() as any;
    return data?.exists ? data : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Molt not configured (missing NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
    }

    const body = await req.json() as {
      agentName?: string;
      targetIdentity?: string;
      ownerWallet?: string;
      paymentTxHash?: string;
      optionalIPMint?: boolean;
      targetIPType?: 'creation.ip' | 'moltbook.ip';
    };

    const { agentName, targetIdentity, ownerWallet, paymentTxHash, optionalIPMint, targetIPType } = body;

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
    }
    if (!targetIdentity || typeof targetIdentity !== 'string') {
      return NextResponse.json({ error: 'Missing targetIdentity' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[0-9a-fA-F]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Missing or invalid ownerWallet' }, { status: 400 });
    }
    if (!paymentTxHash || !/^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) {
      return NextResponse.json({ error: 'Missing or invalid paymentTxHash' }, { status: 400 });
    }

    // 1. Resolve agent + verify ownership
    const resolved = await resolveAgent(agentName);
    if (!resolved || !resolved.onChainOwner) {
      return NextResponse.json({ error: 'Agent not found or has no on-chain owner' }, { status: 404 });
    }
    if (resolved.onChainOwner.toLowerCase() !== ownerWallet.toLowerCase()) {
      return NextResponse.json({ error: 'Ownership verification failed — wallet does not own this agent' }, { status: 403 });
    }

    // 1b. Tier gate — Larva cannot molt
    const agentLevel = workerTierToLevel(resolved.accountTier);
    if (!MOLT_PERMITTED_TIERS.has(agentLevel)) {
      return NextResponse.json({
        error: 'Molt requires Pupa tier or above. Evolve your agent first — Larva tier is receive-only and free (picoclaw) accounts cannot molt.',
        currentTier: resolved.accountTier ?? 'basic',
        requiredTier: 'pupa',
        upgradeUrl: '/nftmail?upgrade=1',
      }, { status: 402 });
    }

    // 2. Verify fee payment (14 xDAI base; 19 xDAI if optional IP mint requested)
    const expectedFee = (FEATURES.optionalIPMint && optionalIPMint) ? 19n * 10n ** 18n : MOLT_FEE_XDAI;
    const paymentOk = await verifyPayment(paymentTxHash, ownerWallet, expectedFee);
    if (!paymentOk) {
      const feeLabel = expectedFee === MOLT_FEE_XDAI ? '14 xDAI' : '19 xDAI';
      return NextResponse.json({ error: `Payment verification failed — send ${feeLabel} to treasury on Gnosis` }, { status: 402 });
    }

    // 3. Optional additional .ip mint — non-fatal, suppressed unless FEATURES.optionalIPMint = true
    let optionalIPResult = null;
    if (FEATURES.optionalIPMint && optionalIPMint && targetIPType && resolved.tbaAddress) {
      optionalIPResult = await mintOptionalIP({
        agentName,
        tld: resolved.tld ?? 'nftmail.gno',
        targetIPType,
        safeAddress: resolved.safeAddress ?? ownerWallet,
        tbaAddress:  resolved.tbaAddress,
        ownerWallet,
        webhookSecret: WEBHOOK_SECRET,
      });
    }

    // 4. Track molt in molt-path KV + re-pin beacon
    const result = await trackMolt(
      {
        agentName,
        ownerAddress: ownerWallet,
        gnosisNft: resolved?.originNft ?? `${agentName}.nftmail.gno`,
        moltType: 'identity',
        xdaiBurned: 2,
        txHash: paymentTxHash,
        note: `identity molt → ${targetIdentity}`,
        repinBeacon: true,
      },
      WEBHOOK_SECRET,
    );

    return NextResponse.json({
      status: 'ok',
      agentName,
      targetIdentity,
      newBeaconCid: result.beaconCid,
      totalXdaiBurned: result.record.totalXdaiBurned,
      surgeReputationScore: result.record.surgeReputationScore,
      lastMoltTimestamp: result.record.lastMoltTimestamp,
    });
  } catch (err: any) {
    console.error('[molt] error:', err);
    return NextResponse.json({ error: err?.message ?? 'Molt failed' }, { status: 500 });
  }
}
