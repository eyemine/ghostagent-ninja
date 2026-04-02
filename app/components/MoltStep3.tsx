'use client';

import { useState } from 'react';
import { createWalletClient, custom, parseEther } from 'viem';
import { gnosis } from '../utils/chains';
import type { SourceAgent } from './MoltStep1';
import type { TargetIdentity } from './MoltStep2';
import { FEATURES } from '../constants/features';

const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3' as const;
const MOLT_FEE_BASE = parseEther('14');
const IP_MINT_FEE  = parseEther('5');

// Opposite .ip type to what the agent already has
function deriveTargetIPType(currentIPType: string | null): 'creation.ip' | 'moltbook.ip' {
  return currentIPType === 'moltbook.ip' ? 'creation.ip' : 'moltbook.ip';
}

export interface MoltFinalResult {
  agentName: string;
  targetIdentity: string;
  newBeaconCid: string | null;
  totalXdaiBurned: number;
  surgeReputationScore: number;
  lastMoltTimestamp: number | null;
}

interface MoltStep3Props {
  source: SourceAgent;
  target: TargetIdentity;
  onBack: () => void;
  onSuccess: (result: MoltFinalResult) => void;
}

type ExecStep = 'idle' | 'paying' | 'molting' | 'done' | 'error';

export function MoltStep3({ source, target, onBack, onSuccess }: MoltStep3Props) {
  const [execStep, setExecStep] = useState<ExecStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MoltFinalResult | null>(null);
  const [optionalIPMint, setOptionalIPMint] = useState(false);

  const currentIPType = source.ipPrimary ?? (source.ipDomains[0]?.type ?? null);
  const targetIPType  = deriveTargetIPType(currentIPType);
  // Only charge extra if feature is enabled AND user opted in
  const activeIPMint  = FEATURES.optionalIPMint && optionalIPMint;
  const totalFee      = activeIPMint ? MOLT_FEE_BASE + IP_MINT_FEE : MOLT_FEE_BASE;
  const totalFeeLabel = activeIPMint ? '19 xDAI' : '14 xDAI';

  async function handleExecute() {
    setError(null);
    setExecStep('paying');
    try {
      const provider = (window as any).ethereum;
      if (!provider) throw new Error('No wallet provider — connect MetaMask or WalletConnect');

      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider) });
      const [account] = await walletClient.requestAddresses();

      const txHash = await walletClient.sendTransaction({
        account,
        to: GNOSIS_TREASURY,
        value: totalFee,
        chain: gnosis,
      });

      setExecStep('molting');

      const res = await fetch('/api/molt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: source.name,
          targetIdentity: target.fullName,
          ownerWallet: source.ownerWallet,
          paymentTxHash: txHash,
          optionalIPMint: activeIPMint,
          targetIPType: activeIPMint ? targetIPType : undefined,
        }),
      });

      const data = await res.json() as any;
      if (!res.ok) throw new Error(data?.error ?? 'Molt failed');

      const final: MoltFinalResult = {
        agentName: data.agentName,
        targetIdentity: data.targetIdentity,
        newBeaconCid: data.newBeaconCid ?? null,
        totalXdaiBurned: data.totalXdaiBurned ?? 0,
        surgeReputationScore: data.surgeReputationScore ?? 0,
        lastMoltTimestamp: data.lastMoltTimestamp ?? null,
      };
      setResult(final);
      setExecStep('done');
      onSuccess(final);
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? 'Molt failed');
      setExecStep('error');
    }
  }

  return (
    <div className="space-y-4">
      {/* Preview card */}
      <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-4">
        <div className="text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">MOLT PREVIEW</div>

        {/* Identity change */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2.5">
            <div className="text-[9px] text-red-400/60 mb-1">FROM</div>
            <div className="font-mono text-sm text-red-300">{source.currentIdentity}</div>
            <div className="text-[9px] text-[var(--muted)] mt-0.5">{source.namespace}</div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-lg">🐛</span>
            <span className="text-[var(--muted)] text-xs">→</span>
          </div>
          <div className="flex-1 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2.5">
            <div className="text-[9px] text-amber-400/60 mb-1">TO</div>
            <div className="font-mono text-sm text-amber-300">{source.name}</div>
            <div className="text-[9px] text-[var(--muted)] mt-0.5">.{target.tld}</div>
          </div>
        </div>

        {/* What stays the same */}
        <div className="space-y-1.5">
          <div className="text-[9px] font-semibold tracking-[0.12em] text-[var(--muted)]">UNCHANGED</div>
          {[
            { label: 'Primary Agent email', value: `${source.name}_@nftmail.box` },
            { label: 'TBA address', value: source.tba === '—' ? '(retrieve Safe address)' : source.tba },
            { label: 'Safe / vault', value: 'preserved' },
            { label: 'Inbox / history', value: 'preserved (8-day/30-day/Persistent)' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--muted)]">{label}</span>
              <span className="font-mono text-emerald-400 text-[10px]">✓ {value.length > 28 ? `${value.slice(0, 14)}...${value.slice(-8)}` : value}</span>
            </div>
          ))}

          {/* .IP Domain preserved row */}
          {currentIPType && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--muted)]">.IP Domain</span>
              <span className="font-mono text-emerald-400 text-[10px]">✓ PRESERVED ({currentIPType})</span>
            </div>
          )}
        </div>

        {/* Optional additional .ip mint — suppressed until FEATURES.optionalIPMint = true */}
        {FEATURES.optionalIPMint && (
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5 transition hover:border-amber-500/30">
            <input
              type="checkbox"
              checked={optionalIPMint}
              onChange={(e) => setOptionalIPMint(e.target.checked)}
              className="mt-0.5 accent-amber-400"
            />
            <div className="flex-1 text-[10px]">
              <span className="text-[var(--muted)]">Mint additional .ip type</span>
              <span className="ml-1 text-amber-300 font-semibold">(+5 xDAI)</span>
              {optionalIPMint && (
                <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
                  + NEW .ip ({targetIPType})
                </span>
              )}
            </div>
          </label>
        )}

        {/* Surge score projection */}
        <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[9px] text-[var(--muted)]">Surge score after molt</div>
            <div className="text-xs font-semibold text-amber-300">
              {source.surgeReputationScore} → {Math.min(Math.round((source.surgeReputationScore + 15.4) * 10) / 10, 1000)} pts
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-[var(--muted)]">Total xDAI burned</div>
            <div className="text-xs font-semibold text-white">{source.totalXdaiBurned.toFixed(1)} → {(source.totalXdaiBurned + 14).toFixed(1)}</div>
          </div>
        </div>
      </div>

      {/* Fee notice */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-amber-200">Molt fee{optionalIPMint ? ' + .ip mint' : ''}</div>
          <div className="text-[10px] text-[var(--muted)]">
            {optionalIPMint ? '14 xDAI molt + 5 xDAI .ip mint · ' : ''}Sent to treasury on Gnosis
          </div>
        </div>
        <div className="text-lg font-bold text-amber-300">{totalFeeLabel}</div>
      </div>

      {/* Exec states */}
      {execStep === 'paying' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500/20 border-t-amber-400" />
          <span className="text-sm text-amber-200">Sign the {totalFeeLabel} transaction in your wallet...</span>
        </div>
      )}

      {execStep === 'molting' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <span className="animate-pulse text-xl">🐛</span>
          <span className="text-sm text-amber-200">Molting... updating beacon on IPFS</span>
        </div>
      )}

      {execStep === 'done' && result && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🦋</span>
            <span className="text-sm font-semibold text-white">Molt complete!</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] space-y-1">
            <div className="flex justify-between">
              <span>New identity</span>
              <span className="font-mono text-amber-300">{result.targetIdentity}</span>
            </div>
            <div className="flex justify-between">
              <span>Total xDAI burned</span>
              <span className="text-white font-semibold">{result.totalXdaiBurned.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span>Surge reputation</span>
              <span className="text-amber-300 font-semibold">{result.surgeReputationScore} pts</span>
            </div>
            {result.newBeaconCid && (
              <div className="flex justify-between">
                <span>Beacon CID</span>
                <a
                  href={`https://gateway.lighthouse.storage/ipfs/${result.newBeaconCid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sky-400 hover:underline"
                >
                  {result.newBeaconCid.slice(0, 12)}…
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {execStep === 'error' && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <div className="text-xs font-semibold text-red-400 mb-1">Molt failed</div>
          <div className="text-[11px] text-red-300/80">{error}</div>
        </div>
      )}

      {/* Action buttons */}
      {(execStep === 'idle' || execStep === 'error') && (
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] transition hover:text-white"
          >
            ← Back
          </button>
          <button
            onClick={handleExecute}
            className="flex-1 rounded-xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/30"
          >
            Pay {totalFeeLabel} & Molt
          </button>
        </div>
      )}
    </div>
  );
}
