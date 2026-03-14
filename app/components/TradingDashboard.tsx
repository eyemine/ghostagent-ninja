'use client';

/**
 * TradingDashboard
 *
 * Full trading workflow:
 *   1. Get CoW Protocol quote (live price from Gnosis orderbook)
 *   2. Sign EIP-712 TradeIntent (agent authorisation proof)
 *   3. Execute via CoW presign (Safe signs on-chain)
 *   4. Poll order status → update PnL tracker
 *
 * Displays:
 *   - Quote panel (price, fee, slippage)
 *   - TradeIntent signing status
 *   - Active order + CoW Explorer link
 *   - Performance summary (PnL, Sharpe, drawdown, win rate)
 */

import { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, type Hex } from 'viem';
import { gnosis } from 'viem/chains';
import {
  TRADE_INTENT_TYPES,
  deadlineInMinutes,
  hashTradeIntent,
  buildTradeIntentArtifact,
  WXDAI,
  USDC_GNOSIS,
  GNO_TOKEN,
  type TradeIntent,
} from '../services/trade-intent';
import type { DexTradeResult } from '../services/cow-dex';
import type { PerformanceMetrics } from '../services/performance-tracker';

// ─── Token config ─────────────────────────────────────────────────────────────

const TOKENS = [
  { symbol: 'WXDAI', address: WXDAI,       decimals: 18 },
  { symbol: 'USDC',  address: USDC_GNOSIS, decimals: 6  },
  { symbol: 'GNO',   address: GNO_TOKEN,   decimals: 18 },
];

const STRATEGY_TAGS = ['manual', 'yield-arb', 'rebalance', 'stop-loss', 'dca', 'momentum'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteDisplay {
  sellSymbol:   string;
  buySymbol:    string;
  sellAmount:   string;
  buyAmount:    string;
  feeAmount:    string;
  validTo:      string;
  explorerBase: string;
}

interface ActiveOrder {
  orderUid:    string;
  explorerUrl: string;
  status:      string;
}

type Step = 'idle' | 'quoting' | 'quoted' | 'signing' | 'signed' | 'executing' | 'done' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUnits(amount: string, decimals: number): string {
  try {
    const [whole, frac = ''] = amount.split('.');
    const padded = frac.padEnd(decimals, '0').slice(0, decimals);
    return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(padded || '0')).toString();
  } catch { return '0'; }
}

function pct(n: number) { return `${(n * 100).toFixed(2)}%`; }
function xdai(n: number) { return `${n.toFixed(4)} xDAI`; }

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  agentName:   string;
  agentId:     number;
  safeAddress: string;
}

export function TradingDashboard({ agentName, agentId, safeAddress }: Props) {
  const { wallets } = useWallets();

  // Form state
  const [sellToken,    setSellToken]    = useState(WXDAI);
  const [buyToken,     setBuyToken]     = useState(USDC_GNOSIS);
  const [amount,       setAmount]       = useState('');
  const [slippage,     setSlippage]     = useState('1');
  const [strategyTag,  setStrategyTag]  = useState('manual');

  // Flow state
  const [step,         setStep]         = useState<Step>('idle');
  const [error,        setError]        = useState<string | null>(null);
  const [quote,        setQuote]        = useState<{ raw: unknown; display: QuoteDisplay } | null>(null);
  const [intentSig,    setIntentSig]    = useState<Hex | null>(null);
  const [intentHash,   setIntentHash]   = useState<string | null>(null);
  const [activeOrder,  setActiveOrder]  = useState<ActiveOrder | null>(null);
  const [metrics,      setMetrics]      = useState<PerformanceMetrics | null>(null);

  const sellTokenInfo = TOKENS.find(t => t.address === sellToken) ?? TOKENS[0];
  const buyTokenInfo  = TOKENS.find(t => t.address === buyToken)  ?? TOKENS[1];

  // ── Step 1: get quote ────────────────────────────────────────────────────────
  const handleQuote = useCallback(async () => {
    if (!amount || Number(amount) <= 0)  { setError('Enter a valid amount'); return; }
    if (sellToken === buyToken)          { setError('Tokens must differ'); return; }
    setError(null);
    setStep('quoting');
    setQuote(null);
    setIntentSig(null);
    setIntentHash(null);
    setActiveOrder(null);

    const sellAmountUnits = toUnits(amount, sellTokenInfo.decimals);

    const res = await fetch('/api/trade/execute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:     'quote',
        sellToken,
        buyToken,
        from:       safeAddress,
        sellAmount: sellAmountUnits,
      }),
    }).catch(() => null);

    if (!res?.ok) { setError('Quote failed — CoW API unavailable'); setStep('error'); return; }
    const data = await res.json() as { ok: boolean; quote: unknown; display: QuoteDisplay; error?: string };
    if (!data.ok) { setError(data.error ?? 'Quote error'); setStep('error'); return; }

    setQuote({ raw: data.quote, display: data.display });
    setStep('quoted');
  }, [amount, sellToken, buyToken, safeAddress, sellTokenInfo]);

  // ── Step 2: sign EIP-712 TradeIntent ────────────────────────────────────────
  const handleSign = useCallback(async () => {
    if (!wallets[0]) { setError('No wallet connected'); return; }
    setError(null);
    setStep('signing');

    const sellAmountUnits = toUnits(amount, sellTokenInfo.decimals);

    // Build intent
    const intent: TradeIntent = {
      agentId:      BigInt(agentId),
      agentWallet:  safeAddress as `0x${string}`,
      tokenIn:      sellToken   as `0x${string}`,
      tokenOut:     buyToken    as `0x${string}`,
      amountIn:     BigInt(sellAmountUnits),
      minAmountOut: 0n,
      deadline:     deadlineInMinutes(30),
      nonce:        BigInt(Date.now()),
      strategyTag,
    };

    const hash = hashTradeIntent(intent);

    try {
      const provider    = await wallets[0].getEthereumProvider();
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider) });
      const [account]   = await walletClient.getAddresses();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig: Hex = await (walletClient.signTypedData as any)({
        account,
        domain: {
          name: 'GhostAgent TradeIntent', version: '1',
          chainId: 100,
          verifyingContract: '0x0000000000000000000000000000000000000000',
        },
        types:       TRADE_INTENT_TYPES,
        primaryType: 'TradeIntent',
        message: {
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
      });

      // Store artifact
      const artifact = buildTradeIntentArtifact(agentName, intent, sig);
      await fetch('/api/trade-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', agentName, intent: {
          agentId:      intent.agentId.toString(),
          agentWallet:  intent.agentWallet,
          tokenIn:      intent.tokenIn,
          tokenOut:     intent.tokenOut,
          amountIn:     intent.amountIn.toString(),
          minAmountOut: intent.minAmountOut.toString(),
          deadline:     intent.deadline.toString(),
          nonce:        intent.nonce.toString(),
          strategyTag:  intent.strategyTag,
        }, signature: sig }),
      }).catch(() => {});

      setIntentSig(sig);
      setIntentHash(artifact.intentHash);
      setStep('signed');
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }, [wallets, amount, agentId, safeAddress, sellToken, buyToken, strategyTag, sellTokenInfo, agentName]);

  // ── Step 3: execute ──────────────────────────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (!intentSig) { setError('Sign the TradeIntent first'); return; }
    setError(null);
    setStep('executing');

    const sellAmountUnits = toUnits(amount, sellTokenInfo.decimals);

    const res = await fetch('/api/trade/execute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:         'execute',
        from:           safeAddress,
        sellToken,
        buyToken,
        sellAmount:     sellAmountUnits,
        tradeIntentSig: intentSig,
        intentHash,
        agentName,
      }),
    }).catch(() => null);

    if (!res?.ok) { setError('Execution failed'); setStep('error'); return; }
    const data = await res.json() as DexTradeResult & { ok: boolean; orderUid?: string; explorerUrl?: string };
    if (!data.ok) { setError(data.error ?? 'Execute error'); setStep('error'); return; }

    setActiveOrder({
      orderUid:    data.orderUid ?? '',
      explorerUrl: data.explorerUrl ?? '',
      status:      'open',
    });
    setStep('done');
  }, [intentSig, intentHash, amount, safeAddress, sellToken, buyToken, agentName, sellTokenInfo]);

  // ── Poll order status ────────────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    if (!activeOrder?.orderUid) return;
    const res = await fetch('/api/trade/execute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', orderUid: activeOrder.orderUid }),
    }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as { ok: boolean; status?: string };
    if (data.ok && data.status) {
      setActiveOrder(prev => prev ? { ...prev, status: data.status! } : prev);
    }
  }, [activeOrder]);

  // ── Load metrics ─────────────────────────────────────────────────────────────
  const loadMetrics = useCallback(async () => {
    const res = await fetch('/api/performance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'metrics', agentName }),
    }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json() as { ok: boolean; metrics?: PerformanceMetrics };
    if (data.ok && data.metrics) setMetrics(data.metrics);
  }, [agentName]);

  function reset() {
    setStep('idle'); setError(null); setQuote(null);
    setIntentSig(null); setIntentHash(null); setActiveOrder(null);
  }

  const busy = ['quoting', 'signing', 'executing'].includes(step);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-[#f2eee4]">Agent Trading — CoW Protocol</div>
          <div className="text-xs text-[var(--muted)]">
            <span className="text-[#b0805c]">{agentName}</span> · Gnosis chain 100 · MEV-protected
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://explorer.cow.fi/gc"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[var(--muted)] hover:text-[#b0805c] transition"
          >
            CoW Explorer ↗
          </a>
          <button
            onClick={loadMetrics}
            className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-transparent px-2.5 py-1 text-[10px] text-[var(--muted)] transition hover:text-[#f2eee4]"
          >
            Load PnL
          </button>
        </div>
      </div>

      {/* ── Trade Form ── */}
      {(step === 'idle' || step === 'error') && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SELL</label>
              <select value={sellToken} onChange={e => setSellToken(e.target.value as `0x${string}`)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none">
                {TOKENS.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">BUY</label>
              <select value={buyToken} onChange={e => setBuyToken(e.target.value as `0x${string}`)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none">
                {TOKENS.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">AMOUNT ({sellTokenInfo.symbol})</label>
              <input type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)]" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SLIPPAGE %</label>
              <input type="number" min="0" max="50" step="0.1" value={slippage} onChange={e => setSlippage(e.target.value)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">STRATEGY</label>
            <div className="flex flex-wrap gap-1.5">
              {STRATEGY_TAGS.map(tag => (
                <button key={tag} onClick={() => setStrategyTag(tag)}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold ring-1 transition-all ${
                    strategyTag === tag
                      ? 'bg-[rgba(176,128,92,0.2)] text-[#b0805c] ring-[rgba(176,128,92,0.5)]'
                      : 'bg-white/[0.04] text-[var(--muted)] ring-white/[0.08] hover:text-[#f2eee4]'
                  }`}>{tag}</button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{error}</div>
          )}

          <button onClick={handleQuote} disabled={busy || !amount}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.12)] py-3 text-sm font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)] disabled:opacity-40">
            Get CoW Quote
          </button>
        </div>
      )}

      {/* ── Spinner ── */}
      {busy && (
        <div className="py-8 text-center space-y-2">
          <svg className="mx-auto h-6 w-6 animate-spin text-[#b0805c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/>
          </svg>
          <p className="text-sm text-[var(--muted)]">
            {step === 'quoting'   && 'Fetching CoW quote…'}
            {step === 'signing'   && 'Waiting for wallet signature…'}
            {step === 'executing' && 'Submitting to CoW orderbook…'}
          </p>
        </div>
      )}

      {/* ── Quote panel ── */}
      {step === 'quoted' && quote && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2 font-mono text-[11px]">
            <div className="text-[10px] font-semibold tracking-widest text-emerald-300 mb-2">COW QUOTE</div>
            {[
              ['Sell', `${quote.display.sellAmount} ${quote.display.sellSymbol}`],
              ['Buy (min)', `${quote.display.buyAmount} ${quote.display.buySymbol}`],
              ['Fee', `${quote.display.feeAmount} ${quote.display.sellSymbol}`],
              ['Expires', quote.display.validTo.replace('T', ' ').slice(0, 19) + ' UTC'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <span className="text-[var(--muted)]">{k}</span>
                <span className="text-[#f2eee4]">{v}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Next: sign an EIP-712 TradeIntent to authorise this trade. The signature proves your agent approved these exact parameters.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={reset}
              className="rounded-xl border border-[rgba(176,128,92,0.25)] py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[#f2eee4]">
              ← Re-quote
            </button>
            <button onClick={handleSign}
              className="rounded-xl border border-violet-500/40 bg-violet-500/10 py-2.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20">
              Sign TradeIntent
            </button>
          </div>
        </div>
      )}

      {/* ── Signed: ready to execute ── */}
      {step === 'signed' && intentSig && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-violet-300 text-sm font-semibold">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-xs">✓</span>
            TradeIntent Signed
          </div>
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 font-mono text-[10px] space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Intent hash</span>
              <span className="text-[#f2eee4]">{intentHash ? `${intentHash.slice(0,10)}…${intentHash.slice(-6)}` : '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Signature</span>
              <span className="text-[#f2eee4]">{`${intentSig.slice(0,10)}…${intentSig.slice(-6)}`}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Strategy</span>
              <span className="text-violet-300">{strategyTag}</span>
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            CoW order will use <strong className="text-[#f2eee4]">presign</strong> scheme — your Gnosis Safe signs on-chain after submission. No private key exposed off-chain.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={reset}
              className="rounded-xl border border-[rgba(176,128,92,0.25)] py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[#f2eee4]">
              ← Cancel
            </button>
            <button onClick={handleExecute}
              className="rounded-xl border border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.15)] py-2.5 text-xs font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.22)]">
              Execute on CoW
            </button>
          </div>
        </div>
      )}

      {/* ── Active order ── */}
      {step === 'done' && activeOrder && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-300 text-sm font-semibold">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-xs">✓</span>
            Order Submitted
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 font-mono text-[11px] space-y-2">
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Order UID</span>
              <span className="text-[#f2eee4]">{`${activeOrder.orderUid.slice(0,18)}…`}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[var(--muted)]">Status</span>
              <span className={activeOrder.status === 'fulfilled' ? 'text-emerald-300' : 'text-amber-300'}>
                {activeOrder.status}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <a href={activeOrder.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 rounded-xl border border-emerald-500/30 bg-emerald-500/5 py-2.5 text-center text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10">
              View on CoW Explorer ↗
            </a>
            <button onClick={pollStatus}
              className="rounded-xl border border-[rgba(176,128,92,0.3)] px-4 py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[#f2eee4]">
              Refresh
            </button>
          </div>
          <button onClick={reset}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] py-2.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[#f2eee4]">
            New Trade
          </button>
        </div>
      )}

      {/* ── Performance metrics ── */}
      {metrics && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">PERFORMANCE</div>
            <span className="text-[10px] text-zinc-600">{metrics.tradeCount} trades</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px]">
            {[
              { label: 'Total PnL',   value: xdai(metrics.totalPnL),
                color: metrics.totalPnL >= 0 ? 'text-emerald-300' : 'text-red-400' },
              { label: 'PnL %',       value: pct(metrics.totalPnLPct),
                color: metrics.totalPnLPct >= 0 ? 'text-emerald-300' : 'text-red-400' },
              { label: 'Sharpe',      value: metrics.sharpeRatio.toFixed(3),  color: 'text-violet-300' },
              { label: 'Max DD',      value: metrics.maxDrawdownPct,           color: 'text-amber-300' },
              { label: 'Win Rate',    value: pct(metrics.winRate),             color: 'text-[#f2eee4]' },
              { label: 'Trades',      value: String(metrics.tradeCount),       color: 'text-[#f2eee4]' },
            ].map(row => (
              <div key={row.label} className="flex justify-between gap-2">
                <span className="text-[var(--muted)]">{row.label}</span>
                <span className={row.color}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
