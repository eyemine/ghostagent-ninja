import { NextResponse } from 'next/server';
import { registerChonkAsStoryIp } from '../../../services/story-register';

interface RegisterRequest {
  tokenId?: number;
  storySafeAddress?: string;
}

export async function POST(request: Request) {
  try {
    const { tokenId, storySafeAddress } = await request.json() as RegisterRequest;
    if (!Number.isInteger(tokenId) || tokenId === undefined) {
      return NextResponse.json({ error: 'Missing tokenId' }, { status: 400 });
    }
    if (!storySafeAddress || !/^0x[a-fA-F0-9]{40}$/.test(storySafeAddress)) {
      return NextResponse.json({ error: 'Missing or invalid storySafeAddress' }, { status: 400 });
    }

    const ipId = await registerChonkAsStoryIp(tokenId, storySafeAddress);
    return NextResponse.json({ status: 'REGISTERED', tokenId, ipId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Story registration failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
