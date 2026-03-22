'use client';

/**
 * HITLPanel — Human-In-The-Loop Module UI
 *
 * Reads live on-chain state from HumanInTheLoopModule and provides:
 *   - Emergency Pause (any Safe owner — direct wallet tx)
 *   - Deep-links to Safe UI for approveAndExecute / setThreshold (require Safe multi-sig)
 *
 * Contract: 0x012A0571d0DFd7eF85d0706875FEc39555e99A96 (Gnosis mainnet)
 * Threshold: 1 xDAI default · Approval TTL: 24h
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createPublicClient, http, parseAbi, formatEther, parseEther } from 'viem';
import { gnosis } from 'viem/chains';

const HITL_ADDRESS = '0x012A0571d0DFd7eF85d0706875FEc39555e99A96' as const;
const SAFE_ADDRESS  = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4' as const;

const HITL_ABI = parseAbi([
  'function threshold() view returns (uint256)',
  'function emergencyPaused() view returns (bool)',
  'function approvalTtl() view returns (uint256)',
  'function getPendingCount() view returns (uint256)',
  'function emergencyPause()',
]);

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http('https://rpc.gnosischain.com'),
});

interface HITLState {
  threshold: bigint;
  emergencyPaused: boolean;
  approvalTtl: bigint;
  pendingCount: bigint;
}

interface Props {
  moduleAddress?: string;
  safeAddress?: string;
}

export default function HITLPanel({
  moduleAddress = HITL_ADDRESS,
  safeAddress   = SAFE_ADDRESS,
}: Props) {
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [state, setState]   = useState<HITLState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseTx, setPauseTx] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const addr = moduleAddress as `0x${string}`;
      const [threshold, emergencyPaused, approvalTtl, pendingCount] = await Promise.all([
        publicClient.readContract({ address: addr, abi: HITL_ABI, functionName: 'threshold' }),
        publicClient.readContract({ address: addr, abi: HITL_ABI, functionName: 'emergencyPaused' }),
        publicClient.readContract({ address: addr, abi: HITL_ABI, functionName: 'approvalTtl' }),
        publicClient.readContract({ address: addr, abi: HITL_ABI, functionName: 'getPendingCount' }),
      ]);
      setState({ threshold, emergencyPaused, approvalTtl, pendingCount });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read contract');
    } finally {
      setLoading(false);
    }
  }, [moduleAddress]);

  useEffect(() => { load(); }, [load]);

  async function handleEmergencyPause() {
    if (!connectedWallet) return;
    setPausing(true);
    setPauseError(null);
    setPauseTx(null);
    try {
      const wallet = wallets[0];
      const provider = await wallet.getEthereumProvider();
      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from:  connectedWallet,
          to:    moduleAddress,
          data:  '0xabfb1b76', // emergencyPause() selector
          value: '0x0',
        }],
      }) as string;
      setPauseTx(txHash);
      setTimeout(load, 4000);
    } catch (e) {
      setPauseError(e instanceof Error ? e.message : 'Transaction rejected');
    } finally {
      setPausing(false);
    }
  }

  const safeAppUrl = `https://app.safe.global/apps/open?safe=gno:${safeAddress}&appUrl=https%3A%2F%2Fapps.gnosis-safe.io%2Ftx-builder`;
  const setThresholdCalldata = (xdai: string) => {
    const wei = parseEther(xdai);
    const hex = wei.toString(16).padStart(64, '0');
    return `0x960bfecd${hex}`; // setThreshold(uint256) selector
  };

  const ttlHours = state ? Number(state.approvalTtl) / 3600 : 24;

  return (
    <div className="space-y-5">

      {/* Status strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Threshold',
            value: state ? `${formatEther(state.threshold)} xDAI` : '…',
            sub:   'Transactions above this require approval',
            color: 'border-amber-500/20 bg-amber-500/5',
            label2: 'text-amber-300',
          },
          {
            label: 'Status',
            value: loading ? '…' : state?.emergencyPaused ? '🔴 PAUSED' : '🟢 Active',
            sub:   state?.emergencyPaused ? 'All execution halted' : 'Executing normally',
            color: state?.emergencyPaused
              ? 'border-red-500/30 bg-red-500/8'
              : 'border-emerald-500/20 bg-emerald-500/5',
            label2: state?.emergencyPaused ? 'text-red-300' : 'text-emerald-300',
          },
          {
            label: 'Pending Approvals',
            value: state ? state.pendingCount.toString() : '…',
            sub:   'Queued txs awaiting Safe multi-sig',
            color: state?.pendingCount && state.pendingCount > 0n
              ? 'border-orange-500/30 bg-orange-500/8'
              : 'border-zinc-700/30 bg-zinc-800/10',
            label2: state?.pendingCount && state.pendingCount > 0n ? 'text-orange-300' : 'text-zinc-400',
          },
          {
            label: 'Approval TTL',
            value: `${ttlHours}h`,
            sub:   'Queued txs expire after this window',
            color: 'border-violet-500/20 bg-violet-500/5',
            label2: 'text-violet-300',
          },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-4 space-y-1 ${card.color}`}>
            <div className={`text-[10px] font-semibold tracking-widest ${card.label2}`}>{card.label.toUpperCase()}</div>
            <div className="text-lg font-bold text-[#f2eee4]">{card.value}</div>
            <div className="text-[10px] text-[var(--muted)]">{card.sub}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-300">
          RPC error: {error} · <button onClick={load} className="underline hover:text-white">retry</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">

        {/* Emergency Pause — direct wallet call */}
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🚨</span>
              <span className="text-sm font-semibold text-red-300">Emergency Pause</span>
              <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/20">
                Owner action — direct tx
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">
              Instantly halts all transaction execution through the module. Any Safe owner can call this
              directly — no multi-sig required. Use when an agent is behaving unexpectedly.
            </p>
          </div>

          <div className="rounded-xl border border-red-500/10 bg-black/30 px-3 py-2 font-mono text-[10px] text-zinc-500">
            <span className="text-red-400">emergencyPause</span>() → onlyOwner · immediate
          </div>

          {state?.emergencyPaused ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-center text-xs font-semibold text-red-300">
                🔴 Module is currently paused
              </div>
              <p className="text-[10px] text-[var(--muted)] text-center">
                To unpause, the Safe multi-sig must call <code className="text-violet-300">emergencyUnpause()</code> via Safe UI below.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={handleEmergencyPause}
                disabled={pausing || !connectedWallet}
                className="w-full rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pausing ? 'Submitting…' : !connectedWallet ? 'Connect wallet to pause' : '🚨 Trigger Emergency Pause'}
              </button>
              {pauseTx && (
                <a
                  href={`https://gnosisscan.io/tx/${pauseTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[10px] text-emerald-400 hover:underline"
                >
                  ✓ Tx submitted — view on Gnosisscan ↗
                </a>
              )}
              {pauseError && (
                <div className="text-[10px] text-red-400 text-center">{pauseError}</div>
              )}
            </>
          )}
        </div>

        {/* Safe multi-sig actions */}
        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🏦</span>
              <span className="text-sm font-semibold text-violet-300">Safe Multi-Sig Actions</span>
              <span className="ml-auto rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold text-violet-300 ring-1 ring-violet-500/20">
                Requires Safe signing
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">
              These actions require the full Gnosis Safe multi-sig flow. Open Safe Transaction Builder
              and paste the calldata below to queue the transaction for signing.
            </p>
          </div>

          <div className="space-y-2">

            {/* Approve pending tx */}
            <div className="rounded-xl border border-violet-500/15 bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-violet-200">Approve Pending Transaction</span>
                {state?.pendingCount && state.pendingCount > 0n ? (
                  <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[9px] font-bold text-orange-300">
                    {state.pendingCount.toString()} pending
                  </span>
                ) : (
                  <span className="text-[9px] text-zinc-600">none pending</span>
                )}
              </div>
              <p className="text-[10px] text-zinc-500">
                Call <code className="text-violet-300">approveAndExecute(bytes32 txHash)</code> with the queued tx hash from the HITL queue.
              </p>
              <a
                href={safeAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-[10px] text-violet-300 hover:bg-violet-500/10 transition"
              >
                <span>Open Safe Transaction Builder ↗</span>
                <span className="font-mono text-[9px] text-zinc-500">{HITL_ADDRESS.slice(0,10)}…</span>
              </a>
            </div>

            {/* Set threshold */}
            <div className="rounded-xl border border-amber-500/15 bg-black/20 p-3 space-y-2">
              <span className="text-xs font-medium text-amber-200">Update Threshold</span>
              <p className="text-[10px] text-zinc-500">
                Current: <span className="text-amber-300">{state ? formatEther(state.threshold) : '…'} xDAI</span>.
                Call <code className="text-amber-300">setThreshold(uint256)</code> with new value in wei.
              </p>
              <div className="space-y-1">
                {['0.1', '0.5', '1', '5', '10'].map(xdai => (
                  <div key={xdai} className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-zinc-400">{xdai} xDAI →</span>
                    <code className="text-[9px] font-mono text-amber-300 truncate max-w-[200px]">
                      {setThresholdCalldata(xdai).slice(0, 18)}…
                    </code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(setThresholdCalldata(xdai))}
                      className="shrink-0 rounded border border-zinc-700/50 px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 transition"
                    >
                      copy
                    </button>
                  </div>
                ))}
              </div>
              <a
                href={safeAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300 hover:bg-amber-500/10 transition"
              >
                <span>Open Safe Transaction Builder ↗</span>
                <span className="font-mono text-[9px] text-zinc-500">setThreshold(uint256)</span>
              </a>
            </div>

            {/* Unpause */}
            {state?.emergencyPaused && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-2">
                <span className="text-xs font-medium text-red-300">Emergency Unpause</span>
                <p className="text-[10px] text-zinc-500">
                  Call <code className="text-red-300">emergencyUnpause()</code> — only the Safe can call this.
                  Selector: <code className="text-zinc-400">0x51c6590a</code>
                </p>
                <a
                  href={safeAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] text-red-300 hover:bg-red-500/10 transition"
                >
                  <span>Open Safe to Unpause ↗</span>
                  <span className="font-mono text-[9px] text-zinc-500">emergencyUnpause()</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contract reference */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] p-4">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)] mb-3">CONTRACT REFERENCE</div>
        <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2 text-[10px]">
          {[
            { label: 'Module address',  value: HITL_ADDRESS,  href: `https://gnosisscan.io/address/${HITL_ADDRESS}` },
            { label: 'Safe address',    value: safeAddress,   href: `https://app.safe.global/home?safe=gno:${safeAddress}` },
            { label: 'Verified on',     value: 'Sourcify (exact_match)', href: `https://sourcify.dev/#/lookup/${HITL_ADDRESS}` },
            { label: 'Deploy tx',       value: '0xc0fc4538…', href: 'https://gnosisscan.io/tx/0xc0fc45388d6a4788c22efd9489ad47652d1714318750b39d2fffd46694428826' },
          ].map(row => (
            <div key={row.label} className="flex justify-between gap-2">
              <span className="text-[var(--muted)] shrink-0">{row.label}</span>
              <a
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[#b0805c] hover:underline truncate max-w-[180px] text-right"
              >
                {row.value.length > 20 ? `${row.value.slice(0, 10)}…${row.value.slice(-6)}` : row.value} ↗
              </a>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)] mb-2">HOW IT WORKS</div>
          <div className="space-y-1">
            {[
              { icon: '⚡', text: 'Transactions ≤ threshold execute immediately via Safe module — no approval needed.' },
              { icon: '⏳', text: 'Transactions > threshold are queued. Safe multi-sig must approve within the TTL window.' },
              { icon: '🚨', text: 'Emergency pause halts all execution instantly. Any Safe owner can call it directly.' },
              { icon: '🔓', text: 'Unpausing requires full Safe multi-sig — prevents a single signer from resuming execution.' },
            ].map(row => (
              <div key={row.icon} className="flex gap-2 text-[10px] text-[var(--muted)]">
                <span>{row.icon}</span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={load}
        className="text-[10px] text-zinc-600 hover:text-zinc-400 transition"
      >
        ↻ Refresh on-chain state
      </button>
    </div>
  );
}
