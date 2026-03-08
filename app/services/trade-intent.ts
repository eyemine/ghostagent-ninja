/// EIP-712 TradeIntent typed data signing
/// Used for hackathon Risk Router submission and ERC-8004 validation artifacts.
///
/// TradeIntent: a signed order for a swap/position submitted to the Risk Router.
/// The signature proves the agent authorised the trade without revealing the key.

import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  type Hex,
  type Address,
  type WalletClient,
} from 'viem';
import { gnosis } from 'viem/chains';

// ─── EIP-712 Domain ───────────────────────────────────────────────────────────

export const TRADE_INTENT_DOMAIN = {
  name:              'GhostAgent TradeIntent',
  version:           '1',
  chainId:           100,   // Gnosis mainnet
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
  // ^ Replace with deployed RiskRouter address once available from hackathon
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TradeDirection = 'buy' | 'sell';

export interface TradeIntent {
  agentId:      bigint;   // ERC-8004 agentId
  agentWallet:  Address;  // agent's paying wallet
  tokenIn:      Address;  // token being spent
  tokenOut:     Address;  // token being received
  amountIn:     bigint;   // amount in (tokenIn decimals)
  minAmountOut: bigint;   // minimum acceptable out (slippage guard)
  deadline:     bigint;   // unix timestamp
  nonce:        bigint;   // replay protection
  strategyTag:  string;   // e.g. "yield-arb", "rebalance", "stop-loss"
}

export const TRADE_INTENT_TYPE = [
  { name: 'agentId',      type: 'uint256' },
  { name: 'agentWallet',  type: 'address' },
  { name: 'tokenIn',      type: 'address' },
  { name: 'tokenOut',     type: 'address' },
  { name: 'amountIn',     type: 'uint256' },
  { name: 'minAmountOut', type: 'uint256' },
  { name: 'deadline',     type: 'uint256' },
  { name: 'nonce',        type: 'uint256' },
  { name: 'strategyTag',  type: 'string'  },
] as const;

export const TRADE_INTENT_TYPES = {
  TradeIntent: TRADE_INTENT_TYPE,
} as const;

// ─── Signing ──────────────────────────────────────────────────────────────────

/**
 * Sign a TradeIntent via EIP-712 using the agent's wallet.
 * Works with EOA wallets and ERC-1271 smart contract wallets (Gnosis Safe).
 */
export async function signTradeIntent(
  walletClient: WalletClient,
  intent: TradeIntent,
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.signTypedData({
    account,
    domain:      TRADE_INTENT_DOMAIN,
    types:       TRADE_INTENT_TYPES,
    primaryType: 'TradeIntent',
    message:     intent,
  });
}

// ─── Hash ─────────────────────────────────────────────────────────────────────

/**
 * Compute the EIP-712 struct hash of a TradeIntent.
 * Used as requestHash when submitting a validation request to ERC-8004.
 */
export function hashTradeIntent(intent: TradeIntent): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: 'agentId',         type: 'uint256' },
      { name: 'agentWallet',     type: 'address' },
      { name: 'tokenIn',         type: 'address' },
      { name: 'tokenOut',        type: 'address' },
      { name: 'amountIn',        type: 'uint256' },
      { name: 'minAmountOut',    type: 'uint256' },
      { name: 'deadline',        type: 'uint256' },
      { name: 'nonce',           type: 'uint256' },
      { name: 'strategyTagHash', type: 'bytes32' },
    ],
    [
      intent.agentId,
      intent.agentWallet,
      intent.tokenIn,
      intent.tokenOut,
      intent.amountIn,
      intent.minAmountOut,
      intent.deadline,
      intent.nonce,
      keccak256(toBytes(intent.strategyTag)),
    ],
  );
  return keccak256(encoded);
}

// ─── Validation artifact ──────────────────────────────────────────────────────

export interface SerializedTradeIntent {
  agentId:      string;
  agentWallet:  string;
  tokenIn:      string;
  tokenOut:     string;
  amountIn:     string;
  minAmountOut: string;
  deadline:     string;
  nonce:        string;
  strategyTag:  string;
}

export interface TradeIntentArtifact {
  type:       'trade-intent-v1';
  agentId:    number;
  agentName:  string;
  intent:     SerializedTradeIntent;
  signature:  string;
  intentHash: string;
  createdAt:  number;
}

/**
 * Build the off-chain JSON artifact that gets pinned to IPFS
 * and referenced as requestURI in the ERC-8004 Validation Registry.
 */
export function buildTradeIntentArtifact(
  agentName: string,
  intent: TradeIntent,
  signature: Hex,
): TradeIntentArtifact {
  return {
    type:      'trade-intent-v1',
    agentId:   Number(intent.agentId),
    agentName,
    intent: {
      agentId:      intent.agentId.toString(),
      agentWallet:  intent.agentWallet,
      tokenIn:      intent.tokenIn,
      tokenOut:     intent.tokenOut,
      amountIn:     intent.amountIn.toString(),
      minAmountOut: intent.minAmountOut.toString(),
      deadline:     intent.deadline.toString(),
      nonce:        intent.nonce.toString(),
      strategyTag:  intent.strategyTag,
    },
    signature,
    intentHash: hashTradeIntent(intent),
    createdAt:  Date.now(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a deadline 30 minutes from now */
export function deadlineInMinutes(minutes = 30): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}

/** xDAI address on Gnosis — used as native-equiv token */
export const WXDAI: Address  = '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d';
export const USDC_GNOSIS: Address = '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83';
export const GNO_TOKEN: Address   = '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb';
