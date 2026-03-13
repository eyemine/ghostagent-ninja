/// @module performance-tracker
/// PnL, Sharpe ratio, and max drawdown tracking for hackathon leaderboard.
///
/// All calculations are pure functions — no side effects.
/// Call recordTrade() after each DEX execution, then computeMetrics() for dashboard.

export interface TradeRecord {
  id:        string;
  agentName: string;
  market:    string;        // e.g. "UNI/WXDAI"
  side:      'buy' | 'sell';
  size:      number;        // position size in USD equivalent
  entryPrice: number;
  exitPrice:  number;
  pnl:        number;       // realised PnL in USD
  pnlPct:     number;       // pnl / size
  timestamp:  number;       // unix ms
  txHash?:    string;
}

export interface DailyPnL {
  date:       string;       // YYYY-MM-DD UTC
  pnl:        number;
  pnlPct:     number;
  tradeCount: number;
}

export interface PerformanceMetrics {
  agentName:      string;
  totalPnL:       number;
  totalPnLPct:    number;
  sharpeRatio:    number;   // annualised, risk-free rate = 0
  maxDrawdown:    number;   // as fraction, e.g. 0.08 = 8%
  maxDrawdownPct: string;   // "8.00%"
  winRate:        number;   // fraction of winning trades
  tradeCount:     number;
  dailyPnL:       DailyPnL[];
  computedAt:     number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUTCDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Group trades by UTC day and compute daily PnL */
export function buildDailyPnL(trades: TradeRecord[]): DailyPnL[] {
  const map = new Map<string, { pnl: number; size: number; count: number }>();

  for (const t of trades) {
    const d = toUTCDate(t.timestamp);
    const cur = map.get(d) ?? { pnl: 0, size: 0, count: 0 };
    map.set(d, { pnl: cur.pnl + t.pnl, size: cur.size + t.size, count: cur.count + 1 });
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      pnl:        v.pnl,
      pnlPct:     v.size > 0 ? v.pnl / v.size : 0,
      tradeCount: v.count,
    }));
}

/**
 * Annualised Sharpe ratio from daily returns.
 * Sharpe = mean(daily returns) / std(daily returns) * sqrt(252)
 * Risk-free rate assumed 0.
 */
export function computeSharpe(dailyPnL: DailyPnL[]): number {
  if (dailyPnL.length < 2) return 0;

  const returns = dailyPnL.map(d => d.pnlPct);
  const mean    = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std      = Math.sqrt(variance);

  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252);
}

/**
 * Maximum drawdown from peak equity.
 * Returns a fraction (0-1), e.g. 0.08 = 8% drawdown.
 */
export function computeMaxDrawdown(dailyPnL: DailyPnL[]): number {
  if (dailyPnL.length === 0) return 0;

  let peak   = 0;
  let equity = 0;
  let maxDD  = 0;

  for (const d of dailyPnL) {
    equity += d.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

/** Compute all metrics from a list of trades */
export function computeMetrics(agentName: string, trades: TradeRecord[]): PerformanceMetrics {
  if (trades.length === 0) {
    return {
      agentName,
      totalPnL:       0,
      totalPnLPct:    0,
      sharpeRatio:    0,
      maxDrawdown:    0,
      maxDrawdownPct: '0.00%',
      winRate:        0,
      tradeCount:     0,
      dailyPnL:       [],
      computedAt:     Date.now(),
    };
  }

  const dailyPnL     = buildDailyPnL(trades);
  const totalPnL     = trades.reduce((s, t) => s + t.pnl, 0);
  const totalSize    = trades.reduce((s, t) => s + t.size, 0);
  const totalPnLPct  = totalSize > 0 ? totalPnL / totalSize : 0;
  const sharpeRatio  = computeSharpe(dailyPnL);
  const maxDrawdown  = computeMaxDrawdown(dailyPnL);
  const winRate      = trades.filter(t => t.pnl > 0).length / trades.length;

  return {
    agentName,
    totalPnL:       Math.round(totalPnL * 100) / 100,
    totalPnLPct:    Math.round(totalPnLPct * 10000) / 10000,
    sharpeRatio:    Math.round(sharpeRatio * 100) / 100,
    maxDrawdown:    Math.round(maxDrawdown * 10000) / 10000,
    maxDrawdownPct: `${(maxDrawdown * 100).toFixed(2)}%`,
    winRate:        Math.round(winRate * 10000) / 10000,
    tradeCount:     trades.length,
    dailyPnL,
    computedAt:     Date.now(),
  };
}

/** Format a metrics summary string for display */
export function formatMetricsSummary(m: PerformanceMetrics): string {
  const pnlSign = m.totalPnLPct >= 0 ? '+' : '';
  return `Sharpe: ${m.sharpeRatio.toFixed(1)} | Drawdown: ${m.maxDrawdownPct} | PnL: ${pnlSign}${(m.totalPnLPct * 100).toFixed(1)}%`;
}

/** Build a new TradeRecord from execution data */
export function buildTradeRecord(params: {
  agentName:  string;
  market:     string;
  side:       'buy' | 'sell';
  size:       number;
  entryPrice: number;
  exitPrice:  number;
  txHash?:    string;
}): TradeRecord {
  const pnl    = params.side === 'buy'
    ? (params.exitPrice - params.entryPrice) * params.size
    : (params.entryPrice - params.exitPrice) * params.size;
  const pnlPct = params.entryPrice > 0 ? pnl / (params.entryPrice * params.size) : 0;

  return {
    id:         `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    agentName:  params.agentName,
    market:     params.market,
    side:       params.side,
    size:       params.size,
    entryPrice: params.entryPrice,
    exitPrice:  params.exitPrice,
    pnl:        Math.round(pnl * 1e6) / 1e6,
    pnlPct:     Math.round(pnlPct * 1e6) / 1e6,
    timestamp:  Date.now(),
    txHash:     params.txHash,
  };
}
