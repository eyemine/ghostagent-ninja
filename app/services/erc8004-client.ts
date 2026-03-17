/// ERC-8004 viem client — Identity, Reputation, Validation registries
/// Targets Gnosis mainnet (chainId 100) where GhostAgents live.
/// All three registry contracts share the same addresses across every chain.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { gnosis } from 'viem/chains';
import { GNOSIS_ADDRESSES } from './erc8004-registration';

// ─── ABIs (minimal — only functions we call) ─────────────────────────────────

const IdentityRegistryABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setAgentURI',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'agentURI', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'tokenURI',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'AgentRegistered',
    type: 'event',
    inputs: [
      { indexed: true, name: 'agentId', type: 'uint256' },
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: false, name: 'agentURI', type: 'string' },
    ],
  },
] as const;

const ReputationRegistryABI = [
  {
    name: 'giveFeedback',
    type: 'function',
    inputs: [
      { name: 'agentId',       type: 'uint256' },
      { name: 'value',         type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1',          type: 'string' },
      { name: 'tag2',          type: 'string' },
      { name: 'endpoint',      type: 'string' },
      { name: 'feedbackURI',   type: 'string' },
      { name: 'feedbackHash',  type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getSummary',
    type: 'function',
    inputs: [
      { name: 'agentId',           type: 'uint256' },
      { name: 'validatorAddresses', type: 'address[]' },
      { name: 'tag',               type: 'string' },
    ],
    outputs: [
      { name: 'count',           type: 'uint64' },
      { name: 'averageResponse', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
] as const;

const ValidationRegistryABI = [
  {
    name: 'validationRequest',
    type: 'function',
    inputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',         type: 'uint256' },
      { name: 'requestURI',      type: 'string' },
      { name: 'requestHash',     type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'validationResponse',
    type: 'function',
    inputs: [
      { name: 'requestHash',  type: 'bytes32' },
      { name: 'response',     type: 'uint8' },
      { name: 'responseURI',  type: 'string' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag',          type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getValidationStatus',
    type: 'function',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId',         type: 'uint256' },
      { name: 'response',        type: 'uint8' },
      { name: 'responseHash',    type: 'bytes32' },
      { name: 'tag',             type: 'string' },
      { name: 'lastUpdate',      type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getSummary',
    type: 'function',
    inputs: [
      { name: 'agentId',           type: 'uint256' },
      { name: 'validatorAddresses', type: 'address[]' },
      { name: 'tag',               type: 'string' },
    ],
    outputs: [
      { name: 'count',           type: 'uint64' },
      { name: 'averageResponse', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** keccak256 hash of a string payload — used as requestHash / feedbackHash */
export function hashPayload(payload: string): Hex {
  return keccak256(toBytes(payload));
}

/** Zero bytes32 — used when hash is not required (e.g. IPFS URIs) */
export const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ─── Read-only client (server-side safe) ─────────────────────────────────────

export function getGnosisPublicClient(): PublicClient {
  return createPublicClient({
    chain: gnosis,
    transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC ?? 'https://rpc.gnosischain.com'),
  }) as PublicClient;
}

// ─── Identity Registry ────────────────────────────────────────────────────────

export async function getAgentOwner(agentId: bigint): Promise<Address> {
  const client = getGnosisPublicClient();
  return client.readContract({
    address: GNOSIS_ADDRESSES.identityRegistry,
    abi: IdentityRegistryABI,
    functionName: 'ownerOf',
    args: [agentId],
  });
}

export async function getAgentURI(agentId: bigint): Promise<string> {
  const client = getGnosisPublicClient();
  return client.readContract({
    address: GNOSIS_ADDRESSES.identityRegistry,
    abi: IdentityRegistryABI,
    functionName: 'tokenURI',
    args: [agentId],
  });
}

export async function getTotalAgents(): Promise<bigint> {
  const client = getGnosisPublicClient();
  return client.readContract({
    address: GNOSIS_ADDRESSES.identityRegistry,
    abi: IdentityRegistryABI,
    functionName: 'totalSupply',
    args: [],
  });
}

/**
 * Register a new agent in the Identity Registry.
 * Returns the tx hash; caller must wait for receipt + parse AgentRegistered event
 * to get the agentId.
 */
export async function registerAgent(
  walletClient: WalletClient,
  agentURI: string,
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.writeContract({
    address: GNOSIS_ADDRESSES.identityRegistry,
    abi: IdentityRegistryABI,
    functionName: 'register',
    args: [agentURI],
    account,
    chain: gnosis,
  });
}

/**
 * Update the agentURI for an existing agent (owner only).
 */
export async function setAgentURI(
  walletClient: WalletClient,
  agentId: bigint,
  agentURI: string,
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.writeContract({
    address: GNOSIS_ADDRESSES.identityRegistry,
    abi: IdentityRegistryABI,
    functionName: 'setAgentURI',
    args: [agentId, agentURI],
    account,
    chain: gnosis,
  });
}

// ─── Reputation Registry ──────────────────────────────────────────────────────

/**
 * Submit a reputation feedback signal for an agent.
 * value is a fixed-point integer; e.g. 95 with valueDecimals=0 → 95/100 score.
 */
export async function giveFeedback(
  walletClient: WalletClient,
  params: {
    agentId: bigint;
    value: bigint;
    valueDecimals: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    feedbackURI?: string;
    feedbackHash?: Hex;
  },
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.writeContract({
    address: GNOSIS_ADDRESSES.reputationRegistry,
    abi: ReputationRegistryABI,
    functionName: 'giveFeedback',
    args: [
      params.agentId,
      params.value,
      params.valueDecimals,
      params.tag1       ?? '',
      params.tag2       ?? '',
      params.endpoint   ?? '',
      params.feedbackURI ?? '',
      params.feedbackHash ?? ZERO_HASH,
    ],
    account,
    chain: gnosis,
  });
}

export async function getReputationSummary(
  agentId: bigint,
  tag = '',
): Promise<{ count: bigint; averageResponse: number }> {
  const client = getGnosisPublicClient();
  const [count, averageResponse] = await client.readContract({
    address: GNOSIS_ADDRESSES.reputationRegistry,
    abi: ReputationRegistryABI,
    functionName: 'getSummary',
    args: [agentId, [], tag],
  });
  return { count, averageResponse };
}

// ─── Validation Registry ──────────────────────────────────────────────────────

/**
 * Emit a validation request for an agent action (trade intent, audit checkpoint, etc.)
 * requestURI → IPFS/Lighthouse URL of the request payload JSON.
 * requestHash → keccak256 of that payload (use hashPayload()).
 */
export async function requestValidation(
  walletClient: WalletClient,
  params: {
    validatorAddress: Address;
    agentId: bigint;
    requestURI: string;
    requestHash: Hex;
  },
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.writeContract({
    address: GNOSIS_ADDRESSES.validationRegistry,
    abi: ValidationRegistryABI,
    functionName: 'validationRequest',
    args: [params.validatorAddress, params.agentId, params.requestURI, params.requestHash],
    account,
    chain: gnosis,
  });
}

/**
 * Post a validation response on behalf of a validator (notapaperclip.red / treasury wallet).
 * response is 0–100 (use alignment score directly).
 * responseURI → URL of the off-chain evidence (KV permalink or notapaperclip.red URL).
 */
export async function postValidationResponse(
  walletClient: WalletClient,
  params: {
    requestHash:      Hex;
    response:         number;   // 0–100
    responseURI?:     string;
    responseHash?:    Hex;
    tag?:             string;
    registryAddress?: Address;  // override for non-Gnosis chains
    chain?:           Parameters<typeof walletClient.writeContract>[0]['chain'];
  },
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.writeContract({
    address:      params.registryAddress ?? GNOSIS_ADDRESSES.validationRegistry,
    abi:          ValidationRegistryABI,
    functionName: 'validationResponse',
    args: [
      params.requestHash,
      params.response,
      params.responseURI  ?? '',
      params.responseHash ?? ZERO_HASH,
      params.tag          ?? 'alignment',
    ],
    account,
    chain: params.chain ?? gnosis,
  });
}

export async function getValidationStatus(requestHash: Hex): Promise<{
  validatorAddress: Address;
  agentId: bigint;
  response: number;
  responseHash: Hex;
  tag: string;
  lastUpdate: bigint;
}> {
  const client = getGnosisPublicClient();
  const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
    await client.readContract({
      address: GNOSIS_ADDRESSES.validationRegistry,
      abi: ValidationRegistryABI,
      functionName: 'getValidationStatus',
      args: [requestHash],
    });
  return { validatorAddress, agentId, response, responseHash, tag, lastUpdate };
}
