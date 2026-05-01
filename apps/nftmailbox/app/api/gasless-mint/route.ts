import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  encodePacked,
  namehash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

const REGISTRAR = '0x831ddd71e7c33e16b674099129E6E379DA407fAF' as const;
const GNS_REGISTRY = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as const;
const NFTMAIL_GNO_NAMEHASH = namehash('nftmail.gno');

const GNSRegistryABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const NamespaceRegistrarABI = [
  {
    inputs: [
      { internalType: 'string', name: 'label', type: 'string' },
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'bytes', name: 'storyData', type: 'bytes' },
      { internalType: 'bytes32', name: 'tbaSalt', type: 'bytes32' },
    ],
    name: 'mintSubname',
    outputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'bytes32', name: 'subnode', type: 'bytes32' },
      { internalType: 'bytes32', name: 'ipaId', type: 'bytes32' },
      { internalType: 'address', name: 'tba', type: 'address' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'parentNode', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'labelhash', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'subnode', type: 'bytes32' },
      { indexed: false, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: false, internalType: 'address', name: 'owner', type: 'address' },
    ],
    name: 'SubnameMinted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'account', type: 'address' },
      { indexed: true, internalType: 'address', name: 'tokenContract', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
    ],
    name: 'TokenboundAccountCreated',
    type: 'event',
  },
] as const;

// Simple daily rate-limit: max mints per day (in-memory, resets on cold start)
const DAILY_LIMIT = parseInt(process.env.GASLESS_DAILY_LIMIT || '100', 10);
let mintCountToday = 0;
let lastResetDate = new Date().toISOString().slice(0, 10);

// In-flight mutex: prevents race condition where two concurrent requests both pass
// the on-chain check before either tx confirms (covers double-click scenarios)
const inFlightLabels = new Set<string>();

function checkRateLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    mintCountToday = 0;
    lastResetDate = today;
  }
  return mintCountToday < DAILY_LIMIT;
}

export async function POST(req: NextRequest) {
  try {
    // Validate env
    const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryKey) {
      return NextResponse.json(
        { error: 'Gasless minting not configured (missing treasury key)' },
        { status: 503 }
      );
    }

    // Parse request
    const body = await req.json();
    const { label, owner } = body as { label?: string; owner?: string };

    if (!label || typeof label !== 'string' || label.length < 3) {
      return NextResponse.json(
        { error: 'Label must be at least 3 characters' },
        { status: 400 }
      );
    }

    // GNS label uses hyphen (mac-slave.nftmail.gno)
    // nftmail.box email uses dot (mac.slave@nftmail.box)
    // Derive emailLocal by replacing first hyphen separator with dot
    const hyphenIdx = label.indexOf('-');
    const emailLocal = hyphenIdx !== -1 ? label.slice(0, hyphenIdx) + '.' + label.slice(hyphenIdx + 1) : label;

    if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      return NextResponse.json(
        { error: 'Invalid owner address' },
        { status: 400 }
      );
    }

    // Check pause switch
    if (process.env.GASLESS_PAUSED === 'true') {
      return NextResponse.json(
        { error: 'Gasless minting is temporarily paused' },
        { status: 503 }
      );
    }

    // Rate limit
    if (!checkRateLimit()) {
      return NextResponse.json(
        { error: 'Daily gasless mint limit reached. Try again tomorrow or mint with your own wallet.' },
        { status: 429 }
      );
    }

    // Create treasury signer
    const account = privateKeyToAccount(treasuryKey as `0x${string}`);

    const publicClient = createPublicClient({
      chain: gnosis,
      transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
    });

    const walletClient = createWalletClient({
      chain: gnosis,
      transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
      account,
    });

    // Check treasury balance
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < BigInt(1e15)) {
      // Less than 0.001 xDAI
      return NextResponse.json(
        { error: 'Treasury wallet low on funds. Please try again later.' },
        { status: 503 }
      );
    }

    // Check if name already exists on-chain
    // GNS registry owner() reverts for unminted subnodes — treat revert as available
    const labelhash = keccak256(encodePacked(['string'], [label]));
    const subnode = keccak256(encodePacked(['bytes32', 'bytes32'], [NFTMAIL_GNO_NAMEHASH, labelhash]));
    try {
      const existingOwner = await publicClient.readContract({
        address: GNS_REGISTRY,
        abi: GNSRegistryABI,
        functionName: 'owner',
        args: [subnode],
      });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
        return NextResponse.json(
          { error: `${label}.nftmail.gno is already minted. Choose a different name.` },
          { status: 409 }
        );
      }
    } catch {
      // Revert means subnode doesn't exist in registry — name is available, proceed
    }

    // In-flight mutex: reject if another request is already minting this label
    if (inFlightLabels.has(label)) {
      return NextResponse.json(
        { error: `${label}.nftmail.gno is currently being minted. Please wait.` },
        { status: 409 }
      );
    }
    inFlightLabels.add(label);

    try {
      // Submit mint transaction
      const hash = await walletClient.writeContract({
        address: REGISTRAR,
        abi: NamespaceRegistrarABI,
        functionName: 'mintSubname',
        args: [
          label,
          owner as `0x${string}`,
          '0x',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      });

      // Wait for receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Increment rate limit counter
      mintCountToday++;

      // Extract TBA from events
      let tbaAddress = '';
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: NamespaceRegistrarABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'TokenboundAccountCreated') {
            tbaAddress = (decoded.args as any).account;
          }
        } catch {}
      }

      // ─── Register sovereign inbox in nftmail-email-worker KV ───
      const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
      const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
      let kvRegistered = false;
      if (webhookSecret) {
        try {
          const kvRes = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'registerSovereign',
              secret: webhookSecret,
              label,
              controller: owner,
              originNft: `${label}.nftmail.gno`,
              legacyIdentity: emailLocal,
              mintedTokenId: null,
              privacyTier: 'exposed',
            }),
          });
          const kvJson = await kvRes.json() as any;
          kvRegistered = kvJson?.status === 'registered';
        } catch {
          // Non-fatal — KV can be backfilled manually
        }
      }

      return NextResponse.json({
        success: true,
        txHash: hash,
        tbaAddress,
        label,
        email: `${emailLocal}@nftmail.box`,
        sponsor: account.address,
        kvRegistered,
      });
    } finally {
      inFlightLabels.delete(label);
    }
  } catch (err: any) {
    console.error('Gasless mint error:', err);
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || 'Gasless mint failed' },
      { status: 500 }
    );
  }
}
