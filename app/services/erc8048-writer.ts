import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { encodeStringValue, REGISTRY_ABI } from './erc8048-publisher';

const REGISTRY_ADDRESS =
  process.env.NEXT_PUBLIC_ERC8048_REGISTRY_ADDRESS ??
  process.env.NEXT_PUBLIC_ERC8048_REGISTRY ??
  '0x0106341056a8790f4b924c380ed5B81B2a062bCE';

function getOperatorKey(): Hex {
  const raw = process.env.CDR_OPERATOR_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY ?? process.env.TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error('Missing CDR_OPERATOR_PRIVATE_KEY, OPERATOR_PRIVATE_KEY, or TREASURY_PRIVATE_KEY');
  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (key.length !== 66) throw new Error('Invalid operator private key length');
  return key as Hex;
}

function getWalletClient() {
  const account = privateKeyToAccount(getOperatorKey());
  return createWalletClient({ account, chain: gnosis, transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC ?? 'https://rpc.gnosischain.com') });
}

export async function setErc8048Metadata(tokenId: number, key: string, value: Hex): Promise<Hex> {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: REGISTRY_ADDRESS as Hex,
    abi: REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [BigInt(tokenId), key, value],
  });
}

export async function setErc8048TextMetadata(tokenId: number, key: string, value: string): Promise<Hex> {
  return setErc8048Metadata(tokenId, key, encodeStringValue(value));
}

export function getErc8048RegistryAddress(): Hex {
  return REGISTRY_ADDRESS as Hex;
}
