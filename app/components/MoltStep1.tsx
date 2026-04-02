'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSafeAuth } from '../hooks/useSafeAuth';

export interface SourceAgent {
  name: string;
  namespace: string;
  tba: string;
  tier: string;
  currentIdentity: string;
  originNft: string;
  ownerWallet: string;
  totalXdaiBurned: number;
  surgeReputationScore: number;
  ipDomains: Array<{ type: 'creation.ip' | 'moltbook.ip'; cid: string; minted_at: number; domain?: string }>;
  ipPrimary: string | null;  // e.g. 'creation.ip'
}

interface MoltStep1Props {
  onSelect: (agent: SourceAgent) => void;
}

export function MoltStep1({ onSelect }: MoltStep1Props) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { isSafeAuth, safeAddress } = useSafeAuth();
  const [agentName, setAgentName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<SourceAgent | null>(null);

  const connectedWallet = isSafeAuth ? safeAddress : wallets[0]?.address;
  const isConnected = authenticated || isSafeAuth;

  async function handleLookup(name?: string) {
    const lookupName = name || agentName;
    if (!lookupName.trim() || !connectedWallet) return;
    setLoading(true);
    setError(null);
    setFound(null);
    try {
      // Use validate endpoint — checks existence + ownership in one call
      const res = await fetch('/api/molt/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: lookupName.trim(),
          callerWallet: connectedWallet,
          targetName: '_placeholder',   // step 1 only checks source ownership
          targetTld: 'molt.gno',
        }),
      });
      const data = await res.json() as any;

      // Ownership errors block selection; target errors are step-2 concerns
      const ownershipErrors = (data.errors ?? []).filter((e: string) =>
        !e.includes('Target') && !e.includes('target') && !e.includes('tier') && !e.includes('Tier')
      );
      // For beacon NFT owners, ignore tier errors
      if (ownershipErrors.length > 0) {
        setError(ownershipErrors[0]);
        return;
      }
      if (!data.sourceAgent) {
        setError('Agent-Body not found — verify you own the beacon NFT');
        return;
      }
      const s = data.sourceAgent;
      setFound({
        name: lookupName.trim(),
        namespace: s.tld ?? 'nftmail.gno',
        tba: s.tbaAddress ?? '—',
        tier: s.tier ?? 'basic',
        currentIdentity: lookupName.trim(),
        originNft: s.originNft ?? `${lookupName.trim()}.nftmail.gno`,
        ownerWallet: s.onChainOwner,
        totalXdaiBurned: s.totalXdaiBurned ?? 0,
        surgeReputationScore: s.surgeReputationScore ?? 0,
        ipDomains: s.ipDomains ?? [],
        ipPrimary: s.ipPrimary ?? null,
      });
    } catch {
      setError('Lookup failed — check your connection');
    } finally {
      setLoading(false);
    }
  }

  // Listen for auto-lookup event from parent page
  useEffect(() => {
    const handleAutoLookup = (e: CustomEvent<{ agentName: string }>) => {
      setAgentName(e.detail.agentName);
      handleLookup(e.detail.agentName);
    };
    window.addEventListener('molt:autoLookup', handleAutoLookup as EventListener);
    return () => window.removeEventListener('molt:autoLookup', handleAutoLookup as EventListener);
  }, [connectedWallet]);

  if (!isConnected) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-center">
        <div className="text-sm text-amber-200">Connect your wallet to look up owned agents</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Enter the agent name you own. We'll verify ownership against the connected wallet{' '}
        <span className="font-mono text-white">{connectedWallet?.slice(0, 6)}...{connectedWallet?.slice(-4)}</span>.
      </p>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/_+$/, ''))}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. ghostagent"
            className="w-full rounded-xl border border-[var(--border)] bg-black/40 px-4 py-3 pr-16 text-sm text-white placeholder-zinc-600 outline-none focus:border-amber-500/40"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--muted)]">_@nftmail.box</span>
        </div>
        <button
          onClick={() => handleLookup()}
          disabled={!agentName.trim() || loading}
          className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-40"
        >
          {loading ? '...' : 'Find'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">{error}</div>
      )}

      {found && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <div className="text-sm font-semibold text-white">{found.name}_@nftmail.box</div>
                <div className="text-[10px] text-[var(--muted)]">{found.namespace} · {found.tier}</div>
              </div>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
              ✓ Owned
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg bg-black/30 px-3 py-2">
              <div className="text-[var(--muted)]">TBA</div>
              <div className="font-mono text-white">{found.tba.slice(0, 10)}...</div>
            </div>
            <div className="rounded-lg bg-black/30 px-3 py-2">
              <div className="text-[var(--muted)]">xDAI burned</div>
              <div className="font-semibold text-amber-300">{found.totalXdaiBurned.toFixed(1)}</div>
            </div>
          </div>
          <button
            onClick={() => onSelect(found)}
            className="w-full rounded-xl bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/30"
          >
            Select {found.name}_ → Continue
          </button>
        </div>
      )}
    </div>
  );
}
