'use client';

import { useState } from 'react';
import { createWalletClient, createPublicClient, custom, http, parseEther } from 'viem';
import { gnosis } from '../utils/chains';

const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3' as const;
const MOLT_FEE = parseEther('2'); // 2 xDAI

export interface MoltModalProps {
  agentName: string;
  currentIdentity: string;
  ownerWallet: string;
  onClose: () => void;
  onSuccess: (result: MoltResult) => void;
}

export interface MoltResult {
  agentName: string;
  targetIdentity: string;
  newBeaconCid: string | null;
  totalXdaiBurned: number;
  surgeReputationScore: number;
}

type Step = 'select' | 'preview' | 'paying' | 'molting' | 'done' | 'error';

const IDENTITY_SUGGESTIONS = [
  { value: 'ghost', label: 'Ghost', description: 'Anonymous — no identity overlay' },
  { value: 'chonk', label: 'Chonk NFT', description: 'Overlay your Chonk collection identity' },
  { value: 'custom', label: 'Custom', description: 'Enter a custom identity string' },
];

export function MoltModal({ agentName, currentIdentity, ownerWallet, onClose, onSuccess }: MoltModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [selectedIdentity, setSelectedIdentity] = useState('');
  const [customIdentity, setCustomIdentity] = useState('');
  const [paymentTxHash, setPaymentTxHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MoltResult | null>(null);

  const targetIdentity = selectedIdentity === 'custom' ? customIdentity : selectedIdentity;
  const isValidIdentity = targetIdentity.trim().length > 0 && targetIdentity !== currentIdentity;

  async function handlePay() {
    setError(null);
    setStep('paying');
    try {
      const provider = (window as any).ethereum;
      if (!provider) throw new Error('No wallet provider found');

      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider) });
      const [account] = await walletClient.requestAddresses();

      const txHash = await walletClient.sendTransaction({
        account,
        to: GNOSIS_TREASURY,
        value: MOLT_FEE,
        chain: gnosis,
      });

      setPaymentTxHash(txHash);
      setStep('molting');
      await executeMolt(txHash);
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? 'Payment failed');
      setStep('error');
    }
  }

  async function executeMolt(txHash: string) {
    try {
      const res = await fetch('/api/molt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName,
          targetIdentity,
          ownerWallet,
          paymentTxHash: txHash,
        }),
      });

      const data = await res.json() as any;
      if (!res.ok) throw new Error(data?.error ?? 'Molt failed');

      const moltResult: MoltResult = {
        agentName: data.agentName,
        targetIdentity: data.targetIdentity,
        newBeaconCid: data.newBeaconCid,
        totalXdaiBurned: data.totalXdaiBurned,
        surgeReputationScore: data.surgeReputationScore,
      };
      setResult(moltResult);
      setStep('done');
      onSuccess(moltResult);
    } catch (err: any) {
      setError(err?.message ?? 'Molt execution failed');
      setStep('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[#0c0d10] shadow-[0_0_60px_rgba(0,0,0,0.6)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(176,128,92,0.15)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-sm">
              🐛
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Molt Identity</div>
              <div className="text-[10px] text-[var(--muted)]">{agentName}_@nftmail.box</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {/* Step: Select identity */}
          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--muted)]">
                Choose a new identity overlay for <span className="text-white font-medium">{agentName}_</span>. Your primary email never changes — only the display identity molts.
              </p>

              <div className="space-y-2">
                {IDENTITY_SUGGESTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedIdentity(opt.value)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      selectedIdentity === opt.value
                        ? 'border-amber-500/40 bg-amber-500/10'
                        : 'border-[var(--border)] bg-black/20 hover:border-amber-500/20'
                    }`}
                  >
                    <div className="text-sm font-medium text-white">{opt.label}</div>
                    <div className="text-[10px] text-[var(--muted)]">{opt.description}</div>
                  </button>
                ))}
              </div>

              {selectedIdentity === 'custom' && (
                <input
                  type="text"
                  value={customIdentity}
                  onChange={(e) => setCustomIdentity(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                  placeholder="e.g. bayc.1234"
                  className="w-full rounded-xl border border-[var(--border)] bg-black/40 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/40"
                />
              )}

              <button
                onClick={() => setStep('preview')}
                disabled={!isValidIdentity}
                className="w-full rounded-xl bg-amber-500/15 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Preview Molt →
              </button>
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-black/30 p-4 space-y-3">
                <div className="text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">MOLT PREVIEW</div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-lg bg-red-500/8 border border-red-500/20 px-3 py-2">
                    <div className="text-[10px] text-red-400/60">FROM</div>
                    <div className="text-sm font-mono text-red-300">{currentIdentity || 'default'}</div>
                  </div>
                  <div className="text-[var(--muted)]">→</div>
                  <div className="flex-1 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2">
                    <div className="text-[10px] text-amber-400/60">TO</div>
                    <div className="text-sm font-mono text-amber-300">{targetIdentity}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[var(--muted)]">Primary email unchanged</span>
                  <span className="text-emerald-400">✓ {agentName}_@nftmail.box</span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-200">Molt fee</span>
                  <span className="text-sm font-bold text-amber-300">2 xDAI</span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">
                  Sent to treasury on Gnosis — funds surge reputation score
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('select')}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] transition hover:text-white"
                >
                  ← Back
                </button>
                <button
                  onClick={handlePay}
                  className="flex-1 rounded-xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/30"
                >
                  Pay 2 xDAI & Molt
                </button>
              </div>
            </div>
          )}

          {/* Step: Paying */}
          {step === 'paying' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-500/20 border-t-amber-400" />
              <div className="text-sm font-medium text-amber-200">Awaiting payment...</div>
              <div className="text-[10px] text-[var(--muted)]">Sign the 2 xDAI transaction in your wallet</div>
            </div>
          )}

          {/* Step: Molting */}
          {step === 'molting' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="text-3xl animate-pulse">🐛</div>
              <div className="text-sm font-medium text-amber-200">Molting identity...</div>
              <div className="text-[10px] text-[var(--muted)]">Updating beacon metadata on IPFS</div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-2 py-3">
                <div className="text-3xl">🦋</div>
                <div className="text-sm font-semibold text-white">Molt complete</div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--muted)]">New identity</span>
                  <span className="font-mono text-amber-300">{result.targetIdentity}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--muted)]">Total xDAI burned</span>
                  <span className="font-semibold text-white">{result.totalXdaiBurned.toFixed(1)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--muted)]">Surge reputation</span>
                  <span className="font-semibold text-amber-300">{result.surgeReputationScore} pts</span>
                </div>
                {result.newBeaconCid && (
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">Beacon CID</span>
                    <a
                      href={`https://cloudflare-ipfs.com/ipfs/${result.newBeaconCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sky-400 hover:underline"
                    >
                      {result.newBeaconCid.slice(0, 12)}…
                    </a>
                  </div>
                )}
              </div>

              <button
                onClick={onClose}
                className="w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
              >
                Done
              </button>
            </div>
          )}

          {/* Step: Error */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                <div className="text-xs font-semibold text-red-400 mb-1">Molt failed</div>
                <div className="text-[11px] text-red-300/80">{error}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setStep('preview'); setError(null); }}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] transition hover:text-white"
                >
                  ← Try again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400 transition hover:bg-red-500/10"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
