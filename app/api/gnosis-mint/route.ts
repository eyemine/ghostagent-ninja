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
  decodeEventLog,
  type Address,
} from 'viem';
import { namehash } from 'viem/ens';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

const NFTMAIL_WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// Registrar contracts per TLD
const REGISTRAR_CONTRACTS: Record<string, Address> = {
  'nftmail.gno': '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  'molt.gno': '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
  'vault.gno': '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
  'agent.gno': '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
};

// ENS registry on Gnosis (same canonical address as Ethereum mainnet)
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address;
const EnsRegistryABI = [
  {
    name: 'owner',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

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
      tld?: string;
      skipInboxRegistration?: boolean;
    };
    const { label, ownerWallet, legacyIdentity, privacyTier = 'private', tld = 'nftmail.gno', skipInboxRegistration = false } = body;

    // Validate and get registrar contract for the TLD
    const registrarContract = REGISTRAR_CONTRACTS[tld];
    if (!registrarContract) {
      return NextResponse.json({ error: `Unsupported TLD: ${tld}. Supported: ${Object.keys(REGISTRAR_CONTRACTS).join(', ')}` }, { status: 400 });
    }

    if (!label || typeof label !== 'string' || !isValidLabel(label)) {
      return NextResponse.json({ error: 'Invalid label — must be lowercase alphanumeric with optional dots/hyphens, min 3 chars, no underscore' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }

    const account = privateKeyToAccount(treasuryKey as `0x${string}`);

    const gnosisPublic = createPublicClient({ chain: gnosis, transport: http() });
    const gnosisWallet = createWalletClient({ chain: gnosis, transport: http(), account });

    // ─── Idempotency check: skip mint if name already registered ───
    // Handles retries and accidental duplicate registrations gracefully.
    try {
      const node = namehash(`${label}.${tld}`) as `0x${string}`;
      const existingOwner = await gnosisPublic.readContract({
        address: ENS_REGISTRY,
        abi: EnsRegistryABI,
        functionName: 'owner',
        args: [node],
      });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
        console.log(`[gnosis-mint] ${label}.${tld} already registered (owner=${existingOwner}) — returning idempotent success`);
        return NextResponse.json({
          success: true, txHash: null, tokenId: null,
          email: `${label}@nftmail.box`,
          originNft: `${label}.${tld}`,
          controller: ownerWallet, tbaAddress: null, privacyTier,
          kvRegistered: false, alreadyRegistered: true,
          explorer: null,
        });
      }
    } catch {
      // Non-fatal — proceed with mint if pre-check fails
    }

    // ─── Build Story IPA metadata ───
    const sld = tld.replace('.gno', '') as 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';
    const ipaMeta = buildIpaMetadata({
      agentName: label,
      sld,
      ownerAddress: ownerWallet,
    });
    const ipaMetaBytes = `0x${Buffer.from(JSON.stringify(ipaMeta)).toString('hex')}` as `0x${string}`;

    // ─── Mint on Gnosis via treasury wallet ───
    const tbaSalt = `0x${'0'.repeat(64)}` as `0x${string}`;
    // Fetch nonce explicitly (include pending mempool) to avoid collision when treasury sends multiple txs concurrently
    const nonce = await gnosisPublic.getTransactionCount({ address: account.address, blockTag: 'pending' });
    const hash = await gnosisWallet.writeContract({
      address: registrarContract,
      abi: MintSubnameABI,
      functionName: 'mintSubname',
      args: [label, ownerWallet as Address, ipaMetaBytes, tbaSalt],
      nonce,
    });

    const receipt = await Promise.race([
      gnosisPublic.waitForTransactionReceipt({ hash }),
      new Promise<null>(res => setTimeout(() => res(null), 8_000)),
    ]);
    if (!receipt) {
      return NextResponse.json({ success: true, txHash: hash, tokenId: null, timedOut: true,
        email: `${label}@nftmail.box`, originNft: `${label}.${tld}`,
        controller: ownerWallet, tbaAddress: null, privacyTier, kvRegistered: false,
        explorer: `https://gnosisscan.io/tx/${hash}` });
    }

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

    const originNft = `${label}.${tld}`;
    const email = `${label}@nftmail.box`;

    // ─── Register sovereign inbox in KV via worker ───
    // Skip for BYO molt beacon mints — they register their own dot-separated inbox
    if (skipInboxRegistration) {
      return NextResponse.json({
        success: true, txHash: hash, tokenId: mintedTokenId, email: `${label}@nftmail.box`,
        originNft, controller: ownerWallet, tbaAddress, privacyTier, kvRegistered: false,
        explorer: `https://gnosisscan.io/tx/${hash}`,
      });
    }
    const workerRes = await fetch(NFTMAIL_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registerSovereign',
        secret: webhookSecret,
        label,
        controller: ownerWallet,
        origin_nft: `${label}.${tld}`,
        tld,
        tier: privacyTier,
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
