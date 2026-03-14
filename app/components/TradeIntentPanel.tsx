'use client';

/**
 * TradeIntentPanel
 *
 * EIP-712 TradeIntent signing UI — ERC-8004 hackathon mandatory requirement.
 *
 * Flow:
 *   1. User fills in trade params (tokenIn, tokenOut, amountIn, strategyTag)
 *   2. Panel fetches the typed-data payload from /api/trade-intent (action: sign)
 *   3. Wallet signs via eth_signTypedData_v4 (Privy wallet client)
 *   4. Panel submits signed artifact to /api/trade-intent (action: submit)
 *   5. Shows intentHash + ERC-8004 Validation Registry payload
 *   6. Lists previous intents for this agent
 */

import { useState, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, type Hex } from 'viem';
import { gnosis } from 'viem/chains';
import {
  TRADE_INTENT_DOMAIN,
  TRADE_INTENT_TYPES,
  type TradeIntentArtifact,
  WXDAI,
  USDC_GNOSIS,
  GNO_TOKEN,
} from '../services/trade-intent';

// ─── Token config ─────────────────────────────────────────────────────────────

const TOKENS = [
  { symbol: 'WXDAI', address: WXDAI,       decimals: 18 },
  { symbol: 'USDC',  address: USDC_GNOSIS, decimals: 6  },
  { symbol: 'GNO',   address: GNO_TOKEN,   decimals: 18 },
];

const STRATEGY_TAGS = ['manual', 'yield-arb', 'rebalance', 'stop-loss', 'dca', 'momentum'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortHash(h: string) {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '';
}

function formatAmount(raw: string, decimals: number) {
  try {
    const n = Number(BigInt(raw)) / 10 ** decimals;
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch { return raw; }
}

function toUnits(amount: string, decimals: number): string {
  try {
    const [whole, frac = ''] = amount.split('.');
    const padded = frac.padEnd(decimals, '0').slice(0, decimals);
    return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(padded || '0')).toString();
  } catch { return '0'; }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  agentName:  string;
  agentId:    number;
  safeAddress: string;
}

type Step = 'idle' | 'building' | 'signing' | 'submitting' | 'done' | 'error';

export function TradeIntentPanel({ agentName, agentId, safeAddress }: Props) {
  const { wallets } = useWallets();

  const [tokenIn,     setTokenIn]     = useState(WXDAI);
  const [tokenOut,    setTokenOut]    = useState(USDC_GNOSIS);
  const [amountIn,    setAmountIn]    = useState('');
  const [slippage,    setSlippage]    = useState('1');   // %
  const [strategyTag, setStrategyTag] = useState('manual');

  const [step,       setStep]       = useState<Step>('idle');
  const [error,      setError]      = useState<string | null>(null);
  const [artifact,   setArtifact]   = useState<TradeIntentArtifact | null>(null);
  const [validation, setValidation] = useState<Record<string, unknown> | null>(null);
  const [history,    setHistory]    = useState<TradeIntentArtifact[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load history on mount
  useEffect(() => {
    if (!agentName) return;
    setLoadingHistory(true);
    fetch('/api/trade-intent', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'list', agentName }),
    })
      .then(r => r.json())
      .then((d: { intents?: TradeIntentArtifact[] }) => setHistory(d.intents ?? []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [agentName, artifact]);

  const tokenInConfig  = TOKENS.find(t => t.address === tokenIn)  ?? TOKENS[0];
  const tokenOutConfig = TOKENS.find(t => t.address === tokenOut) ?? TOKENS[1];

  async function handleSign() {
    setError(null);
    setArtifact(null);
    setValidation(null);
    if (!amountIn || Number(amountIn) <= 0) { setError('Enter a valid amount'); return; }
    if (tokenIn === tokenOut)               { setError('tokenIn and tokenOut must differ'); return; }
    if (!wallets[0])                        { setError('No wallet connected'); return; }

    const amountInUnits = toUnits(amountIn, tokenInConfig.decimals);
    const slippagePct   = Math.max(0, Math.min(50, Number(slippage) || 1));
    const minOut        = String(Math.floor(Number(amountInUnits) * (1 - slippagePct / 100)));

    try {
      // ── Step 1: get typed-data payload ──────────────────────────────────────
      setStep('building');
      const buildRes = await fetch('/api/trade-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'sign',
          agentId:     agentId.toString(),
          agentWallet: safeAddress,
          tokenIn,
          tokenOut,
          amountIn:    amountInUnits,
          minAmountOut: minOut,
          strategyTag,
        }),
      });
      const buildData = await buildRes.json() as {
        ok: boolean;
        domain: typeof TRADE_INTENT_DOMAIN;
        types:  typeof TRADE_INTENT_TYPES;
        message: Record<string, string>;
        intentHash: string;
        error?: string;
      };
      if (!buildData.ok) throw new Error(buildData.error ?? 'Build failed');

      // ── Step 2: sign via wallet ──────────────────────────────────────────────
      setStep('signing');
      const provider  = await wallets[0].getEthereumProvider();
      const walletClient = createWalletClient({
        chain:     gnosis,
        transport: custom(provider),
      });
      const [account] = await walletClient.getAddresses();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig: Hex = await (walletClient.signTypedData as any)({
        account,
        domain:      buildData.domain,
        types:       TRADE_INTENT_TYPES,
        primaryType: 'TradeIntent',
        message:     buildData.message,
      });

      // ── Step 3: submit signed artifact ──────────────────────────────────────
      setStep('submitting');
      const submitRes = await fetch('/api/trade-intent', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'submit',
          agentName,
          intent:    buildData.message,
          signature: sig,
        }),
      });
      const submitData = await submitRes.json() as {
        ok: boolean;
        intentHash: string;
        artifact: TradeIntentArtifact;
        validation: Record<string, unknown>;
        error?: string;
      };
      if (!submitData.ok) throw new Error(submitData.error ?? 'Submit failed');

      setArtifact(submitData.artifact);
      setValidation(submitData.validation);
      setStep('done');
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }

  function reset() {
    setStep('idle');
    setError(null);
    setArtifact(null);
    setValidation(null);
  }

  const busy = step === 'building' || step === 'signing' || step === 'submitting';

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#f2eee4]">EIP-712 TradeIntent</div>
          <div className="text-xs text-[var(--muted)]">
            Agent <span className="text-[#b0805c]">{agentName}</span> · agentId {agentId} · ERC-8004 validation artifact
          </div>
        </div>
        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
          Gnosis chain 100
        </span>
      </div>

      {/* ── Form ── */}
      {step === 'idle' || step === 'error' ? (
        <div className="space-y-4">

          {/* Token row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">TOKEN IN (SELL)</label>
              <select
                value={tokenIn}
                onChange={e => setTokenIn(e.target.value as `0x${string}`)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none"
              >
                {TOKENS.map(t => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">TOKEN OUT (BUY)</label>
              <select
                value={tokenOut}
                onChange={e => setTokenOut(e.target.value as `0x${string}`)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none"
              >
                {TOKENS.map(t => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount + slippage */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">AMOUNT ({tokenInConfig.symbol})</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amountIn}
                onChange={e => setAmountIn(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SLIPPAGE %</label>
              <input
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={slippage}
                onChange={e => setSlippage(e.target.value)}
                className="w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-3 py-2 text-xs text-[#f2eee4] outline-none"
              />
            </div>
          </div>

          {/* Strategy tag */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">STRATEGY TAG</label>
            <div className="flex flex-wrap gap-1.5">
              {STRATEGY_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => setStrategyTag(tag)}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold ring-1 transition-all ${
                    strategyTag === tag
                      ? 'bg-[rgba(176,128,92,0.2)] text-[#b0805c] ring-[rgba(176,128,92,0.5)]'
                      : 'bg-white/[0.04] text-[var(--muted)] ring-white/[0.08] hover:text-[#f2eee4]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* EIP-712 domain info */}
          <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-[rgba(176,128,92,0.04)] px-3 py-2.5 space-y-1">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">EIP-712 DOMAIN</div>
            <div className="text-[10px] text-[var(--muted)] font-mono space-y-0.5">
              <div>name: <span className="text-[#f2eee4]">{TRADE_INTENT_DOMAIN.name}</span></div>
              <div>version: <span className="text-[#f2eee4]">{TRADE_INTENT_DOMAIN.version}</span></div>
              <div>chainId: <span className="text-emerald-300">{TRADE_INTENT_DOMAIN.chainId}</span></div>
              <div>verifyingContract: <span className="text-[#b0805c]">{shortHash(TRADE_INTENT_DOMAIN.verifyingContract)}</span></div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={handleSign}
            disabled={busy || !amountIn}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.12)] py-3 text-sm font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)] disabled:opacity-40"
          >
            Sign TradeIntent with Wallet
          </button>
        </div>
      ) : null}

      {/* ── Progress states ── */}
      {busy && (
        <div className="space-y-3 text-center py-6">
          <svg className="mx-auto h-6 w-6 animate-spin text-[#b0805c]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/>
          </svg>
          <p className="text-sm text-[var(--muted)]">
            {step === 'building'   && 'Building typed-data payload…'}
            {step === 'signing'    && 'Waiting for wallet signature…'}
            {step === 'submitting' && 'Storing artifact in Glass Box…'}
          </p>
        </div>
      )}

      {/* ── Success result ── */}
      {step === 'done' && artifact && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-xs">✓</span>
            <span className="text-sm font-semibold text-emerald-300">TradeIntent Signed & Stored</span>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Intent Hash</span>
              <span className="text-[#f2eee4]">{shortHash(artifact.intentHash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Agent</span>
              <span className="text-[#b0805c]">{artifact.agentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Sell</span>
              <span className="text-[#f2eee4]">
                {formatAmount(artifact.intent.amountIn, tokenInConfig.decimals)} {tokenInConfig.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Min receive</span>
              <span className="text-[#f2eee4]">
                {formatAmount(artifact.intent.minAmountOut, tokenOutConfig.decimals)} {tokenOutConfig.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Strategy</span>
              <span className="text-violet-300">{artifact.intent.strategyTag}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Signature</span>
              <span className="text-[#f2eee4]">{shortHash(artifact.signature)}</span>
            </div>
          </div>

          {/* ERC-8004 Validation payload */}
          {validation && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">ERC-8004 VALIDATION REGISTRY PAYLOAD</div>
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 font-mono text-[10px] space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)] shrink-0">agentId</span>
                  <span className="text-[#f2eee4]">{String(validation.agentId)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)] shrink-0">requestHash</span>
                  <span className="text-[#f2eee4] truncate">{shortHash(String(validation.requestHash))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)] shrink-0">chainId</span>
                  <span className="text-emerald-300">{String(validation.chainId)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)] shrink-0">requestUri</span>
                  <a
                    href={String(validation.requestUri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#b0805c] truncate hover:underline"
                  >
                    view artifact ↗
                  </a>
                </div>
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                Submit <code className="text-[#b0805c]">requestHash</code> + <code className="text-[#b0805c]">requestUri</code> to the ERC-8004 Validation Registry <code className="text-violet-300">validate()</code> call via your Gnosis Safe.
              </p>
            </div>
          )}

          <button
            onClick={reset}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.3)] bg-transparent py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:text-[#f2eee4]"
          >
            Sign another intent
          </button>
        </div>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SIGNED INTENTS</div>
          <div className="space-y-1.5">
            {history.map(item => {
              const inTok  = TOKENS.find(t => t.address.toLowerCase() === item.intent.tokenIn.toLowerCase())  ?? { symbol: '?', decimals: 18 };
              const outTok = TOKENS.find(t => t.address.toLowerCase() === item.intent.tokenOut.toLowerCase()) ?? { symbol: '?', decimals: 18 };
              return (
                <div
                  key={item.intentHash}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(176,128,92,0.12)] bg-[rgba(176,128,92,0.04)] px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-300 ring-1 ring-violet-500/20 shrink-0">
                      {item.intent.strategyTag}
                    </span>
                    <span className="text-[var(--muted)] truncate font-mono">{shortHash(item.intentHash)}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-[#f2eee4]">{formatAmount(item.intent.amountIn, inTok.decimals)} {inTok.symbol}</span>
                    <span className="text-[var(--muted)]"> → </span>
                    <span className="text-emerald-300">{outTok.symbol}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loadingHistory && (
        <p className="text-[11px] text-[var(--muted)]">Loading intent history…</p>
      )}
    </div>
  );
}
