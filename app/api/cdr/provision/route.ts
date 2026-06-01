import { NextResponse } from 'next/server';
import { createAndRegisterCdrVault } from '../../../lib/cdr/create-vault';

interface ProvisionRequest {
  tokenId?: number;
  ipId?: string;
  base64Stems?: string;
}

export async function POST(request: Request) {
  try {
    const { tokenId, ipId, base64Stems } = await request.json() as ProvisionRequest;
    if (!Number.isInteger(tokenId) || tokenId === undefined) {
      return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
    }
    if (!ipId || !/^0x[a-fA-F0-9]{40}$/.test(ipId)) {
      return NextResponse.json({ error: 'Missing or invalid ipId' }, { status: 400 });
    }

    const rawStems = base64Stems
      ? Buffer.from(base64Stems, 'base64')
      : Buffer.from(`Sovereign IP Pod demo stems for Chonk #${tokenId}`, 'utf8');

    const vaultId = await createAndRegisterCdrVault(tokenId, ipId, rawStems);
    return NextResponse.json({ status: 'VAULT_PROVISIONED', tokenId, vaultId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CDR vault provisioning failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
