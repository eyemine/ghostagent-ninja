/**
 * GET /api/delegate-check?hot=0x...&vault=0x...&contract=0x...&tokenId=123
 *
 * Returns { isDelegated: bool } — whether the hot wallet is an authorised
 * delegate for the vault wallet over a specific ERC-721 token via delegate.xyz V2.
 *
 * Called by the pair-nft ownership check when the connected wallet does not
 * directly own the NFT (i.e. NFT is in cold storage / hardware wallet).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkDelegateForERC721 } from '../../utils/delegate-verify';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hot      = searchParams.get('hot') ?? '';
  const vault    = searchParams.get('vault') ?? '';
  const contract = searchParams.get('contract') ?? '';
  const tokenId  = searchParams.get('tokenId') ?? '';

  if (!/^0x[a-fA-F0-9]{40}$/.test(hot) || !/^0x[a-fA-F0-9]{40}$/.test(vault) || !/^0x[a-fA-F0-9]{40}$/.test(contract) || !tokenId) {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
  }

  // Determine RPC from contract — try mainnet first, then Base
  // For pair-nft we pass the chain via the existing resolvedRpc() on the client side,
  // but the delegate registry is on mainnet so we always query mainnet for the delegation.
  // The NFT ownership check is already done client-side; here we just need the delegate check.
  const ETH_RPC = process.env.ETH_RPC_URL ?? 'https://cloudflare-eth.com';

  const result = await checkDelegateForERC721({
    hotWallet:   hot,
    vaultWallet: vault,
    contract,
    tokenId,
    rpcUrl:      ETH_RPC,
  });

  return NextResponse.json(
    { isDelegated: result.isDelegated, hotWallet: hot, vaultWallet: vault },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
