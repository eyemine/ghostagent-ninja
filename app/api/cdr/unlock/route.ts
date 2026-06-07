import { NextResponse } from 'next/server';
import { decryptDataKey } from '../../../services/cdr-vault';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { readFileSync } from 'fs';

interface UnlockRequest {
  tokenId?: number;
  userAddress?: string;
}

function isValidAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

const CHONK_CONTRACT = process.env.NEXT_PUBLIC_BASE_CHONK_CONTRACT as `0x${string}`;
const VAULT_UUID = Number(process.env.VAULT_UUID_REDHAMMER ?? 6229);

const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'),
});

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json() as UnlockRequest;
    const { tokenId, userAddress } = body;


    if (!isValidAddress(userAddress)) {
      return NextResponse.json({ error: 'Missing or invalid userAddress' }, { status: 400 });
    }

    if (tokenId !== 697) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const owner = await baseClient.readContract({
      address: CHONK_CONTRACT,
      abi: [{ name: 'ownerOf', type: 'function', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' }],
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    });

    if (owner.toLowerCase() !== userAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Not owner' }, { status: 403 });
    }

    const decrypted = await decryptDataKey({ vault: { uuid: VAULT_UUID } });
    const secret = JSON.parse(Buffer.from(decrypted).toString('utf8'));
    const audioBuffer = readFileSync(secret.path);

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Disposition': 'inline; filename="redhammer-misbehaved.wav"',
        'Cache-Control': 'private, no-store',
      },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vault processing system failure';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}