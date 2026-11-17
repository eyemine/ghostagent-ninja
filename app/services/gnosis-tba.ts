/**
 * @module gnosis-tba
 * Canonical Tokenbound V3 accounts for NFTs that actually live on Gnosis.
 * Cross-chain BYO NFTs must first be paired with a Gnosis key NFT held outside
 * the Safe. A source-chain ownership check cannot make a mirror account usable.
 *
 * Standard ERC-6551 registry: 0x000000006551c19487814612e58FE06813775758
 * Deployed on Gnosis mainnet at same address (canonical cross-chain deployment).
 */

import {
  createPublicClient,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { ERC6551_REGISTRY } from '../utils/chains';

// ─── ERC-6551 Account Implementation on Gnosis ────────────────────────────────
export const TOKENBOUND_V3_PROXY = '0x55266d75D1a14E4572138116aF39863Ed6596E7F' as const;
export const TOKENBOUND_V3_IMPLEMENTATION = '0x41C8f39463A868d3A88af00cd0fe7102F30E44eC' as const;
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
const AccountABI = parseAbi([
  'function initialize(address implementation)',
  'function token() view returns (uint256,address,uint256)',
  'function owner() view returns (address)',
  'function ownerOf(uint256) view returns (address)',
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)',
]);

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
  initializeTxHash?: `0x${string}`;
  nftOwner: Address;
}

// ─── Gnosis public client ─────────────────────────────────────────────────────

function gnosisPublic(): PublicClient {
  return createPublicClient({ chain: gnosis, transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com') }) as PublicClient;
}

function requireLocalKey(nft: LegacyNft) {
  if (nft.sourceChainId !== gnosis.id) {
    throw new Error('A Gnosis Safe requires a Gnosis key NFT. Cross-chain mirror TBAs cannot verify NFT ownership.');
  }
}

// ─── Compute deterministic TBA address (view call, no tx needed) ─────────────

const ZERO_SALT = ('0x' + '00'.repeat(32)) as `0x${string}`;

export async function computeGnosisTba(nft: LegacyNft): Promise<Address> {
  requireLocalKey(nft);
  const client = gnosisPublic();
  const address = await client.readContract({
    address: ERC6551_REGISTRY as Address,
    abi: RegistryABI,
    functionName: 'account',
    args: [
      TOKENBOUND_V3_PROXY,
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
  requireLocalKey(nft);
  if (!walletClient.account || await walletClient.getChainId() !== gnosis.id) {
    throw new Error('TBA deployment requires a signer on Gnosis.');
  }
  const client = gnosisPublic();
  for (const address of [TOKENBOUND_V3_PROXY, TOKENBOUND_V3_IMPLEMENTATION]) {
    const code = await client.getCode({ address });
    if (!code || code === '0x') throw new Error(`Missing canonical Tokenbound contract: ${address}`);
  }
  const nftOwner = await client.readContract({
    address: nft.contractAddress, abi: AccountABI, functionName: 'ownerOf', args: [nft.tokenId],
  });
  if (nftOwner === zeroAddress) throw new Error('The Gnosis key NFT has no owner.');
  const tbaAddress = await computeGnosisTba(nft);
  const deployed   = await isTbaDeployed(tbaAddress);
  if (nftOwner.toLowerCase() === tbaAddress.toLowerCase()) {
    throw new Error('The key NFT cannot be held by its own account.');
  }
  let deployTxHash: `0x${string}` | undefined;
  let initializeTxHash: `0x${string}` | undefined;
  if (!deployed) {
    deployTxHash = await walletClient.writeContract({
      address: ERC6551_REGISTRY as Address, abi: RegistryABI, functionName: 'createAccount',
      args: [TOKENBOUND_V3_PROXY, nft.salt ?? ZERO_SALT, BigInt(gnosis.id), nft.contractAddress, nft.tokenId],
      chain: gnosis, account: walletClient.account,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: deployTxHash });
    if (receipt.status !== 'success') throw new Error(`TBA deployment reverted: ${deployTxHash}`);
  }
  const slot = await client.getStorageAt({ address: tbaAddress, slot: IMPLEMENTATION_SLOT });
  if (!slot || BigInt(slot) === 0n) {
    initializeTxHash = await walletClient.writeContract({
      address: tbaAddress, abi: AccountABI, functionName: 'initialize',
      args: [TOKENBOUND_V3_IMPLEMENTATION], chain: gnosis, account: walletClient.account,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: initializeTxHash });
    if (receipt.status !== 'success') throw new Error(`TBA initialization reverted: ${initializeTxHash}`);
  }
  const initializedSlot = await client.getStorageAt({ address: tbaAddress, slot: IMPLEMENTATION_SLOT });
  if (initializedSlot?.slice(-40).toLowerCase() !== TOKENBOUND_V3_IMPLEMENTATION.slice(2).toLowerCase()) {
    throw new Error('TBA implementation does not match the canonical V3 implementation.');
  }
  const token = await client.readContract({ address: tbaAddress, abi: AccountABI, functionName: 'token' });
  const owner = await client.readContract({ address: tbaAddress, abi: AccountABI, functionName: 'owner' });
  if (token[0] !== 100n || token[1].toLowerCase() !== nft.contractAddress.toLowerCase() ||
      token[2] !== nft.tokenId || owner.toLowerCase() !== nftOwner.toLowerCase()) {
    throw new Error('TBA binding or owner verification failed.');
  }
  // A successful read of token()/owner() alone does not establish execution.
  // This eth_call uses the NFT owner's sender context; no transaction is sent.
  await client.simulateContract({
    address: tbaAddress, abi: AccountABI, functionName: 'execute',
    args: [nftOwner, 0n, '0x', 0], account: nftOwner,
  });
  return { tbaAddress, alreadyDeployed: deployed, deployTxHash, initializeTxHash, nftOwner };
}

// ─── Verify legacy NFT ownership on source chain (server-side) ───────────────
// Used at molt time only — not enforced on-chain after initial deployment.

const SOURCE_CHAIN_RPC: Record<number, string> = {
  100:  'https://rpc.gnosischain.com',
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
    return { verified: false, tbaAddress: null, deployed: false, error: message };
  }
}
