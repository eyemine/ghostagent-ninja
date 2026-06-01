import { NextResponse } from 'next/server';
import { decryptDataKey } from '../../../services/cdr-vault';

interface UnlockRequest {
  tokenId?: number;
  userAddress?: string;
  vaultUuid?: number;
  mockSecretKey?: string;
}

function isValidAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as UnlockRequest;
    const { tokenId, userAddress, vaultUuid } = body;

    if (!Number.isInteger(tokenId) || tokenId === undefined) {
      return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
    }
    if (!isValidAddress(userAddress)) {
      return NextResponse.json({ error: 'Missing or invalid userAddress' }, { status: 400 });
    }
    if (!Number.isInteger(vaultUuid) || vaultUuid === undefined) {
      return NextResponse.json({ error: 'Missing vaultUuid' }, { status: 400 });
    }

    const authorizedAddresses = (process.env.CDR_UNLOCK_ALLOWLIST ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);
    const isAccessAuthorized = authorizedAddresses.length === 0 || authorizedAddresses.includes(userAddress.toLowerCase());

    if (!isAccessAuthorized) {
      return NextResponse.json({ error: 'Sovereign IP Guard: Required License Token Missing' }, { status: 403 });
    }

    const decrypted = await decryptDataKey({ vault: { uuid: vaultUuid } });
    const payload = Buffer.from(decrypted).toString('base64');

    return NextResponse.json({
      status: 'UNLOCKED',
      tokenId,
      payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vault processing system failure';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
