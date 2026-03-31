// PRISM API client for trading agents
// Sign up: https://prismapi.ai/ — redeem code: LABLAB
// Docs: https://api.prismapi.ai/

const PRISM_BASE_URL = 'https://api.prismapi.ai';

// Environment variable for API key (store in .env.local, never commit)
const PRISM_API_KEY = process.env.PRISM_API_KEY || process.env.NEXT_PUBLIC_PRISM_API_KEY || '';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrismAsset {
  symbol: string;
  name: string;
  type: 'crypto' | 'stock' | 'etf' | 'forex';
  price?: number;
  currency: string;
  updatedAt: string;
}

export interface PrismPrice {
  symbol: string;
  price: number;
  currency: string;
  timestamp: string;
  source: string;
}

export interface PrismSignal {
  symbol: string;
  signal: 'buy' | 'sell' | 'hold' | 'neutral';
  confidence: number; // 0-1
  timeframe: string; // e.g. "1h", "1d"
  indicators: string[];
  generatedAt: string;
}

export interface PrismRiskMetrics {
  symbol: string;
  volatility: number; // annualized
  var95: number; // Value at Risk 95%
  beta?: number; // vs market
  sharpeRatio?: number;
  maxDrawdown?: number;
  updatedAt: string;
}

export interface PrismTradeIntent {
  agentName: string;
  agentId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  amount: number;
  signal: PrismSignal;
  riskScore: number;
  timestamp: string;
  beaconCid?: string; // pinned audit trail
}

// ─────────────────────────────────────────────────────────────────────────────
// Core API Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve any asset symbol to canonical PRISM identity
 * GET /resolve/{asset}
 */
export async function prismResolve(asset: string): Promise<PrismAsset | null> {
  try {
    const res = await fetch(`${PRISM_BASE_URL}/resolve/${encodeURIComponent(asset)}`, {
      headers: { 'X-API-Key': PRISM_API_KEY },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PrismAsset;
  } catch {
    return null;
  }
}

/**
 * Get real-time price for crypto asset
 * GET /crypto/{symbol}/price
 */
export async function prismCryptoPrice(symbol: string): Promise<PrismPrice | null> {
  try {
    const res = await fetch(`${PRISM_BASE_URL}/crypto/${encodeURIComponent(symbol.toUpperCase())}/price`, {
      headers: { 'X-API-Key': PRISM_API_KEY },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PrismPrice;
  } catch {
    return null;
  }
}

/**
 * Get AI trading signal for symbol
 * GET /signals/{symbol}
 */
export async function prismSignal(symbol: string): Promise<PrismSignal | null> {
  try {
    const res = await fetch(`${PRISM_BASE_URL}/signals/${encodeURIComponent(symbol.toUpperCase())}`, {
      headers: { 'X-API-Key': PRISM_API_KEY },
      next: { revalidate: 300 }, // 5 min cache for signals
    });
    if (!res.ok) return null;
    return (await res.json()) as PrismSignal;
  } catch {
    return null;
  }
}

/**
 * Get risk metrics for symbol
 * GET /risk/{symbol}
 */
export async function prismRisk(symbol: string): Promise<PrismRiskMetrics | null> {
  try {
    const res = await fetch(`${PRISM_BASE_URL}/risk/${encodeURIComponent(symbol.toUpperCase())}`, {
      headers: { 'X-API-Key': PRISM_API_KEY },
      next: { revalidate: 3600 }, // 1 hour cache for risk
    });
    if (!res.ok) return null;
    return (await res.json()) as PrismRiskMetrics;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Trading Flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full trading decision pipeline for GhostAgent
 * 1. Resolve asset → 2. Get signal → 3. Check risk → 4. Return intent
 */
export async function prismTradeDecision(
  agentName: string,
  agentId: string,
  symbol: string,
  budgetXdai: number,
): Promise<PrismTradeIntent | null> {
  const [asset, price, signal, risk] = await Promise.all([
    prismResolve(symbol),
    prismCryptoPrice(symbol),
    prismSignal(symbol),
    prismRisk(symbol),
  ]);

  if (!signal || !price || !risk) return null;

  // Risk guard: reject if volatility > 80% annualized
  if (risk.volatility > 0.8) {
    return null;
  }

  // Budget check: only trade if budget covers position + 0.5% buffer
  const maxPosition = budgetXdai * 0.995;
  if (maxPosition <= 0) return null;

  return {
    agentName,
    agentId,
    symbol: asset?.symbol || symbol.toUpperCase(),
    direction: signal.signal === 'buy' ? 'buy' : signal.signal === 'sell' ? 'sell' : 'buy',
    amount: maxPosition / price.price,
    signal,
    riskScore: risk.volatility,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record trade intent to agent beacon metadata (audit trail)
 * Returns CID if pinning succeeds
 */
export async function prismRecordTradeIntent(
  intent: PrismTradeIntent,
): Promise<string | null> {
  // Import dynamically to avoid circular deps
  const { buildAndPin } = await import('./beacon-metadata');
  const result = await buildAndPin({
    agentName: intent.agentName,
    ownerAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4', // Placeholder - ghostagent Safe
    gnosisNft: `${intent.agentName}.molt.gno`,
    tld: 'molt.gno',
    safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
  });
  return result.pin?.cid || null;
}
