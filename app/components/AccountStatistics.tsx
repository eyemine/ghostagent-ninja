/// Statistics component displaying nftmail.box account metrics
/// Shows on-chain verified account count with Gnosis verification badge

'use client';

import { useState, useEffect } from 'react';
import { getCachedRegistryCount } from '../utils/getRegistryCount';

export default function AccountStatistics() {
  const [stats, setStats] = useState<{ totalAccounts: bigint; formattedTotal: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await getCachedRegistryCount();
      setStats({
        totalAccounts: data.totalAccounts,
        formattedTotal: data.formattedTotal,
      });
    } catch (err) {
      setError('Failed to load statistics');
      console.error('Stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-gray-400">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (error || !stats) {
    return null;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{stats.formattedTotal}</span>
        <span className="text-sm text-gray-400">Active Accounts</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1 bg-blue-900/20 border border-blue-500/30 rounded-full">
        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs text-blue-300 font-medium">Verified on Gnosis</span>
      </div>
    </div>
  );
}
