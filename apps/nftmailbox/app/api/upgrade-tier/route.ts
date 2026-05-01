/// API Route: NFTMail Tier Upgrade
/// POST /api/upgrade-tier
///
/// Tier ladder:
///   basic   → receive-only, 8-day decay, $2 mint fee (handled by gasless-mint)
///   lite    → send enabled, 30-day account cycle, Gnosis Safe body, $10 one-time
///   premium/pro → Shared relay MTA, infinite KV retention (no decay), $24/yr
///   ghost   → full GhostAgent identity (agent marketplace eligible)
///
/// Body: { label, ownerWallet, newTier: 'lite'|'pro'|'premium', paymentTxHash? }
/// Returns: { status, label, newTier, expiresAt, safe }

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { verifyXDAIPayment, verifyEUREPayment, autoDetectXDAIPayment, autoDetectEUREPayment, burnTxHash, TIER_PRICES_USD, TIER_PRICES_EURE } from '../../lib/payments';

const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// ─── Lite tier: $10 — Safe factory on Gnosis for user's body ───
// v1.3.0 canonical Safe deployment contracts on Gnosis
const SAFE_PROXY_FACTORY = '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2' as Address;
const SAFE_SINGLETON    = '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552' as Address;
const SAFE_FALLBACK     = '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4' as Address;

const SafeProxyFactoryABI = [
  {
    name: 'createProxyWithNonce',
    type: 'function',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'ProxyCreation',
    type: 'event',
    inputs: [
      { indexed: false, name: 'proxy', type: 'address' },
      { indexed: false, name: 'singleton', type: 'address' },
    ],
  },
] as const;

const SafeSetupABI = [
  {
    name: 'setup',
    type: 'function',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;


export async function POST(req: NextRequest) {
  try {
    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'Upgrade not configured (missing NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
    }

    const body = await req.json() as {
      label?: string;
      ownerWallet?: string;
      newTier?: string;
      paymentTxHash?: string;
      paymentToken?: 'xdai' | 'eure'; // default: 'xdai'
      legacyIdentity?: string;
      autoDetect?: boolean;
    };

    const { label, ownerWallet, newTier, paymentTxHash, paymentToken = 'xdai', legacyIdentity, autoDetect } = body;

    if (!label || typeof label !== 'string') {
      return NextResponse.json({ error: 'Missing label' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet' }, { status: 400 });
    }
    // Accept 'pro' as canonical name; 'premium' is kept as an alias for backwards compat
    const normalisedTier = newTier === 'pro' ? 'premium' : newTier;
    if (!normalisedTier || !['lite', 'premium', 'ghost'].includes(normalisedTier)) {
      return NextResponse.json({ error: 'newTier must be lite, pro, or ghost' }, { status: 400 });
    }

    // ── Payment gate ──
    const eurePrice = TIER_PRICES_EURE[normalisedTier];
    const xdaiPrice = TIER_PRICES_USD[normalisedTier];

    let payment;
    if (autoDetect) {
      // Auto-detect mode: scan Gnosisscan for a recent payment from ownerWallet
      payment = paymentToken === 'eure'
        ? await autoDetectEUREPayment(ownerWallet, normalisedTier)
        : await autoDetectXDAIPayment(ownerWallet, normalisedTier);
      if (!payment.valid) {
        // Return 404 so the poller knows to keep trying (not a fatal error)
        return NextResponse.json({ error: payment.error, polling: true }, { status: 404 });
      }
    } else {
      if (!paymentTxHash) {
        return NextResponse.json({
          error: `Payment required for ${normalisedTier} tier`,
          requiredXDAI: xdaiPrice,
          requiredEURE: eurePrice ? (Number(eurePrice) / 1e6).toFixed(2) : undefined,
          treasurySafe: process.env.TREASURY_SAFE_ADDRESS || '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
          tier: normalisedTier,
        }, { status: 402 });
      }
      payment = paymentToken === 'eure'
        ? await verifyEUREPayment(paymentTxHash, normalisedTier)
        : await verifyXDAIPayment(paymentTxHash, normalisedTier);
      if (!payment.valid) {
        return NextResponse.json({ error: payment.error }, { status: 402 });
      }
    }

    let safeAddress: string | null = null;

    // ── Lite + PRO: deploy a 1-of-1 Gnosis Safe as the user's "body" ──
    if (normalisedTier === 'lite' || normalisedTier === 'premium' || normalisedTier === 'ghost') {
      const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
      if (treasuryKey) {
        try {
          const account = privateKeyToAccount(treasuryKey as `0x${string}`);
          const publicClient = createPublicClient({ chain: gnosis, transport: http() });
          const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

          // Build Safe setup calldata: 1-of-1, owner = user's wallet
          const { encodeFunctionData } = await import('viem');
          const setupData = encodeFunctionData({
            abi: SafeSetupABI,
            functionName: 'setup',
            args: [
              [ownerWallet as Address],       // owners
              BigInt(1),                       // threshold
              '0x0000000000000000000000000000000000000000' as Address, // to (no delegate call)
              '0x',                            // data
              SAFE_FALLBACK,                   // fallbackHandler
              '0x0000000000000000000000000000000000000000' as Address, // paymentToken
              BigInt(0),                       // payment
              '0x0000000000000000000000000000000000000000' as Address, // paymentReceiver
            ],
          });

          // saltNonce = keccak of label+owner to get a deterministic but unique address
          const { keccak256, encodePacked } = await import('viem');
          const saltNonce = BigInt(keccak256(encodePacked(['string', 'address'], [label, ownerWallet as Address])));

          const hash = await walletClient.writeContract({
            address: SAFE_PROXY_FACTORY,
            abi: SafeProxyFactoryABI,
            functionName: 'createProxyWithNonce',
            args: [SAFE_SINGLETON, setupData, saltNonce],
          });

          const receipt = await publicClient.waitForTransactionReceipt({ hash });

          // Parse ProxyCreation event for Safe address
          const { decodeEventLog } = await import('viem');
          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({ abi: SafeProxyFactoryABI, data: log.data, topics: log.topics });
              if (decoded.eventName === 'ProxyCreation') {
                safeAddress = (decoded.args as any).proxy as string;
                break;
              }
            } catch {}
          }
        } catch (safeErr: any) {
          console.error('Safe deploy failed (non-fatal):', safeErr?.message);
        }
      }
    }

    // ── PRO: sovereign relay — no Zoho seat provisioning needed ──
    // PRO users send via ghostagent@nftmail.box with Reply-To: label@nftmail.box
    // Messages stored in Cloudflare KV with infinite retention (no TTL)

    // ── Call worker upgradeTier ──
    const workerRes = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upgradeTier',
        secret: webhookSecret,
        label,
        newTier: normalisedTier,
        safe: safeAddress,
        storyIp: null,
        legacyIdentity: legacyIdentity || null,
        retention: normalisedTier === 'premium' || normalisedTier === 'ghost' ? 'infinite' : '8-day',
      }),
    });
    const workerJson = await workerRes.json() as any;

    if (workerJson?.status !== 'upgraded') {
      return NextResponse.json({
        error: 'Worker KV upgrade failed',
        detail: workerJson,
      }, { status: 502 });
    }

    // Burn txHash to prevent double-spend — non-fatal, do after upgrade succeeds
    const resolvedTxHash = payment.txHash || paymentTxHash;
    if (resolvedTxHash) await burnTxHash(resolvedTxHash, label, normalisedTier);

    return NextResponse.json({
      success: true,
      label,
      email: `${label}@nftmail.box`,
      newTier: normalisedTier,
      expiresAt: workerJson.expiresAt,
      safe: safeAddress,
      paymentTxHash,
      paymentFrom: payment.from,
      paymentValue: payment.value,
      message: normalisedTier === 'ghost'
        ? 'Agent activated — sovereign identity, Brain module eligible, Mirror Body deployed'
        : normalisedTier === 'premium'
        ? 'Imago activated — infinite KV retention, sovereign relay MTA, Mirror Body deployed'
        : 'Pupa activated — Mirror Body Safe deployed, sending enabled, 30-day cycle reset',
    });
  } catch (err: any) {
    console.error('upgrade-tier error:', err);
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || 'Upgrade failed' },
      { status: 500 }
    );
  }
}
