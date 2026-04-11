import { NextRequest, NextResponse } from 'next/server';
import { namehash } from 'viem/ens';

const ETH_RPC = process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com';
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.toLowerCase().trim();
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Name too short' }, { status: 400 });
  }

  try {
    const label = name.replace(/\.eth$/, '');
    const node = namehash(`${label}.eth`);
    const data = `0x02571be3${node.slice(2).padStart(64, '0')}`;

    const resp = await fetch(ETH_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ENS_REGISTRY, data }, 'latest'],
      }),
    });

    const json = await resp.json() as { result?: string };
    const result = json.result || '0x';
    const owner = result.length > 2 ? `0x${result.slice(-40)}` : null;
    const registered = !!owner && owner !== '0x0000000000000000000000000000000000000000';

    return NextResponse.json({ registered, owner, name: `${label}.eth` });
  } catch (error) {
    console.error('[check-ens] failed', error);
    return NextResponse.json({ registered: false });
  }
}
