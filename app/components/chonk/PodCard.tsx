'use client';

import { useState } from 'react';
import type { ChonkPodMetadata } from '../../types/indexer';

interface PodCardProps {
  pod: ChonkPodMetadata;
  userAddress: string;
  refreshData: () => Promise<void>;
}

function short(value: string, left = 8, right = 4): string {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function parseVaultUuid(vaultId?: string): number | null {
  if (!vaultId) return null;
  const uuid = Number(vaultId.includes(':') ? vaultId.split(':').pop() : vaultId);
  return Number.isInteger(uuid) ? uuid : null;
}

export function PodCard({ pod, userAddress, refreshData }: PodCardProps) {
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(endpoint: string, body: Record<string, unknown>) {
    setProcessing(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { status?: string; error?: string; vaultId?: string; ipId?: string; payload?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
      setStatus(data.status ?? data.vaultId ?? data.ipId ?? 'OK');
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setProcessing(false);
    }
  }

  async function handleRegister() {
    await runAction('/api/cdr/register', { tokenId: pod.tokenId, storySafeAddress: userAddress });
  }

  async function handleProvision() {
    if (!pod.storyIpId) return;
    await runAction('/api/cdr/provision', { tokenId: pod.tokenId, ipId: pod.storyIpId });
  }

  async function handleUnlock() {
    const vaultUuid = parseVaultUuid(pod.cdrVaultId);
    if (vaultUuid === null) {
      setError('Invalid CDR vault id');
      return;
    }
    await runAction('/api/cdr/unlock', { tokenId: pod.tokenId, userAddress, vaultUuid });
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 font-mono text-xs shadow-xl">
      <img src={pod.image} alt={pod.name} className="mb-4 h-48 w-full rounded-lg border border-slate-800 object-cover" />
      <h3 className="mb-3 truncate text-sm font-bold text-slate-200">{pod.name}</h3>

      <div className="my-3 space-y-2 border-y border-slate-800/60 py-3 text-slate-400">
        <div className="truncate"><span className="text-indigo-400">story[ip_id]:</span> {pod.storyIpId ? short(pod.storyIpId, 10, 6) : 'UNSET'}</div>
        <div className="truncate"><span className="text-indigo-400">story[license_id]:</span> {pod.storyLicenseId ?? 'UNSET'}</div>
        <div className="truncate"><span className="text-indigo-400">cdr[vault_id]:</span> {pod.cdrVaultId ? short(pod.cdrVaultId, 14, 0) : 'UNSET'}</div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {!pod.isRegistered ? (
          <button onClick={handleRegister} disabled={processing} className="w-full rounded bg-indigo-600 py-2 font-bold text-white transition-all hover:bg-indigo-500 disabled:opacity-50">
            {processing ? 'MINTING IP ASSET...' : 'Register on Story L1'}
          </button>
        ) : !pod.hasVault ? (
          <button onClick={handleProvision} disabled={processing} className="w-full rounded bg-emerald-600 py-2 font-bold text-white transition-all hover:bg-emerald-500 disabled:opacity-50">
            {processing ? 'PROVISIONING...' : 'Provision CDR Stems Vault'}
          </button>
        ) : (
          <button onClick={handleUnlock} disabled={processing} className="w-full rounded border border-indigo-500/30 bg-slate-800 py-2 font-bold text-indigo-400 transition-all hover:bg-slate-700 disabled:opacity-50">
            {processing ? 'UNLOCKING...' : 'Access Sovereign IP Pod'}
          </button>
        )}
      </div>

      {status && <div className="mt-3 truncate rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">{status}</div>}
      {error && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}
    </div>
  );
}
