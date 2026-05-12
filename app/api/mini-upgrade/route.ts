import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

// Payment: USDC on Base (6 decimals)
const BASE_RPC = 'https://mainnet.base.org';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // Base USDC
const TREASURY = '0xed0b0694953158dd54d0c36d320b391f44cd67f3';

// ERC-20 Transfer topic: Transfer(address,address,uint256)
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Fees in USDC (6 decimals): basic/free → lite = $10, lite → professional = $14
const TIER_FEES_USDC: Record<string, number> = { basic: 10, free: 10, lite: 14 };

async function verifyUsdcPayment(
  txHash: string,
  expectedUsdc: number,
): Promise<{ ok: boolean; fromWallet?: string; error?: string }> {
  try {
    // Fetch both tx (for sender) and receipt (for logs) in parallel
    const [txRes, rcptRes] = await Promise.all([
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
    ]);
    const txData = await txRes.json() as { result?: any };
    const rcptData = await rcptRes.json() as { result?: any };
    const tx = txData.result;
    const receipt = rcptData.result;
    if (!tx) return { ok: false, error: 'Transaction not found' };
    if (!receipt) return { ok: false, error: 'Transaction not yet confirmed' };
    if (receipt.status !== '0x1') return { ok: false, error: 'Transaction reverted' };

    const fromWallet: string = tx.from?.toLowerCase() ?? '';

    // Find a USDC Transfer log: from=sender, to=treasury, value>=expected
    const expectedWei = BigInt(Math.floor(expectedUsdc * 1e6));
    const logs: any[] = receipt.logs ?? [];
    const match = logs.find((log: any) => {
      if (log.address?.toLowerCase() !== BASE_USDC) return false;
      if (log.topics?.[0] !== TRANSFER_TOPIC) return false;
      const from = ('0x' + (log.topics[1] ?? '').slice(26)).toLowerCase();
      const to   = ('0x' + (log.topics[2] ?? '').slice(26)).toLowerCase();
      if (from !== fromWallet) return false;
      if (to !== TREASURY) return false;
      const value = BigInt(log.data || '0x0');
      return value >= expectedWei;
    });

    if (!match) {
      return { ok: false, error: `No USDC transfer of ≥${expectedUsdc} USDC to treasury found in tx` };
    }
    return { ok: true, fromWallet };
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

  const newTier = currentTier === 'basic' || currentTier === 'free' ? 'lite' : currentTier === 'lite' ? 'professional' : null;
  if (!newTier) return NextResponse.json({ error: 'Already at max tier' }, { status: 400 });

  const expectedFee = TIER_FEES_USDC[currentTier] ?? 10;

  // Verify payment and derive the sender's wallet from the tx receipt
  const payment = await verifyUsdcPayment(txHash, expectedFee);
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 402 });
  const walletAddress = payment.fromWallet!;

  // Link wallet
  const linkRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'linkWallet', fid, agentName, walletAddress }),
  });
  const linkData = await linkRes.json() as { status?: string; error?: string };
  if (linkData.status !== 'linked') {
    return NextResponse.json({ error: linkData.error || 'Wallet link failed' }, { status: 500 });
  }

  // Upgrade tier
  const upgradeRes = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upgradeTier', label: agentName, newTier, secret: WEBHOOK_SECRET }),
  });
  const upgradeData = await upgradeRes.json() as { status?: string; newTier?: string; error?: string };
  if (upgradeData.status !== 'upgraded') {
    return NextResponse.json({ error: upgradeData.error || 'Upgrade failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'upgraded', newTier: upgradeData.newTier ?? newTier }, { headers: { 'Cache-Control': 'no-store' } });
}
