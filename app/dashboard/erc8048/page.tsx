'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { PodCard } from '../../components/chonk/PodCard';
import { fetchPodMetadataForWallet } from '../../services/envio';
import type { ChonkPodMetadata } from '../../types/indexer';

export default function Erc8048Dashboard() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [pods, setPods] = useState<ChonkPodMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userAddress = useMemo(() => wallets[0]?.address ?? '', [wallets]);

  const loadIdentityData = useCallback(async () => {
    if (!userAddress) {
      setPods([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const mappedPods = await fetchPodMetadataForWallet(userAddress);
      setPods(mappedPods);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query Envio HyperIndex state');
      setPods([]);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    if (!ready) return;
    void loadIdentityData();
  }, [ready, loadIdentityData]);

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-white">
      <header className="mb-8">
        <Link href="/dashboard" className="text-xs text-slate-500 transition hover:text-slate-300">← Dashboard</Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Sovereign IP Pod Matrix (ERC-8048)</h1>
        <p className="mt-1 font-mono text-sm text-slate-400">Sovereign Data Storage via Story Protocol CDR & Envio</p>
      </header>

      {!authenticated && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-6">
          <p className="text-sm text-indigo-100">Connect your wallet to scan Chonk pods and map ERC-8048 CDR state.</p>
          <button onClick={login} className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">
            Connect Wallet
          </button>
        </div>
      )}

      {authenticated && loading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 font-mono text-sm text-slate-400">
          Querying Envio HyperIndex state...
        </div>
      )}

      {authenticated && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
          {error}
        </div>
      )}

      {authenticated && !loading && !error && pods.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-sm text-slate-300">No Chonk pods found for this wallet.</p>
          <p className="mt-2 font-mono text-xs text-slate-500">Set NEXT_PUBLIC_CDR_DEMO_CHONK_TOKEN_IDS for a hackathon demo wallet, or connect a wallet that owns Base Chonks.</p>
        </div>
      )}

      {authenticated && pods.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {pods.map((pod) => (
            <PodCard key={pod.tokenId} pod={pod} userAddress={userAddress} refreshData={loadIdentityData} />
          ))}
        </div>
      )}
    </div>
  );
}
