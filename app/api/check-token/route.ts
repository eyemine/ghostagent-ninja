/// API Route: Check if wallet owns a specific token
/// GET /api/check-token?wallet=0x...&tokenId=6&namespace=nftmail.gno

import { NextRequest, NextResponse } from 'next/server';

const GNOSIS_RPC = 'https://rpc.gnosischain.com';

const BEACON_CONTRACTS: Record<string, string> = {
  'nftmail.gno': '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  'molt.gno': '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
};

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  const tokenId = req.nextUrl.searchParams.get('tokenId');
  const namespace = req.nextUrl.searchParams.get('namespace');
  
  if (!wallet || !tokenId || !namespace) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }
  
  const contract = BEACON_CONTRACTS[namespace];
  if (!contract) {
    return NextResponse.json({ error: 'Unknown namespace' }, { status: 400 });
  }

  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'],
      }),
    });
    
    const data = await res.json() as { result?: string; error?: any };
    
    if (!data.result || data.result === '0x') {
      return NextResponse.json({ found: false, error: 'Token not found' });
    }
    
    const owner = '0x' + data.result.slice(26);
    const found = owner.toLowerCase() === wallet.toLowerCase();
    
    return NextResponse.json({ 
      found, 
      owner: owner.toLowerCase(), 
      wallet: wallet.toLowerCase(),
      match: found 
    });
  } catch (err: any) {
    return NextResponse.json({ found: false, error: err?.message });
  }
}
