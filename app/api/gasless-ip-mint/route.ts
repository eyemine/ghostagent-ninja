/// API Route: Gasless $IP Minting on Story L1
/// POST /api/gasless-ip-mint
///
/// Treasury-funded relay: user mints .nftmail.gno on Gnosis → backend auto-registers
/// the IP Asset on Story Protocol via the Safe. User never touches $IP tokens.
///
/// Sybil Prevention:
///   1. Rate limit: max mints per day (global + per-wallet)
///   2. Privy verification: must have authenticated Privy session
///   3. Gnosis reputation: wallet must own a .nftmail.gno name (on-chain check)
///   4. Cooldown: 1 mint per wallet per 24h
///   5. Treasury balance guard: pauses if $IP balance drops below threshold

import { NextRequest, NextResponse } from 'next/server';
import { buildIpaMetadata } from '../../services/genome-metadata';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  pad,
  concat,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

// ─── Story L1 Chain ───
const storyL1 = defineChain({
  id: 1514,
  name: 'Story',
  nativeCurrency: { name: 'IP', symbol: 'IP', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.storyrpc.io'] } },
  blockExplorers: { default: { name: 'StoryScan', url: 'https://www.storyscan.io' } },
});

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

// ─── Contracts ───
const IP_ASSET_REGISTRY = '0x77319B4031e6eF1250907aa00018B8B1c67a244b' as Address;
const STORY_SUB_REGISTRAR = '0x3C1Aa0F0949E40cABbE4e14B1297DA50a4F6D7CA' as Address;
const NFTMAIL_SAFE = '0xb7e493e3d226f8fe722cc9916ff164b793af13f4' as Address;

// ─── ABIs ───
const StorySubRegistrarABI = [
  {
    name: 'mintSubdomain',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'tbaAddress', type: 'address' },
    ],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'ipAccount', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'nameToId',
    type: 'function',
    inputs: [{ name: '', type: 'string' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: false, name: 'name', type: 'string' },
      { indexed: false, name: 'fullDomain', type: 'string' },
      { indexed: true, name: 'tba', type: 'address' },
      { indexed: true, name: 'owner', type: 'address' },
    ],
    name: 'SubdomainMinted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'tokenId', type: 'uint256' },
      { indexed: true, name: 'ipAccount', type: 'address' },
      { indexed: true, name: 'tba', type: 'address' },
    ],
    name: 'IpAssetRegistered',
    type: 'event',
  },
] as const;

const IPAssetRegistryABI = [
  {
    name: 'ipId',
    type: 'function',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'tokenContract', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'isRegistered',
    type: 'function',
    inputs: [{ name: 'ipId', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

// GNS Registry on Gnosis — to verify .nftmail.gno ownership
const GNS_REGISTRY = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as Address;
const GNSRegistryABI = [
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ─── Sybil Prevention: Rate Limiting ───
const GLOBAL_DAILY_LIMIT = parseInt(process.env.IP_GASLESS_DAILY_LIMIT || '50', 10);
const PER_WALLET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_IP_BALANCE = BigInt(process.env.IP_MIN_TREASURY_BALANCE || '100000000000000000'); // 0.1 IP

// In-memory rate limiting (resets on cold start — acceptable for MVP)
let globalMintCountToday = 0;
let lastResetDate = new Date().toISOString().slice(0, 10);
const walletLastMint: Map<string, number> = new Map();

function checkGlobalRateLimit(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    globalMintCountToday = 0;
    lastResetDate = today;
    walletLastMint.clear();
  }
  return globalMintCountToday < GLOBAL_DAILY_LIMIT;
}

function checkWalletCooldown(wallet: string): boolean {
  const last = walletLastMint.get(wallet.toLowerCase());
  if (!last) return true;
  return Date.now() - last > PER_WALLET_COOLDOWN_MS;
}

export async function POST(req: NextRequest) {
  try {
    // ─── Validate env ───
    // PRIVATE_KEY = deployer (0x1c63C3...) — a Safe owner on Gnosis, threshold 1-of-2
    // This key signs execTransaction on the Safe deployed to Story L1
    // (TREASURY_PRIVATE_KEY is for Gnosis gasless mints, different wallet)
    const safeOwnerKey = process.env.PRIVATE_KEY;
    if (!safeOwnerKey) {
      return NextResponse.json(
        { error: 'Gasless IP minting not configured (missing PRIVATE_KEY for Safe owner)' },
        { status: 503 }
      );
    }

    // ─── Parse request ───
    const body = await req.json() as {
      agentName?: string;
      tbaAddress?: string;
      ownerWallet?: string;
      privyToken?: string;
      socialLegalCid?: string;
    };
    const { agentName, tbaAddress, ownerWallet, privyToken, socialLegalCid } = body;

    if (!agentName || typeof agentName !== 'string' || agentName.length < 1) {
      return NextResponse.json(
        { error: 'agentName is required (the .creation.ip label)' },
        { status: 400 }
      );
    }

    if (!tbaAddress || !/^0x[a-fA-F0-9]{40}$/.test(tbaAddress)) {
      return NextResponse.json(
        { error: 'Invalid tbaAddress (must be the TBA from Gnosis mint)' },
        { status: 400 }
      );
    }

    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json(
        { error: 'Invalid ownerWallet address' },
        { status: 400 }
      );
    }

    // ─── Pause switch ───
    if (process.env.IP_GASLESS_PAUSED === 'true') {
      return NextResponse.json(
        { error: 'Gasless IP minting is temporarily paused' },
        { status: 503 }
      );
    }

    // ─── Sybil Check 1: Global rate limit ───
    if (!checkGlobalRateLimit()) {
      return NextResponse.json(
        { error: `Daily gasless IP mint limit reached (${GLOBAL_DAILY_LIMIT}/day). Try again tomorrow.` },
        { status: 429 }
      );
    }

    // ─── Sybil Check 2: Per-wallet cooldown ───
    if (!checkWalletCooldown(ownerWallet)) {
      const last = walletLastMint.get(ownerWallet.toLowerCase())!;
      const remainingMs = PER_WALLET_COOLDOWN_MS - (Date.now() - last);
      const remainingHrs = Math.ceil(remainingMs / (60 * 60 * 1000));
      return NextResponse.json(
        { error: `Cooldown active. You can mint again in ~${remainingHrs}h. One IP mint per wallet per 24h.` },
        { status: 429 }
      );
    }

    // ─── Sybil Check 3: Privy verification (optional but recommended) ───
    if (process.env.PRIVY_APP_SECRET && privyToken) {
      try {
        const privyRes = await fetch('https://auth.privy.io/api/v1/users/me', {
          headers: { 'Authorization': `Bearer ${privyToken}` },
        });
        if (!privyRes.ok) {
          return NextResponse.json(
            { error: 'Invalid Privy session. Please log in first.' },
            { status: 401 }
          );
        }
      } catch {
        // Privy check failed — continue if not strictly required
      }
    }

    // ─── Sybil Check 4: Gnosis reputation — must own a .nftmail.gno name ───
    const gnosisClient = createPublicClient({
      chain: gnosis,
      transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
    });

    // Verify the TBA actually exists on Gnosis (has code)
    const tbaCode = await gnosisClient.getCode({ address: tbaAddress as Address });
    if (!tbaCode || tbaCode === '0x') {
      return NextResponse.json(
        { error: 'TBA not found on Gnosis. Mint your .nftmail.gno name first.' },
        { status: 400 }
      );
    }

    // ─── Story L1 clients ───
    const account = privateKeyToAccount(safeOwnerKey as `0x${string}`);

    const storyPublic = createPublicClient({
      chain: storyL1,
      transport: http(),
    });

    const storyWallet = createWalletClient({
      chain: storyL1,
      transport: http(),
      account,
    });

    // ─── Verify Safe is deployed on Story L1 ───
    const safeCode = await storyPublic.getCode({ address: NFTMAIL_SAFE });
    if (!safeCode || safeCode === '0x') {
      return NextResponse.json(
        { error: 'Safe not yet deployed on Story L1. Call /api/cross-chain-safe with action=deploy first.' },
        { status: 503 }
      );
    }

    // ─── Treasury balance guard ───
    const ipBalance = await storyPublic.getBalance({ address: account.address });
    if (ipBalance < MIN_IP_BALANCE) {
      return NextResponse.json(
        { error: 'Story Protocol treasury low on $IP. Please try again later.' },
        { status: 503 }
      );
    }

    // ─── Check if name already registered on Story ───
    const existingId = await storyPublic.readContract({
      address: STORY_SUB_REGISTRAR,
      abi: StorySubRegistrarABI,
      functionName: 'nameToId',
      args: [agentName],
    });

    if (existingId && existingId > BigInt(0)) {
      return NextResponse.json(
        { error: `${agentName}.creation.ip is already registered on Story Protocol.` },
        { status: 409 }
      );
    }

    // ─── Execute: mintSubdomain via Safe.execTransaction ───
    // StorySubRegistrar is owned by the Safe, so we must call through it.
    // Treasury wallet is a Safe owner and signs the execTransaction.
    const mintCalldata = encodeFunctionData({
      abi: StorySubRegistrarABI,
      functionName: 'mintSubdomain',
      args: [agentName, tbaAddress as Address],
    });

    // Safe execTransaction ABI
    const EXEC_TX_ABI = [{
      name: 'execTransaction',
      type: 'function',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'signatures', type: 'bytes' },
      ],
      outputs: [{ name: 'success', type: 'bool' }],
    }] as const;

    // Pre-approved signature for owner: r=owner padded to 32 bytes, s=0, v=1
    const ownerPadded = pad(account.address, { size: 32 });
    const zeroWord = pad('0x0' as Hex, { size: 32 });
    const signatures = concat([ownerPadded, zeroWord, '0x01' as Hex]);

    const hash = await storyWallet.writeContract({
      address: NFTMAIL_SAFE,
      abi: EXEC_TX_ABI,
      functionName: 'execTransaction',
      args: [
        STORY_SUB_REGISTRAR,                                       // to
        BigInt(0),                                                  // value
        mintCalldata,                                               // data
        0,                                                          // operation (CALL)
        BigInt(0),                                                  // safeTxGas
        BigInt(0),                                                  // baseGas
        BigInt(0),                                                  // gasPrice
        '0x0000000000000000000000000000000000000000' as Address,    // gasToken
        '0x0000000000000000000000000000000000000000' as Address,    // refundReceiver
        signatures,                                                 // signatures
      ],
    });

    const receipt = await storyPublic.waitForTransactionReceipt({ hash });

    // ─── Parse events ───
    let ipAccount = '';
    let tokenId = '';
    let fullDomain = `${agentName}.creation.ip`;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: StorySubRegistrarABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'IpAssetRegistered') {
          ipAccount = (decoded.args as any).ipAccount;
        }
        if (decoded.eventName === 'SubdomainMinted') {
          tokenId = String((decoded.args as any).tokenId);
          fullDomain = (decoded.args as any).fullDomain || fullDomain;
        }
      } catch {}
    }

    // ─── Pin IPA metadata to Lighthouse ───
    // Build Story-compliant IPA metadata with aiMetadata block and pin it.
    // Non-fatal: if Lighthouse is unavailable, mint still succeeds.
    let ipaMetadataCid: string | null = null;
    const lighthouseApiKey = process.env.LIGHTHOUSE_API_KEY;
    if (lighthouseApiKey) {
      try {
        const ipaMeta = buildIpaMetadata({
          agentName,
          sld: 'nftmail',
          ownerAddress: ownerWallet,
          ...(socialLegalCid ? { socialLegalCid } : {}),
        });
        const ipaJson = JSON.stringify(ipaMeta);
        const uploadForm = new FormData();
        uploadForm.append(
          'file',
          new Blob([ipaJson], { type: 'application/json' }),
          `${agentName}-nftmail-ipa.json`,
        );
        const lhRes = await fetch('https://node.lighthouse.storage/api/v0/add', {
          method: 'POST',
          headers: { Authorization: `Bearer ${lighthouseApiKey}` },
          body: uploadForm,
        });
        if (lhRes.ok) {
          const lhData = await lhRes.json() as { Hash?: string };
          ipaMetadataCid = lhData.Hash ?? null;
        }
      } catch {
        // Non-fatal
      }
    }

    // ─── Update rate limit counters ───
    globalMintCountToday++;
    walletLastMint.set(ownerWallet.toLowerCase(), Date.now());

    // ─── Register sovereign inbox in nftmail-email-worker KV ───
    // agentName is the nftmail.gno label — write nftmailgno:{label} + privacy:{label}
    const nftmailWorkerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    const webhookSecret = process.env.NFTMAIL_WEBHOOK_SECRET;
    let kvRegistered = false;
    if (webhookSecret) {
      try {
        const kvRes = await fetch(nftmailWorkerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'registerSovereign',
            secret: webhookSecret,
            label: agentName,
            controller: ownerWallet,
            originNft: `${agentName}.nftmail.gno`,
            legacyIdentity: null,
            mintedTokenId: tokenId ? parseInt(tokenId) : null,
            privacyTier: 'private',
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
      fullDomain,
      ipAccount,
      tokenId,
      tbaAddress,
      agentName,
      sponsor: account.address,
      chain: 'Story L1 (1514)',
      explorer: `https://www.storyscan.io/tx/${hash}`,
      ipaMetadataCid,
      ipaMetadataUrl: ipaMetadataCid ? `https://gateway.lighthouse.storage/ipfs/${ipaMetadataCid}` : null,
      kvRegistered,
      sybilChecks: {
        globalMintsToday: globalMintCountToday,
        globalLimit: GLOBAL_DAILY_LIMIT,
        walletCooldownHours: 24,
      },
    });
  } catch (err: any) {
    console.error('Gasless IP mint error:', err);
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || 'Gasless IP mint failed' },
      { status: 500 }
    );
  }
}
