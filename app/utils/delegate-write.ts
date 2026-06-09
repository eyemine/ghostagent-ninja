/**
 * Delegate V2 write helper — executeInAppDelegation
 *
 * Allows the cold vault wallet to grant (or revoke) ERC-721 token-level
 * delegation to a hot wallet directly inside the GhostAgent UI, without
 * the user ever leaving the site.
 *
 * Registry V2: 0x00000000000000447e69651d841bD8D104Bed493
 * Same address on Ethereum mainnet, Base, Gnosis, and all major EVM chains.
 *
 * The cold wallet must be the currently connected wallet (msg.sender).
 * Use createWalletClient with the browser injected provider (window.ethereum)
 * or with a Privy embedded wallet signer.
 */

import { createWalletClient, custom, type WalletClient, type Chain } from 'viem';
import { mainnet, gnosis, base } from 'viem/chains';

export const DELEGATE_REGISTRY_V2 = '0x00000000000000447e69651d841bD8D104Bed493' as const;

const DELEGATE_ERC721_ABI = [
  {
    inputs: [
      { name: 'to',        type: 'address'  },
      { name: 'contract_', type: 'address'  },
      { name: 'tokenId',   type: 'uint256'  },
      { name: 'rights',    type: 'bytes32'  },
      { name: 'enable',    type: 'bool'     },
    ],
    name: 'delegateERC721',
    outputs: [{ name: 'delegationHash', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export type SupportedChainName = 'ethereum' | 'gnosis' | 'base';

const CHAIN_MAP: Record<SupportedChainName, Chain> = {
  ethereum: mainnet,
  gnosis,
  base,
};

export interface DelegationParams {
  /** The hot/Farcaster wallet receiving delegation rights */
  hotWalletAddress:   string;
  /** The NFT contract address (e.g. Normies contract) */
  nftContractAddress: string;
  /** The specific token ID being delegated */
  tokenId:            bigint;
  /** Chain the NFT lives on */
  chain?:             SupportedChainName;
  /** Whether to grant (true) or revoke (false) delegation */
  enable?:            boolean;
}

export interface DelegationResult {
  success:  boolean;
  txHash?:  `0x${string}`;
  error?:   string;
}

/**
 * Execute a native delegateERC721 write via the cold wallet connected to the browser.
 * The cold wallet must be the msg.sender — it is the one granting rights.
 *
 * @param params  Delegation parameters
 * @param client  Optional pre-built WalletClient (for testing or Privy integration).
 *                If omitted, falls back to window.ethereum injection.
 */
export async function executeInAppDelegation(
  params: DelegationParams,
  client?: WalletClient,
): Promise<DelegationResult> {
  const {
    hotWalletAddress,
    nftContractAddress,
    tokenId,
    chain: chainName = 'gnosis',
    enable = true,
  } = params;

  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'Must be called in a browser context' };
    }

    const chain = CHAIN_MAP[chainName];
    const walletClient = client ?? createWalletClient({
      chain,
      transport: custom((window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum),
    });

    const [coldAccount] = await walletClient.getAddresses();
    if (!coldAccount) {
      return { success: false, error: 'No wallet account found — connect your cold wallet first' };
    }

    const txHash = await walletClient.writeContract({
      address:      DELEGATE_REGISTRY_V2,
      abi:          DELEGATE_ERC721_ABI,
      functionName: 'delegateERC721',
      account:      coldAccount,
      chain,
      args: [
        hotWalletAddress  as `0x${string}`,
        nftContractAddress as `0x${string}`,
        tokenId,
        '0x0000000000000000000000000000000000000000000000000000000000000000', // empty rights = all rights for this token
        enable,
      ],
    });

    return { success: true, txHash };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Revoke a previously granted ERC-721 delegation.
 * Convenience wrapper around executeInAppDelegation with enable=false.
 */
export async function revokeInAppDelegation(
  params: Omit<DelegationParams, 'enable'>,
  client?: WalletClient,
): Promise<DelegationResult> {
  return executeInAppDelegation({ ...params, enable: false }, client);
}
