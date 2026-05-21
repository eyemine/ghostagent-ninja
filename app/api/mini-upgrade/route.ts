import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

// Payment: USDC on Base (6 decimals)
const BASE_RPC = 'https://mainnet.base.org';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // Base USDC
const TREASURY = '0xed0b0694953158dd54d0c36d320b391f44cd67f3';

// ERC-20 Transfer topic: Transfer(address,address,uint256)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Beacon NFT contract on Base (deploy NFTmailBeacon.sol, then set this env var)
const NFTMAIL_BEACON_BASE = process.env.NFTMAIL_BEACON_CONTRACT ?? '';

// Fees: free/basic → pro = $10,  pro → premium = $14 (upgrade delta)
const TIER_FEES_USDC: Record<string, number> = { basic: 10, free: 10, pro: 14 };

async function verifyPayment(
  txHash: string,
  expectedUsdc: number,
): Promise<{ ok: boolean; fromWallet?: string; error?: string; ethValue?: string }> {
  try {
    // Fetch both tx (for sender) and receipt (for logs) in parallel
    const [txRes, rcptRes, ethPriceRes] = await Promise.all([
      fetch(BASE_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [txHash] }),
      }),
      fetch(BASE_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [txHash] }),
      }),
      // Get ETH price for USD valuation fallback
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
        cache: 'no-store',
      }).catch(() => null), // Non-fatal: fallback to $3000/ETH
    ]);
    const txData = await txRes.json() as { result?: any };
    const rcptData = await rcptRes.json() as { result?: any };
    const tx = txData.result;
    const receipt = rcptData.result;
    if (!tx) return { ok: false, error: 'Transaction not found' };
    if (!receipt) return { ok: false, error: 'Transaction not yet confirmed' };
    if (receipt.status !== '0x1') return { ok: false, error: 'Transaction reverted' };

    const fromWallet: string = tx.from?.toLowerCase() ?? '';

    // 1. First check: USDC transfer (preferred)
    const expectedUsdcWei = BigInt(Math.floor(expectedUsdc * 1e6));
    const logs: any[] = receipt.logs ?? [];
    const usdcMatch = logs.find((log: any) => {
      if (log.address?.toLowerCase() !== BASE_USDC) return false;
      if (log.topics?.[0] !== TRANSFER_TOPIC) return false;
      const from = ('0x' + (log.topics[1] ?? '').slice(26)).toLowerCase();
      const to   = ('0x' + (log.topics[2] ?? '').slice(26)).toLowerCase();
      if (from !== fromWallet) return false;
      if (to !== TREASURY) return false;
      const value = BigInt(log.data || '0x0');
      return value >= expectedUsdcWei;
    });

    if (usdcMatch) {
      return { ok: true, fromWallet };
    }

    // 2. Fallback: Native ETH transfer to treasury
    // Check if this is a simple ETH transfer (no contract interaction, value > 0)
    const txValue = BigInt(tx.value || '0x0');
    const txTo = (tx.to || '').toLowerCase();
    
    if (txTo === TREASURY && txValue > 0n) {
      // Get ETH price for USD valuation (fallback $3000 if API fails)
      let ethUsdPrice = 3000;
      if (ethPriceRes) {
        try {
          const priceData = await ethPriceRes.json() as { ethereum?: { usd?: number } };
          if (priceData?.ethereum?.usd) {
            ethUsdPrice = priceData.ethereum.usd;
          }
        } catch {}
      }
      
      // Calculate USD value: value (wei) / 1e18 * ethUsdPrice
      const ethValue = Number(txValue) / 1e18;
      const usdValue = ethValue * ethUsdPrice;
      
      // Accept if >= 90% of expected fee (small buffer for price volatility)
      const minUsdValue = expectedUsdc * 0.9;
      
      if (usdValue >= minUsdValue) {
        console.log(`[mini-upgrade] Accepted ETH payment: ${ethValue} ETH (~$${usdValue.toFixed(2)}) from ${fromWallet}`);
        return { ok: true, fromWallet, ethValue: ethValue.toFixed(6) };
      } else {
        return { ok: false, error: `ETH payment insufficient: ~$${usdValue.toFixed(2)} (need ≥$${expectedUsdc})` };
      }
    }

    return { ok: false, error: `No USDC transfer of ≥${expectedUsdc} USDC or equivalent ETH payment to treasury found in tx` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Payment verification failed' };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    fid?: number;
    agentName?: string;
    walletAddress?: string;
    txHash?: string;
    currentTier?: string;
  };

  const { fid, agentName, txHash, currentTier = 'basic' } = body;

  if (!fid || !agentName || !txHash) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const newTier = (currentTier === 'basic' || currentTier === 'free') ? 'pro'
    : currentTier === 'pro' ? 'premium'
    : null;
  if (!newTier) return NextResponse.json({ error: 'Already at max tier' }, { status: 400 });

  const expectedFee = TIER_FEES_USDC[currentTier] ?? 10;

  // Verify payment (USDC or ETH) and derive the sender's wallet from the tx receipt
  const payment = await verifyPayment(txHash, expectedFee);
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 402 });
  const walletAddress = payment.fromWallet!;

  // Link wallet
  const linkRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'linkWallet', fid, name: agentName, walletAddress }),
  });
  const linkData = await linkRes.json() as { status?: string; error?: string };
  if (linkData.status !== 'linked') {
    return NextResponse.json({ error: linkData.error || 'Wallet link failed' }, { status: 500 });
  }

  // Upgrade tier in KV
  const upgradeRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upgradeTier', name: agentName, tier: newTier, walletAddress: payment.fromWallet, secret: WEBHOOK_SECRET }),
  });
  const upgradeData = await upgradeRes.json() as { status?: string; newTier?: string; error?: string };
  if (upgradeData.status !== 'upgraded') {
    return NextResponse.json({ error: upgradeData.error || 'Upgrade failed' }, { status: 500 });
  }

  // Mint Base beacon NFT to payer's wallet (non-fatal — KV is source of truth if mint fails)
  let beaconTokenId: number | null = null;
  if (NFTMAIL_BEACON_BASE && process.env.TREASURY_PRIVATE_KEY) {
    try {
      const { createWalletClient, createPublicClient, http } = await import('viem');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { base } = await import('viem/chains');
      const account = privateKeyToAccount(process.env.TREASURY_PRIVATE_KEY as `0x${string}`);
      const walletClient = createWalletClient({ chain: base, transport: http(), account });
      const publicClient = createPublicClient({ chain: base, transport: http() });
      const mintFn = newTier === 'premium' ? 'mintPremium' : 'mintPro';
      const beaconAbi = [{
        name: mintFn,
        type: 'function' as const,
        inputs: [{ name: 'to', type: 'address' }],
        outputs: [{ name: 'tokenId', type: 'uint256' }],
        stateMutability: 'nonpayable' as const,
      }];
      const hash = await walletClient.writeContract({
        address: NFTMAIL_BEACON_BASE as `0x${string}`,
        abi: beaconAbi,
        functionName: mintFn,
        args: [walletAddress as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // Parse tokenId from Transfer event log (topic[3] = tokenId for ERC721)
      const transferLog = receipt.logs.find(l =>
        l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      );
      if (transferLog?.topics[3]) {
        beaconTokenId = Number(BigInt(transferLog.topics[3]));
      }
      // Update KV with beacon details
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setBeaconNft',
          label: agentName,
          beaconChain: 'base',
          beaconContract: NFTMAIL_BEACON_BASE,
          beaconTokenId,
          secret: WEBHOOK_SECRET,
        }),
      });
      console.log(`Beacon minted: ${mintFn} tokenId=${beaconTokenId} to ${walletAddress}`);
    } catch (err) {
      console.error('Beacon mint failed (non-fatal):', err);
    }
  }

  return NextResponse.json(
    { status: 'upgraded', newTier: upgradeData.newTier ?? newTier, beaconTokenId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
