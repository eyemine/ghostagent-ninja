'use client';

import { useState } from 'react';
import { InstallBrain } from '../../components/InstallBrain';

export default function InstallBrainPage() {
  const [agentName, setAgentName] = useState('');
  const [safeAddress, setSafeAddress] = useState('');
  const [tbaAddress, setTbaAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const isValid =
    agentName.length >= 2 &&
    safeAddress.startsWith('0x') && safeAddress.length === 42 &&
    tbaAddress.startsWith('0x') && tbaAddress.length === 42;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">INSTALL AGENT BRAIN</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Attach a BrainModule to your agent&apos;s Safe and awaken it in the GhostRegistry.
        </p>
      </div>

      {!confirmed ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-5">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">AGENT NAME</label>
            <input
              value={agentName}
              onChange={e => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g. eyemine"
              className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-2.5 text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-[rgba(0,163,255,0.45)]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SAFE ADDRESS</label>
            <input
              value={safeAddress}
              onChange={e => setSafeAddress(e.target.value.trim())}
              placeholder="0x…"
              className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-[rgba(0,163,255,0.45)]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TBA ADDRESS</label>
            <input
              value={tbaAddress}
              onChange={e => setTbaAddress(e.target.value.trim())}
              placeholder="0x…"
              className="w-full rounded-xl border border-[var(--border)] bg-black/30 px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-[rgba(0,163,255,0.45)]"
            />
            <p className="text-[10px] text-[var(--muted)]">Token-bound account address from the Mint Agent Body step.</p>
          </div>

          <button
            onClick={() => setConfirmed(true)}
            disabled={!isValid}
            className="flex items-center gap-2 rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-5 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue →
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{agentName}</p>
              <p className="font-mono text-[11px] text-[var(--muted)]">{safeAddress}</p>
            </div>
            <button
              onClick={() => setConfirmed(false)}
              className="text-xs text-[var(--muted)] hover:text-white transition-colors"
            >
              ← Change
            </button>
          </div>
          <InstallBrain
            agentName={agentName}
            safeAddress={safeAddress as `0x${string}`}
            tbaAddress={tbaAddress as `0x${string}`}
          />
        </div>
      )}
    </div>
  );
}
