/// @module cow-dex
/// CoW Protocol DEX execution on Gnosis mainnet (chain 100).
///
/// Flow:
///   1. Agent signs an EIP-712 TradeIntent (our schema)
///   2. This module translates it into a CoW Protocol order
///   3. The order is submitted to the CoW API orderbook
///   4. A TradeRecord is emitted for the performance tracker
///
/// CoW Protocol is the canonical DEX for Gnosis:
///   - MEV-protected
///   - Gasless for ERC-20→ERC-20 swaps (solvers pay gas)
///   - Native WXDAI / USDC / GNO pairs with deep liquidity
///   - Order hash is a valid on-chain audit artifact
///
/// References:
///   CoW API: https://api.cow.fi/gnosis/v1
///   CoW Explorer: https://explorer.cow.fi/gc

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { WXDAI, USDC_GNOSIS, GNO_TOKEN } from './trade-intent';

// ─── Constants ────────────────────────────────────────────────────────────────

export const COW_API_BASE    = 'https://api.cow.fi/gnosis/v1';
export const COW_VAULT_RELAYER: Address = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';
// ^ The CoW Protocol contract that must be approved to spend tokenIn

export const COW_APP_DATA_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CowOrderKind = 'sell' | 'buy';
export type CowOrderStatus = 'presignaturePending' | 'open' | 'fulfilled' | 'cancelled' | 'expired';

export interface CowOrder {
  sellToken:          Address;
  buyToken:           Address;
  receiver:           Address;
  sellAmount:         string;    // wei string
  buyAmount:          string;    // minimum buy amount (wei string)
  validTo:            number;    // unix timestamp
  appData:            string;    // bytes32 hex
  feeAmount:          string;    // wei string (0 for gasless)
  kind:               CowOrderKind;
  partiallyFillable:  boolean;
  signingScheme:      'eip712' | 'ethsign' | 'presign' | 'eip1271';
  signature:          string;    // hex
  from:               Address;
}

export interface CowOrderCreation extends CowOrder {
  quoteId?: number;
}

export interface CowQuote {
  quote: {
    sellToken:   Address;
    buyToken:    Address;
    receiver:    Address;
    sellAmount:  string;
    buyAmount:   string;
    validTo:     number;
    feeAmount:   string;
    kind:        CowOrderKind;
    appData:     string;
    partiallyFillable: boolean;
  };
  from:    Address;
  quoteId: number;
  expiration: string;
}

export interface CowOrderResult {
  uid:       string;   // CoW order UID (bytes encoded)
  explorerUrl: string;
}

export interface DexTradeResult {
  ok:           boolean;
  orderUid?:    string;
  explorerUrl?: string;
  txHash?:      string;
  error?:       string;
  /** Raw CoW quote for reference / audit */
  quote?:       CowQuote;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export interface TokenInfo {
  symbol:   string;
  address:  Address;
  decimals: number;
}

export const GNOSIS_TOKENS: Record<string, TokenInfo> = {
  WXDAI: { symbol: 'WXDAI', address: WXDAI,       decimals: 18 },
  USDC:  { symbol: 'USDC',  address: USDC_GNOSIS, decimals: 6  },
  GNO:   { symbol: 'GNO',   address: GNO_TOKEN,   decimals: 18 },
};

export function tokenByAddress(addr: string): TokenInfo | undefined {
  return Object.values(GNOSIS_TOKENS).find(
    t => t.address.toLowerCase() === addr.toLowerCase()
  );
}

// ─── CoW API: get a price quote ───────────────────────────────────────────────

export interface QuoteRequest {
  sellToken:  Address;
  buyToken:   Address;
  from:       Address;
  receiver:   Address;
  sellAmountBeforeFee: string;   // wei string
  kind:       CowOrderKind;
  appData?:   string;
}

export async function getCowQuote(req: QuoteRequest): Promise<CowQuote> {
  const body = {
    sellToken:             req.sellToken,
    buyToken:              req.buyToken,
    from:                  req.from,
    receiver:              req.receiver ?? req.from,
    sellAmountBeforeFee:   req.sellAmountBeforeFee,
    kind:                  req.kind ?? 'sell',
    appData:               req.appData ?? COW_APP_DATA_HASH,
    appDataHash:           req.appData ?? COW_APP_DATA_HASH,
    partiallyFillable:     false,
    signingScheme:         'eip1271',
  };

  const res = await fetch(`${COW_API_BASE}/quote`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CoW quote failed ${res.status}: ${text}`);
  }

  return res.json() as Promise<CowQuote>;
}

// ─── CoW API: submit an order ─────────────────────────────────────────────────

export async function submitCowOrder(order: CowOrderCreation): Promise<CowOrderResult> {
  const res = await fetch(`${COW_API_BASE}/orders`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(order),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CoW order submit failed ${res.status}: ${text}`);
  }

  const uid = (await res.json()) as string;
  return {
    uid,
    explorerUrl: `https://explorer.cow.fi/gc/orders/${uid}`,
  };
}

// ─── CoW API: poll order status ───────────────────────────────────────────────

export interface CowOrderStatusResponse {
  uid:       string;
  status:    CowOrderStatus;
  txHash?:   string;
  executedSellAmount?: string;
  executedBuyAmount?:  string;
}

export async function getCowOrderStatus(uid: string): Promise<CowOrderStatusResponse> {
  const res = await fetch(`${COW_API_BASE}/orders/${uid}`);
  if (!res.ok) throw new Error(`CoW order status ${res.status}`);
  return res.json() as Promise<CowOrderStatusResponse>;
}

// ─── Main: execute a trade via CoW + TradeIntent ─────────────────────────────

export interface ExecuteTradeParams {
  /** The signing wallet's address (Gnosis Safe) */
  from:         Address;
  /** receiver of bought tokens — usually same as `from` */
  receiver?:    Address;
  sellToken:    Address;
  buyToken:     Address;
  /** Raw sell amount in smallest unit (wei / base unit) */
  sellAmount:   string;
  /** Minimum buy amount — slippage guard (wei / base unit) */
  minBuyAmount?: string;
  /** EIP-712 TradeIntent signature from the agent's wallet */
  tradeIntentSig: Hex;
  /** Optional: pre-fetched quote to avoid double-quoting */
  quote?:       CowQuote;
  /** CoW order kind — default 'sell' */
  kind?:        CowOrderKind;
}

/**
 * Execute a trade on CoW Protocol using a pre-signed EIP-712 TradeIntent.
 *
 * The flow:
 *   1. Get a CoW quote (price + fee)
 *   2. Build a CoW order from the quote
 *   3. Sign the order via EIP-1271 (Safe is the signer)
 *   4. Submit to CoW orderbook
 *
 * For the hackathon demo: signing scheme is 'presign' — Safe signs on-chain
 * after order submission. This avoids needing an active wallet session for
 * the agent's Safe, while still producing an auditable on-chain proof.
 */
export async function executeTrade(params: ExecuteTradeParams): Promise<DexTradeResult> {
  try {
    const receiver = params.receiver ?? params.from;

    // ── Step 1: get quote ──────────────────────────────────────────────────────
    const quote = params.quote ?? await getCowQuote({
      sellToken:           params.sellToken,
      buyToken:            params.buyToken,
      from:                params.from,
      receiver,
      sellAmountBeforeFee: params.sellAmount,
      kind:                params.kind ?? 'sell',
    });

    // ── Step 2: build order ────────────────────────────────────────────────────
    // Use quote amounts — fee is baked in by CoW
    const order: CowOrderCreation = {
      sellToken:         params.sellToken,
      buyToken:          params.buyToken,
      receiver,
      sellAmount:        quote.quote.sellAmount,
      buyAmount:         params.minBuyAmount ?? quote.quote.buyAmount,
      validTo:           quote.quote.validTo,
      appData:           COW_APP_DATA_HASH,
      feeAmount:         quote.quote.feeAmount,
      kind:              params.kind ?? 'sell',
      partiallyFillable: false,
      signingScheme:     'presign',   // Safe pre-signs on-chain — no off-chain key needed
      signature:         params.from, // For presign, signature = signer address
      from:              params.from,
      quoteId:           quote.quoteId,
    };

    // ── Step 3: submit order ───────────────────────────────────────────────────
    const result = await submitCowOrder(order);

    return {
      ok:          true,
      orderUid:    result.uid,
      explorerUrl: result.explorerUrl,
      quote,
    };
  } catch (e) {
    return {
      ok:    false,
      error: String(e),
    };
  }
}

// ─── TradeIntent → TradeRecord bridge ────────────────────────────────────────

import type { TradeRecord } from './performance-tracker';

/**
 * Convert a completed CoW order into a TradeRecord for the performance tracker.
 * Call this after polling the order to `fulfilled` status.
 */
export function cowOrderToTradeRecord(params: {
  agentName:    string;
  orderUid:     string;
  sellToken:    TokenInfo;
  buyToken:     TokenInfo;
  executedSellAmount: string;
  executedBuyAmount:  string;
  entryPriceUsd: number;  // price of sellToken in USD at order time
  exitPriceUsd:  number;  // price of buyToken in USD at fill time
  txHash?:       string;
}): TradeRecord {
  const size      = Number(params.executedSellAmount) / 10 ** params.sellToken.decimals;
  const received  = Number(params.executedBuyAmount)  / 10 ** params.buyToken.decimals;
  const entryVal  = size     * params.entryPriceUsd;
  const exitVal   = received * params.exitPriceUsd;
  const pnl       = exitVal - entryVal;
  const pnlPct    = entryVal > 0 ? pnl / entryVal : 0;

  return {
    id:         params.orderUid,
    agentName:  params.agentName,
    market:     `${params.sellToken.symbol}/${params.buyToken.symbol}`,
    side:       'sell',
    size:       entryVal,
    entryPrice: params.entryPriceUsd,
    exitPrice:  params.exitPriceUsd,
    pnl,
    pnlPct,
    timestamp:  Date.now(),
    txHash:     params.txHash,
  };
}

// ─── Price oracle (simple CoW price) ─────────────────────────────────────────

/**
 * Get the current CoW Protocol price for a sell → WXDAI quote.
 * Used for USD valuation in the performance tracker.
 * Returns price in xDAI per 1 unit of sellToken.
 */
export async function getTokenPriceInXdai(
  tokenAddress: Address,
  safeAddress:  Address,
  sellAmount:   string = (10n ** 18n).toString(),
): Promise<number> {
  if (tokenAddress.toLowerCase() === WXDAI.toLowerCase()) return 1;

  try {
    const quote = await getCowQuote({
      sellToken:           tokenAddress,
      buyToken:            WXDAI,
      from:                safeAddress,
      receiver:            safeAddress,
      sellAmountBeforeFee: sellAmount,
      kind:                'sell',
    });

    const inUnits  = Number(sellAmount)                 / 1e18;
    const outUnits = Number(quote.quote.buyAmount)      / 1e18;
    return outUnits / inUnits;
  } catch {
    return 0;
  }
}
