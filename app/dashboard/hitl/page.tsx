'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';

import HITLPanel from '../../components/HITLPanel';
import HITLDeployPanel from '../../components/HITLDeployPanel';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const GHOST_LOGO = '/ghost-logo.png';

type Tab = 'deploy' | 'manage';

export default function HITLPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('deploy');
  const [safeInput, setSafeInput] = useState('');

  const connectedWallet = wallets[0]?.address ?? '';

  // Priority: ?safe param > worker lookup via ?agent param > connected wallet
  useEffect(() => {
    const safeParam  = searchParams.get('safe');
    const agentParam = searchParams.get('agent');

    if (safeParam && safeParam.startsWith('0x')) {
      setSafeInput(safeParam);
      return;
    }

    if (agentParam) {
      fetch(`/api/agent-lookup?q=${agentParam}`)
        .then(r => r.json() as Promise<{ safeAddress?: string; safe?: string }>)
        .then(d => { if (d.safeAddress || d.safe) setSafeInput(d.safeAddress ?? d.safe ?? ''); })
        .catch(() => {});
      return;
    }

    if (connectedWallet && !safeInput) setSafeInput(connectedWallet);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedWallet, searchParams]);

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={GHOST_LOGO}
            alt="GhostAgent"
            className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">Human-In-The-Loop Gates</h1>
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-500/20">
                Safe Module
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                Gnosis Chain
              </span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300 ring-1 ring-violet-500/20">
                Self-Service
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Spending gates for any agent Safe — deploy your own module, set your own threshold
            </p>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:text-white"
        >
          ← Dashboard
        </Link>
      </div>

      {/* Explainer cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: '⚡',
            title: 'Below Threshold',
            body: 'Transactions at or below the spending threshold execute immediately via the Safe module. No queuing, no delays.',
            color: 'border-emerald-500/20 bg-emerald-500/5',
            label: 'text-emerald-300',
          },
          {
            icon: '⏳',
            title: 'Above Threshold',
            body: 'High-value transactions are queued on-chain. A Safe owner must approve via multi-sig within the TTL window before the tx executes.',
            color: 'border-amber-500/20 bg-amber-500/5',
            label: 'text-amber-300',
          },
          {
            icon: '🚨',
            title: 'Emergency Pause',
            body: 'Any Safe owner can instantly halt all execution. Unpausing requires the full Safe multi-sig — a single signer cannot restart a compromised agent.',
            color: 'border-red-500/20 bg-red-500/5',
            label: 'text-red-300',
          },
        ].map(c => (
          <div key={c.title} className={`rounded-xl border p-4 space-y-1.5 ${c.color}`}>
            <div className="flex items-center gap-2">
              <span>{c.icon}</span>
              <span className={`text-xs font-semibold ${c.label}`}>{c.title}</span>
            </div>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>

      {/* Funding Warning */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
        <span className="text-lg">⚠️</span>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-amber-300">HITL Agent Funding Required</p>
          <p className="text-[10px] text-[var(--muted)] leading-relaxed">
            Ensure the HITL agent address has sufficient native token (xDAI on Gnosis, ETH on Base) 
            to cover gas for all transactions that may be executed. Failed transactions due to 
            insufficient funds will revert and may queue indefinitely.
          </p>
        </div>
      </div>

      {!authenticated ? (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] px-6 py-12 text-center space-y-2">
          <p className="text-sm text-[var(--muted)]">Connect your wallet to deploy or manage a HITL module.</p>
          <p className="text-xs text-zinc-600">Your connected wallet must be a Safe owner.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-6 space-y-5">

          {/* Tab bar */}
          <div className="flex gap-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-1">
            {([
              { id: 'deploy' as Tab, label: '🚀 Deploy Module', desc: 'Self-service — any Safe' },
              { id: 'manage' as Tab, label: '🎛️ Manage Module', desc: 'ghostagent reference instance' },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all ${
                  tab === t.id
                    ? 'bg-[rgba(176,128,92,0.15)] text-[#f2eee4]'
                    : 'text-[var(--muted)] hover:text-[#f2eee4]'
                }`}
              >
                <div>{t.label}</div>
                <div className="text-[9px] font-normal opacity-60 mt-0.5">{t.desc}</div>
              </button>
            ))}
          </div>

          {tab === 'deploy' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-3">
                <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                  Each Safe gets its own isolated module instance — deployed via the{' '}
                  <span className="text-violet-300 font-medium">HITLModuleFactory</span>.
                  Your Safe address is pre-filled from your connected wallet.
                  After deployment, add the returned address as a module in your Safe settings.
                </p>
              </div>
              {connectedWallet ? (
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">YOUR SAFE ADDRESS</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={safeInput}
                      onChange={e => setSafeInput(e.target.value)}
                      className="flex-1 rounded-lg border border-zinc-700/40 bg-zinc-800/30 px-3 py-1.5 font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-[rgba(176,128,92,0.4)]"
                      placeholder="0x… your Gnosis Safe address"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600">
                    If your Safe address differs from your connected wallet, paste it above.
                  </p>
                  <HITLDeployPanel safeAddress={safeInput} />
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Connect wallet to continue.</p>
              )}
            </div>
          ) : (
            <HITLPanel />
          )}

        </div>
      )}

    </div>
  );
}
