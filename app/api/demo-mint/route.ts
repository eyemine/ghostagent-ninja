/**
 * POST /api/demo-mint
 *
 * Gasless FakeNormie mint relay for hackathon judges.
 * Treasury wallet pays the xDAI gas — judge just connects a wallet.
 *
 * Rate limit: 1 per wallet address, global cap of 500 mints.
 * No Privy session required — this is a public demo endpoint.
 *
 * Body: { recipientAddress: string }
 * Returns: { tokenId, txHash, contractAddress, explorerUrl, alreadyMinted? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, defineChain, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

// Set FAKE_NORMIE_CONTRACT after deploying FakeNormie.sol
const FAKE_NORMIE_CONTRACT = (process.env.FAKE_NORMIE_CONTRACT ?? '') as Address;

const FAKE_NORMIE_ABI = [
  {
    name: 'mintTo',
    type: 'function',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'hasMinted',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'nextTokenId',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// In-memory guard (resets on cold start — fine for demo)
const GLOBAL_CAP = 500;
let globalCount = 0;
const mintedWallets = new Set<string>();

export async function POST(req: NextRequest) {
  // ── Guard: contract configured ──────────────────────────────────────────────
  if (!FAKE_NORMIE_CONTRACT || (FAKE_NORMIE_CONTRACT as string) === '') {
    return NextResponse.json(
      { error: 'Demo mint not configured — FAKE_NORMIE_CONTRACT env var missing' },
      { status: 503 }
    );
  }

  // ── Guard: treasury key ─────────────────────────────────────────────────────
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!treasuryKey) {
    return NextResponse.json(
      { error: 'Demo mint treasury not configured' },
      { status: 503 }
    );
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  const body = await req.json() as { recipientAddress?: string };
  const recipient = body.recipientAddress?.toLowerCase().trim();

  if (!recipient || !/^0x[a-f0-9]{40}$/.test(recipient)) {
    return NextResponse.json(
      { error: 'recipientAddress must be a valid 0x Ethereum address' },
      { status: 400 }
    );
  }

  // ── Rate limit: global cap ───────────────────────────────────────────────────
  if (globalCount >= GLOBAL_CAP) {
    return NextResponse.json(
      { error: 'Demo mint cap reached. Contact @ghostagent for a manual mint.' },
      { status: 429 }
    );
  }

  // ── Rate limit: 1 per wallet (in-memory) ────────────────────────────────────
  if (mintedWallets.has(recipient)) {
    // Also check on-chain in case server restarted
    const publicClient = createPublicClient({ chain: gnosis, transport: http() });
    const alreadyMinted = await publicClient.readContract({
      address: FAKE_NORMIE_CONTRACT,
      abi: FAKE_NORMIE_ABI,
      functionName: 'hasMinted',
      args: [recipient as Address],
    });
    if (alreadyMinted) {
      return NextResponse.json(
        { alreadyMinted: true, message: 'This wallet already has a FakeNormie. Check your wallet!' },
        { status: 200 }
      );
    }
  }

  // ── Execute mint ─────────────────────────────────────────────────────────────
  try {
    const account = privateKeyToAccount(treasuryKey as `0x${string}`);
    const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });
    const publicClient = createPublicClient({ chain: gnosis, transport: http() });

    // Simulate first to catch AlreadyMinted revert before spending gas
    await publicClient.simulateContract({
      address: FAKE_NORMIE_CONTRACT,
      abi: FAKE_NORMIE_ABI,
      functionName: 'mintTo',
      args: [recipient as Address],
      account: account.address,
    });

    const txHash = await walletClient.writeContract({
      address: FAKE_NORMIE_CONTRACT,
      abi: FAKE_NORMIE_ABI,
      functionName: 'mintTo',
      args: [recipient as Address],
      chain: gnosis,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Extract tokenId from Transfer event (ERC-721 standard: Transfer(from, to, tokenId))
    let tokenId: string | null = null;
    for (const log of receipt.logs) {
      // Transfer topic: keccak256("Transfer(address,address,uint256)")
      if (
        log.address.toLowerCase() === FAKE_NORMIE_CONTRACT.toLowerCase() &&
        log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
        log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) {
        tokenId = log.topics[3] ? String(BigInt(log.topics[3])) : null;
      }
    }

    // Update in-memory counters
    globalCount++;
    mintedWallets.add(recipient);

    return NextResponse.json(
      {
        success:         true,
        tokenId,
        txHash,
        contractAddress: FAKE_NORMIE_CONTRACT,
        explorerUrl:     `https://gnosisscan.io/tx/${txHash}`,
        nftUrl:          `https://gnosisscan.io/token/${FAKE_NORMIE_CONTRACT}?a=${recipient}`,
        recipient,
        message:         `FakeNormie #${tokenId} minted to ${recipient}`,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // AlreadyMinted revert → friendly response
    if (msg.includes('AlreadyMinted')) {
      mintedWallets.add(recipient);
      return NextResponse.json(
        { alreadyMinted: true, message: 'This wallet already has a FakeNormie. Check your wallet!' },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { error: `Mint failed: ${msg}` },
      { status: 500 }
    );
  }
}
