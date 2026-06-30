import { NextRequest, NextResponse } from 'next/server';
import { encodeStringValue } from '../../../services/erc8048-publisher';

const REGISTRY = (process.env.NEXT_PUBLIC_ERC8048_REGISTRY ?? '0x0106341056a8790f4b924c380ed5B81B2a062bCE') as `0x${string}`;
const OPERATOR_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;

const SET_METADATA_ABI = [{
  name: 'setMetadata',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenId', type: 'uint256' },
    { name: 'key',     type: 'string'  },
    { name: 'value',   type: 'bytes'   },
  ],
  outputs: [],
}] as const;

export async function POST(req: NextRequest) {
  if (!OPERATOR_KEY) {
    return NextResponse.json({ error: 'operator key not configured' }, { status: 500 });
  }

  let tokenId: unknown, key: unknown, value: unknown;
  try {
    ({ tokenId, key, value } = await req.json() as Record<string, unknown>);
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof tokenId !== 'number' || typeof key !== 'string' || !key || typeof value !== 'string') {
    return NextResponse.json({ error: 'tokenId (number), key (string), value (string) required' }, { status: 400 });
  }

  try {
    const { createWalletClient, http, encodeFunctionData } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { gnosis } = await import('viem/chains');

    const account = privateKeyToAccount(OPERATOR_KEY);
    const walletClient = createWalletClient({ account, chain: gnosis, transport: http() });

    const data = encodeFunctionData({
      abi: SET_METADATA_ABI,
      functionName: 'setMetadata',
      args: [BigInt(tokenId), key, encodeStringValue(value)],
    });

    const txHash = await walletClient.sendTransaction({
      account,
      to: REGISTRY,
      data,
      chain: gnosis,
    });

    return NextResponse.json({ txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'tx failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
