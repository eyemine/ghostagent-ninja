'use client';

/**
 * PaperclipAttestation
 *
 * UI panel for submitting and viewing Paperclip TEE attestations.
 * Shown in the swarm dashboard alongside Glass Box audit trail.
 *
 * Props:
 *   agentName    — e.g. "scout.picoclaw.gno"
 *   taskId       — bytes32 hex from SwarmCoordinatorModule
 *   ownerAddress — connected wallet
 *   onSubmit?    — callback after successful submission
 */

import { useState } from 'react';
import { notaUrl } from '../services/paperclip-attestation';

interface Props {
  agentName:    string;
  taskId:       string;
  ownerAddress: string;
  onSubmit?:    (proofHash: string, notaUrl: string) => void;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export function PaperclipAttestation({ agentName, taskId, ownerAddress, onSubmit }: Props) {
  const [resultPayload, setResultPayload] = useState('');
  const [status, setStatus]               = useState<SubmitStatus>('idle');
  const [proofHash, setProofHash]         = useState<string | null>(null);
  const [txHash, setTxHash]               = useState<string | null>(null);
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);

  async function handleSubmit() {
    if (!resultPayload.trim()) return;
    setStatus('submitting');
    setErrorMsg(null);

    try {
      const res = await fetch('/api/paperclip/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName, taskId, resultPayload, ownerAddress }),
      });
      const data = await res.json() as {
        ok: boolean; proofHash?: string; txHash?: string; notaUrl?: string; error?: string;
      };

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? 'Submission failed');
        setStatus('error');
        return;
      }

      setProofHash(data.proofHash ?? null);
      setTxHash(data.txHash ?? null);
      setStatus('success');
      if (data.proofHash) onSubmit?.(data.proofHash, notaUrl(data.proofHash));
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">

      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-violet-300/70">
          PAPERCLIP ATTESTATION
        </span>
        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
          TEE Proof
        </span>
        <a
          href="https://notapaperclip.red"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[9px] text-violet-400/60 hover:text-violet-300 transition"
        >
          notapaperclip.red ↗
        </a>
      </div>

      {/* Agent + task info */}
      <div className="flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
        <span>Agent: <span className="text-[#f2eee4] font-medium">{agentName}</span></span>
        <span>Task: <code className="text-violet-300">{taskId.slice(0, 18)}…</code></span>
      </div>

      {status === 'success' && proofHash ? (
        /* ── Success state ── */
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-emerald-300 text-xs font-semibold">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
            Attestation Submitted ✓
          </div>
          <div className="rounded-lg bg-black/30 border border-[var(--border)] px-3 py-2 space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Proof hash</span>
              <code className="text-violet-300 font-mono">{proofHash.slice(0, 20)}…</code>
            </div>
            {txHash && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted)]">Tx</span>
                <a
                  href={`https://gnosisscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[rgb(160,220,255)] hover:underline font-mono"
                >
                  {txHash.slice(0, 14)}… ↗
                </a>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">Verify at</span>
              <a
                href={notaUrl(proofHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-300 hover:underline"
              >
                notapaperclip.red ↗
              </a>
            </div>
          </div>
          <button
            onClick={() => { setStatus('idle'); setResultPayload(''); setProofHash(null); setTxHash(null); }}
            className="text-[10px] text-[var(--muted)] hover:text-white transition"
          >
            Submit another →
          </button>
        </div>
      ) : (
        /* ── Input state ── */
        <div className="space-y-2">
          <textarea
            value={resultPayload}
            onChange={e => setResultPayload(e.target.value)}
            placeholder="Paste task result / TEE output to attest…"
            rows={3}
            className="w-full rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2 text-xs text-[#f2eee4] placeholder:text-[var(--muted)] outline-none focus:border-violet-500/40 resize-none"
          />

          {status === 'error' && errorMsg && (
            <p className="text-[10px] text-red-400">{errorMsg}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={!resultPayload.trim() || status === 'submitting'}
            className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'submitting' ? (
              <>
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/></svg>
                Submitting…
              </>
            ) : (
              <>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 3 4 4-4 4"/><path d="M19 7H9a4 4 0 0 0-4 4v1"/><path d="M9 21 5 17l4-4"/><path d="M5 17h10a4 4 0 0 0 4-4v-1"/></svg>
                Submit Attestation
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
