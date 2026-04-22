/**
 * Gnosis Safe creation for BYO NFT molts
 * Creates a 1-of-1 Safe with the user's wallet as the initial owner
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodePacked,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

// v1.3.0 canonical Safe deployment contracts on Gnosis
const SAFE_PROXY_FACTORY = '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2' as Address;
const SAFE_SINGLETON    = '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552' as Address;
const SAFE_FALLBACK     = '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4' as Address;

const SafeProxyFactoryABI = [
  {
    name: 'createProxyWithNonce',
    type: 'function',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'ProxyCreation',
    type: 'event',
    inputs: [
      { indexed: false, name: 'proxy', type: 'address' },
      { indexed: false, name: 'singleton', type: 'address' },
    ],
  },
] as const;

const SafeSetupABI = [
  {
    name: 'setup',
    type: 'function',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export async function createSafeForByoMolt(
  label: string,
  ownerWallet: string,
  treasuryPrivateKey: string,
): Promise<{ safeAddress: string | null; error?: string }> {
  try {
    const account = privateKeyToAccount(treasuryPrivateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: gnosis, transport: http() });
    const walletClient = createWalletClient({ chain: gnosis, transport: http(), account });

    // Build Safe setup calldata: 1-of-1, owner = user's wallet
    const setupData = encodeFunctionData({
      abi: SafeSetupABI,
      functionName: 'setup',
      args: [
        [ownerWallet as Address],       // owners
        BigInt(1),                       // threshold
        '0x0000000000000000000000000000000000000000' as Address, // to (no delegate call)
        '0x',                            // data
        SAFE_FALLBACK,                   // fallbackHandler
        '0x0000000000000000000000000000000000000000' as Address, // paymentToken
        BigInt(0),                       // payment
        '0x0000000000000000000000000000000000000000' as Address, // paymentReceiver
      ],
    });

    // saltNonce = keccak of label+owner to get a deterministic but unique address
    const saltNonce = BigInt(keccak256(encodePacked(['string', 'address'], [label, ownerWallet as Address])));

    const hash = await walletClient.writeContract({
      address: SAFE_PROXY_FACTORY,
      abi: SafeProxyFactoryABI,
      functionName: 'createProxyWithNonce',
      args: [SAFE_SINGLETON, setupData, saltNonce],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse ProxyCreation event for Safe address
    let safeAddress: string | null = null;
    for (const log of receipt.logs) {
      try {
        const { decodeEventLog } = await import('viem');
        const decoded = decodeEventLog({ abi: SafeProxyFactoryABI, data: log.data, topics: log.topics });
        if (decoded.eventName === 'ProxyCreation') {
          safeAddress = (decoded.args as any).proxy as string;
          break;
        }
      } catch {}
    }

    if (!safeAddress) {
      return { safeAddress: null, error: 'Failed to extract Safe address from ProxyCreation event' };
    }

    return { safeAddress };
  } catch (error: any) {
    return { safeAddress: null, error: error?.message || 'Unknown error' };
  }
}
