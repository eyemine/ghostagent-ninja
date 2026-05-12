import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const GNOSIS_TREASURY = '0xed0b0694953158dd54d0c36d320b391f44cd67f3';

const TIER_FEES: Record<string, number> = { basic: 10, freemium: 10, lite: 14 };

async function verifyPayment(txHash: string, fromWallet: string, expectedXdai: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [txHash] }),
    });
    const data = await res.json() as { result?: any };
    const tx = data.result;
    if (!tx) return { ok: false, error: 'Transaction not found' };
    if (tx.from.toLowerCase() !== fromWallet.toLowerCase()) return { ok: false, error: 'Sender mismatch' };
    if (tx.to?.toLowerCase() !== GNOSIS_TREASURY) return { ok: false, error: 'Wrong recipient' };
    const valueXdai = Number(BigInt(tx.value || '0x0')) / 1e18;
    if (valueXdai < expectedXdai * 0.99) return { ok: false, error: `Insufficient fee: ${valueXdai} xDAI < ${expectedXdai} required` };
    return { ok: true };
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

  const { fid, agentName, walletAddress, txHash, currentTier = 'basic' } = body;

  if (!fid || !agentName || !walletAddress || !txHash) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const newTier = currentTier === 'basic' || currentTier === 'freemium' ? 'lite' : currentTier === 'lite' ? 'professional' : null;
  if (!newTier) return NextResponse.json({ error: 'Already at max tier' }, { status: 400 });

  const expectedFee = TIER_FEES[currentTier] ?? 10;

  const payment = await verifyPayment(txHash, walletAddress, expectedFee);
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 402 });

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
