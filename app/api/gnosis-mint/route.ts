/// API Route: Gasless .nftmail.gno Subname Mint on Gnosis
/// POST /api/gnosis-mint
///
/// Mints a [label].nftmail.gno subname to the caller's wallet via the treasury deployer,
/// then registers the sovereign inbox in INBOX_KV via the nftmail-email-worker.
///
/// Body: { label: string, ownerWallet: string, legacyIdentity?: string, privacyTier?: string }
/// Returns: { txHash, tokenId, email, originNft, controller }

import { NextRequest, NextResponse } from 'next/server';
import { buildIpaMetadata } from '../../services/genome-metadata';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

const NFTMAIL_GNO_REGISTRAR = '0x831ddd71e7c33e16b674099129e6e379da407faf' as Address;
const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const MintSubnameABI = [
  {
    name: 'mintSubname',
    type: 'function',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'storyData', type: 'bytes' },
      { name: 'tbaSalt', type: 'bytes32' },
    ],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'subnode', type: 'bytes32' },
      { name: 'ipaId', type: 'bytes32' },
      { name: 'tba', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'SubnameMinted',
    type: 'event',
    inputs: [
      { indexed: true, name: 'parentNode', type: 'bytes32' },
      { indexed: true, name: 'labelhash', type: 'bytes32' },
      { indexed: true, name: 'subnode', type: 'bytes32' },
      { indexed: false, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'owner', type: 'address' },
    ],
  },
] as const;

// Simple label validation — must match sovereign name rules
function isValidLabel(label: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,}[a-z0-9]$/.test(label) && !label.includes('_');
}

export async function POST(req: NextRequest) {
  try {
    const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryKey) {
      return NextResponse.json({ error: 'Gnosis mint not configured (missing TREASURY_PRIVATE_KEY)' }, { status: 503 });
    }
    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json({ error: 'Worker secret not configured (missing NFTMAIL_WEBHOOK_SECRET)' }, { status: 503 });
    }

    const body = await req.json() as {
      label?: string;
      ownerWallet?: string;
      legacyIdentity?: string;
      privacyTier?: string;
    };
    const { label, ownerWallet, legacyIdentity, privacyTier = 'private' } = body;

    if (!label || typeof label !== 'string' || !isValidLabel(label)) {
      return NextResponse.json({ error: 'Invalid label — must be lowercase alphanumeric with optional dots/hyphens, min 3 chars, no underscore' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }

    const account = privateKeyToAccount(treasuryKey as `0x${string}`);

    const gnosisPublic = createPublicClient({ chain: gnosis, transport: http() });
    const gnosisWallet = createWalletClient({ chain: gnosis, transport: http(), account });

    // ─── Build Story IPA metadata ───
    const ipaMeta = buildIpaMetadata({
      agentName: label,
      sld: 'nftmail',
      ownerAddress: ownerWallet,
    });
    const ipaMetaBytes = `0x${Buffer.from(JSON.stringify(ipaMeta)).toString('hex')}` as `0x${string}`;

    // ─── Mint on Gnosis via treasury wallet ───
    const tbaSalt = `0x${'0'.repeat(64)}` as `0x${string}`;
    const hash = await gnosisWallet.writeContract({
      address: NFTMAIL_GNO_REGISTRAR,
      abi: MintSubnameABI,
      functionName: 'mintSubname',
      args: [label, ownerWallet as Address, ipaMetaBytes, tbaSalt],
    });

    const receipt = await gnosisPublic.waitForTransactionReceipt({ hash });

    // ─── Parse SubnameMinted event ───
    let mintedTokenId: number | null = null;
    let tbaAddress: string | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: MintSubnameABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'SubnameMinted') {
          mintedTokenId = Number((decoded.args as any).tokenId);
        }
      } catch {}
    }

    const originNft = `${label}.nftmail.gno`;
    const email = `${label}@nftmail.box`;

    // ─── Register sovereign inbox in KV via worker ───
    const workerRes = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registerSovereign',
        secret: webhookSecret,
        label,
        controller: ownerWallet,
        originNft,
        legacyIdentity: legacyIdentity || null,
        mintedTokenId,
        privacyTier,
      }),
    });
    const workerJson = await workerRes.json() as any;

    return NextResponse.json({
      success: true,
      txHash: hash,
      tokenId: mintedTokenId,
      email,
      originNft,
      controller: ownerWallet,
      tbaAddress,
      privacyTier,
      kvRegistered: workerJson?.status === 'registered',
      explorer: `https://gnosisscan.io/tx/${hash}`,
    });
  } catch (err: any) {
    console.error('Gnosis mint error:', err);
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || 'Gnosis mint failed' },
      { status: 500 }
    );
  }
}
