import type { Hex } from 'viem';
import { setErc8048Metadata } from './erc8048-writer';

function normalizeHexAddress(value: string): Hex {
  if (!value.startsWith('0x') || value.length !== 42) {
    throw new Error(`Expected 20-byte hex address, received: ${value}`);
  }
  return value as Hex;
}

function deriveDemoIpId(tokenId: number, storySafeAddress: string): Hex {
  const safe = normalizeHexAddress(storySafeAddress).slice(2);
  const tokenHex = tokenId.toString(16).padStart(40, '0');
  return `0x${safe.slice(0, 20)}${tokenHex.slice(20)}` as Hex;
}

export async function registerChonkAsStoryIp(tokenId: number, storySafeAddress: string): Promise<Hex> {
  const existingIpId = process.env.NEXT_PUBLIC_STORY_DEMO_IP_ID;
  const ipId = existingIpId ? normalizeHexAddress(existingIpId) : deriveDemoIpId(tokenId, storySafeAddress);
  await setErc8048Metadata(tokenId, 'story[ip_id]', ipId);
  return ipId;
}
