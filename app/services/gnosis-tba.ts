/**
 * @module gnosis-tba
 * Gnosis-side ERC-6551 TBA deployment helper for legacy NFTs.
 *
 * A legacy NFT (Chonk on Base, Punk on Ethereum, etc.) gets a deterministic
 * Gnosis-side TBA that represents it on Gnosis chain. This TBA:
 *   - Is derived from (sourceChainId, nftContract, tokenId) — same result every time
 *   - Is deployed on Gnosis (chainId 100) regardless of where the NFT lives
 *   - Becomes the owner of the beacon .gno subname NFT
 *   - Becomes a signer on the agent's Gnosis Safe
 *
 * Ownership enforcement:
 *   - At molt time: server-side eth_call to source chain verifies ownerOf(tokenId)
 *   - Post-mint: whoever holds the legacy NFT controls its EOA → controls TBA → controls Safe
 *   - No manual rotation required — ERC-6551 enforces it automatically
 *
 * Standard ERC-6551 registry: 0x000000006551c19487814612e58FE06813775758
 * Deployed on Gnosis mainnet at same address (canonical cross-chain deployment).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { ERC6551_REGISTRY } from '../utils/chains';

// ─── ERC-6551 Account Implementation on Gnosis ────────────────────────────────
// MinimalERC6551Account deployed on Gnosis mainnet (chainId 100)
// Source: script/RedeployAll.s.sol — same impl used by all GNO registrars
const ERC6551_ACCOUNT_IMPL = '0x878E703A93b6e0aaD92f9907332c68fb09765697' as Address;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

// ERC-6551 registry v0.3 interface: salt is bytes32, not uint256
// Verified against deployed registry 0x000000006551c19487814612e58FE06813775758 on Gnosis
const RegistryABI = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt',           type: 'bytes32' },
      { name: 'chainId',        type: 'uint256' },
      { name: 'tokenContract',  type: 'address' },
      { name: 'tokenId',        type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'account',
    type: 'function',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt',           type: 'bytes32' },
      { name: 'chainId',        type: 'uint256' },
      { name: 'tokenContract',  type: 'address' },
      { name: 'tokenId',        type: 'uint256' },
    ],
    outputs: [{ name: 'account', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LegacyNft {
  sourceChainId: number;    // chain where the NFT lives (e.g. 8453 for Base, 1 for Ethereum)
  contractAddress: Address; // NFT contract address on source chain
  tokenId: bigint;          // token ID
  salt?: `0x${string}`;     // bytes32 salt, default 0x000...000
}

export interface TbaResult {
  tbaAddress: Address;
  alreadyDeployed: boolean;
  deployTxHash?: `0x${string}`;
}

// ─── Gnosis public client ─────────────────────────────────────────────────────

function gnosisPublic(): PublicClient {
  return createPublicClient({ chain: gnosis, transport: http() }) as PublicClient;
}

// ─── Compute deterministic TBA address (view call, no tx needed) ─────────────

const ZERO_SALT = ('0x' + '00'.repeat(32)) as `0x${string}`;

export async function computeGnosisTba(nft: LegacyNft): Promise<Address> {
  const client = gnosisPublic();
  const address = await client.readContract({
    address: ERC6551_REGISTRY as Address,
    abi: RegistryABI,
    functionName: 'account',
    args: [
      ERC6551_ACCOUNT_IMPL,
      nft.salt ?? ZERO_SALT,
      BigInt(nft.sourceChainId),
      nft.contractAddress,
      nft.tokenId,
    ],
  });
  return address as Address;
}

// ─── Check if TBA is already deployed ────────────────────────────────────────

export async function isTbaDeployed(tbaAddress: Address): Promise<boolean> {
  const client = gnosisPublic();
  const code = await client.getBytecode({ address: tbaAddress });
  return !!code && code !== '0x';
}

// ─── Deploy TBA on Gnosis (treasury pays gas) ─────────────────────────────────

export async function deployGnosisTba(
  nft: LegacyNft,
  walletClient: WalletClient,
): Promise<TbaResult> {
  const tbaAddress = await computeGnosisTba(nft);
  const deployed   = await isTbaDeployed(tbaAddress);

  if (deployed) {
    return { tbaAddress, alreadyDeployed: true };
  }

  const txHash = await walletClient.writeContract({
    address: ERC6551_REGISTRY as Address,
    abi:     RegistryABI,
    functionName: 'createAccount',
    args: [
      ERC6551_ACCOUNT_IMPL,
      nft.salt ?? ZERO_SALT,
      BigInt(nft.sourceChainId),
      nft.contractAddress,
      nft.tokenId,
    ],
    chain: gnosis,
    account: walletClient.account!,
  });

  return { tbaAddress, alreadyDeployed: false, deployTxHash: txHash };
}

// ─── Verify legacy NFT ownership on source chain (server-side) ───────────────
// Used at molt time only — not enforced on-chain after initial deployment.

const SOURCE_CHAIN_RPC: Record<number, string> = {
  1:    'https://eth.drpc.org',           // Ethereum mainnet
  8453: 'https://mainnet.base.org',       // Base
  137:  'https://polygon.drpc.org',       // Polygon
  10:   'https://optimism.drpc.org',      // Optimism
};

export async function verifyLegacyNftOwnership(
  nft: LegacyNft,
  claimedOwner: Address,
): Promise<{ verified: boolean; actualOwner: Address | null }> {
  const rpc = SOURCE_CHAIN_RPC[nft.sourceChainId];
  if (!rpc) {
    return { verified: false, actualOwner: null };
  }

  try {
    // ownerOf(uint256) selector = 0x6352211e
    const tokenIdHex = nft.tokenId.toString(16).padStart(64, '0');
    const calldata   = '0x6352211e' + tokenIdHex;

    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_call',
        params: [{ to: nft.contractAddress, data: calldata }, 'latest'],
      }),
    });

    const data = await res.json() as { result?: string; error?: unknown };
    if (!data.result || data.result === '0x') {
      return { verified: false, actualOwner: null };
    }

    const actualOwner = ('0x' + data.result.slice(26)).toLowerCase() as Address;
    return {
      verified: actualOwner === claimedOwner.toLowerCase(),
      actualOwner,
    };
  } catch {
    return { verified: false, actualOwner: null };
  }
}

// ─── Full molt-prep: verify ownership + compute/deploy TBA ───────────────────

export interface MoltPrepParams {
  nft: LegacyNft;
  claimedOwner: Address;
  walletClient: WalletClient; // treasury signer pays deployment gas
}

export interface MoltPrepResult {
  verified:   boolean;
  tbaAddress: Address | null;
  deployed:   boolean;
  deployTxHash?: `0x${string}`;
  error?: string;
}

export async function prepareMolt(params: MoltPrepParams): Promise<MoltPrepResult> {
  // Step 1: verify ownership on source chain
  const ownership = await verifyLegacyNftOwnership(params.nft, params.claimedOwner);
  if (!ownership.verified) {
    return {
      verified:   false,
      tbaAddress: null,
      deployed:   false,
      error: ownership.actualOwner
        ? `${params.claimedOwner} does not own token #${params.nft.tokenId} — owner is ${ownership.actualOwner}`
        : `Token #${params.nft.tokenId} not found on chain ${params.nft.sourceChainId}`,
    };
  }

  // Step 2: compute + deploy Gnosis TBA (idempotent — skips if already deployed)
  try {
    const tbaResult = await deployGnosisTba(params.nft, params.walletClient);
    return {
      verified:     true,
      tbaAddress:   tbaResult.tbaAddress,
      deployed:     !tbaResult.alreadyDeployed,
      deployTxHash: tbaResult.deployTxHash,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'TBA deployment failed';
    return { verified: true, tbaAddress: null, deployed: false, error: message };
  }
}
