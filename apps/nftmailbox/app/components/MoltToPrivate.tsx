'use client';

import { useState } from 'react';

interface MoltToPrivateProps {
  name: string;
  walletAddress: string;
  onMolted?: () => void;
}

export function MoltToPrivate({ name, walletAddress, onMolted }: MoltToPrivateProps) {
  const [molting, setMolting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleMolt = async () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }

    setMolting(true);
    setResult(null);
    try {
      // Request wallet signature for molt authorization
      const message = `MOLT TO PRIVATE\n\nAgent: ${name}\nAction: Transition from molt.gno (Glass Box) to vault.gno (Black Box)\nTimestamp: ${new Date().toISOString()}\n\nThis will terminate the public audit log. The agent becomes Sovereign.`;

      let signature = '';
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({ method: 'eth_accounts' });
        const account = accounts?.[0] || walletAddress;
        signature = await (window as any).ethereum.request({
          method: 'personal_sign',
          params: [message, account],
        });
      } else {
        signature = `mock-molt-sig-${Date.now()}`;
      }

      const res = await fetch('/api/molt-to-private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, signature, newTld: 'vault.gno' }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult(`Molted. ${name} is now Sovereign (vault.gno). Public audit log terminated.`);
        onMolted?.();
      } else {
        setResult(`Error: ${data.error || 'Molt failed'}`);
      }
    } catch (err: any) {
      setResult(`Error: ${err?.message || 'Molt failed'}`);
    } finally {
      setMolting(false);
      setConfirmed(false);
    }
  };

  const isMoltAgent = name.endsWith('_molt');

  if (!isMoltAgent) return null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className="text-xs font-semibold text-violet-300">OPEN AGENCY — GLASS BOX</span>
      </div>

      <p className="text-[11px] text-[var(--muted)]">
        This agent operates under <strong className="text-violet-300">molt.gno</strong> governance.
        All incoming instructions are logged to a public audit trail.
        Molt to <strong className="text-emerald-300">vault.gno</strong> to retire from public scrutiny.
      </p>

      {!confirmed ? (
        <button
          onClick={handleMolt}
          disabled={molting}
          className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40"
        >
          Molt to Private
        </button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
            <p className="text-[10px] text-amber-300">
              This will terminate the public audit log. The agent&apos;s historical record remains, but new communications become private. This action requires a wallet signature.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmed(false)}
              className="flex-1 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-[var(--muted)] transition hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleMolt}
              disabled={molting}
              className="flex-1 rounded-lg border border-violet-500/30 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/25 disabled:opacity-40"
            >
              {molting ? 'Signing...' : 'Confirm Molt'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`rounded-lg px-3 py-2 text-[10px] ${
          result.startsWith('Error')
            ? 'border border-red-500/20 bg-red-500/5 text-red-300'
            : 'border border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
        }`}>
          {result}
        </div>
      )}
    </div>
  );
}
