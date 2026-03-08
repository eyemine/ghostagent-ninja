'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  VAULT_EVOLUTION_COST_XDAI,
  STATUS_LABEL, STATUS_COLOR,
  humanEmailAddress, agentEmailAddress,
  type VaultEvolutionRecord, type EvolutionStatus,
} from '../../services/vault-evolution';

const STEPS: { key: EvolutionStatus; label: string }[] = [
  { key: 'minting',          label: 'Mint vault.gno NFT' },
  { key: 'deploying-safe',   label: 'Deploy Gnosis Safe' },
  { key: 'migrating-email',  label: 'Migrate email history' },
  { key: 'complete',         label: 'Evolution complete' },
];

function stepIndex(status: EvolutionStatus): number {
  return STEPS.findIndex(s => s.key === status);
}
export default function EvolveVaultPage() {
  const params = useSearchParams();
  const walletAddress = params.get('wallet') ?? '';
  const [clientName, setClientName] = useState(params.get('name') ?? '');
  const [record, setRecord] = useState<VaultEvolutionRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientName) return;
    setChecking(true);
    fetch(`/api/evolve/vault?name=${encodeURIComponent(clientName)}`)
      .then(r => r.json() as Promise<{ exists: boolean; evolution?: VaultEvolutionRecord }>)
      .then(d => { if (d.exists && d.evolution) setRecord(d.evolution); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [clientName]);

  async function callEvolution(action: string, extra?: Record<string, string>) {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/evolve/vault', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, clientName, ownerAddress: walletAddress, ...extra }),
      });
      const d = await res.json() as { evolution?: VaultEvolutionRecord; error?: string; message?: string };
      if (!res.ok) throw new Error(d.error ?? 'Request failed');
      if (d.evolution) setRecord(d.evolution);
    } catch (e: any) { setError(e?.message ?? 'Error'); }
    finally { setLoading(false); }
  }

  const currentStep = record ? stepIndex(record.status) : -1;
  const isComplete  = record?.status === 'complete';
  const isFailed    = record?.status === 'failed';

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-[#f2eee4]">Evolve to vault.gno</h1>
        <p className="text-sm text-[var(--muted)]">
          Upgrade your human inbox to a sovereign vault.gno agent. Mint NFT → deploy Safe → migrate email history.
        </p>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(176,128,92,0.1)] px-3 py-1 text-xs font-semibold text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]">
          {VAULT_EVOLUTION_COST_XDAI} xDAI one-time · Zero lock-in
        </div>
      </div>

      {/* Name input (pre-evolution) */}
      {!record && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[var(--muted)] tracking-wider">YOUR CURRENT INBOX</p>
            <div className="rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">swarm.</span>
              <input
                value={clientName}
                onChange={e => setClientName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme"
                className="flex-1 bg-transparent text-xs text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
              />
              <span className="text-xs text-[var(--muted)]">@nftmail.box</span>
            </div>
          </div>

          {clientName && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 space-y-0.5">
                  <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">CURRENT (LARVA)</p>
                  <p className="text-[11px] font-mono text-amber-300">{humanEmailAddress(clientName)}</p>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-0.5">
                  <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">AFTER EVOLUTION</p>
                  <p className="text-[11px] font-mono text-emerald-300">{agentEmailAddress(clientName)}</p>
                </div>
              </div>
              <p className="text-[10px] text-[var(--muted)]">Email history and contacts are preserved during migration.</p>
            </div>
          )}

          <button
            onClick={() => callEvolution('begin')}
            disabled={!clientName || !walletAddress || loading || checking}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-40"
          >
            {loading ? 'Starting…' : !walletAddress ? 'Connect wallet to evolve' : `Evolve to vault.gno — ${VAULT_EVOLUTION_COST_XDAI} xDAI`}
          </button>
          {!walletAddress && (
            <p className="text-center text-[10px] text-[var(--muted)]">Pass ?wallet=0x… in URL or connect wallet</p>
          )}
        </div>
      )}

      {/* Evolution in progress */}
      {record && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-5">
          {/* Step progress */}
          <div className="space-y-2">
            {STEPS.map((step, i) => {
              const done    = i < currentStep || isComplete;
              const active  = i === currentStep && !isComplete;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1 ${
                    done   ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/30' :
                    active ? 'bg-amber-500/20 text-amber-300 ring-amber-500/30 animate-pulse' :
                             'bg-white/5 text-[var(--muted)] ring-white/10'
                  }`}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`text-xs ${done ? 'text-emerald-300' : active ? 'text-amber-300' : 'text-[var(--muted)]'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Status */}
          <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <p className="text-[10px] text-[var(--muted)]">Status</p>
            <p className={`text-sm font-semibold ${STATUS_COLOR[record.status]}`}>{STATUS_LABEL[record.status]}</p>
          </div>

          {/* Address info */}
          {(record.safeAddress || record.tbaAddress) && (
            <div className="space-y-1.5 text-[10px]">
              {record.tbaAddress && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">TBA</span>
                  <span className="font-mono text-[#f2eee4]">{record.tbaAddress.slice(0, 10)}…{record.tbaAddress.slice(-6)}</span>
                </div>
              )}
              {record.safeAddress && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Safe</span>
                  <span className="font-mono text-[#f2eee4]">{record.safeAddress.slice(0, 10)}…{record.safeAddress.slice(-6)}</span>
                </div>
              )}
            </div>
          )}

          {/* Migration summary (complete) */}
          {isComplete && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-xs font-semibold text-emerald-300">Evolved to vault.gno: {record.agentEmail}</p>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-[var(--muted)]">Messages migrated</span>
                  <p className="font-semibold text-[#f2eee4]">{record.migratedMessageCount}</p>
                </div>
                <div>
                  <span className="text-[var(--muted)]">Contacts preserved</span>
                  <p className="font-semibold text-[#f2eee4]">{record.migratedContactCount}</p>
                </div>
              </div>
              <p className="text-[10px] text-[var(--muted)]">Glass Box audit entry written. Human inbox preserved for 30 days.</p>
            </div>
          )}

          {/* Continue buttons for each step */}
          {record.status === 'minting' && (
            <button onClick={() => callEvolution('confirm-mint')} disabled={loading}
              className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40">
              {loading ? 'Confirming…' : 'Confirm NFT minted →'}
            </button>
          )}
          {record.status === 'deploying-safe' && (
            <button onClick={() => callEvolution('confirm-safe')} disabled={loading}
              className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40">
              {loading ? 'Confirming…' : 'Confirm Safe deployed →'}
            </button>
          )}
          {record.status === 'migrating-email' && (
            <button onClick={() => callEvolution('migrate-email')} disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-violet-600 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40">
              {loading ? 'Migrating…' : 'Migrate email history →'}
            </button>
          )}
          {isFailed && (
            <button onClick={() => callEvolution('begin')} disabled={loading}
              className="w-full rounded-xl border border-red-500/30 bg-red-500/10 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:opacity-40">
              Retry from beginning
            </button>
          )}
        </div>
      )}

      {error && <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
