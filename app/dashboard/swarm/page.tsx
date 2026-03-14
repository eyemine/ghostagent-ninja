'use client';

/**
 * /dashboard/swarm
 *
 * Vertex hackathon demo page.
 * Shows: swarm coordinator members + task assignment, live consensus rounds, Ghost-Tunnel handshake.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import SwarmCoordinatorDashboard from '../../components/SwarmCoordinatorDashboard';
import SwarmConsensus from '../../components/SwarmConsensus';
import { GhostHandshakePanel } from '../../components/GhostHandshakePanel';

const GHOST_LOGO = '/ghost-logo.png';

const DEMO_VAULTS = [
  {
    name:        'ghostagent',
    tld:         'vault.gno',
    safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    agentId:     3184,
    ghostId:     '0xC70',
    memberCount: 3,
    xmtpEnabled: false,
  },
];

type PanelTab = 'coordinator' | 'consensus' | 'handshake';

const PANEL_TABS: { id: PanelTab; label: string; desc: string }[] = [
  { id: 'coordinator', label: '🤝 Swarm Coordinator', desc: 'Add members, assign tasks'   },
  { id: 'consensus',   label: '🗳️ Consensus Rounds',   desc: 'Propose, vote, resolve'     },
  { id: 'handshake',   label: '🌐 Ghost-Tunnel',        desc: 'Sign & register EIP-712'    },
];

export default function SwarmDemoPage() {
  const { authenticated } = usePrivy();
  const { wallets }       = useWallets();
  const connectedWallet   = wallets[0]?.address ?? '';

  const [vaultIdx, setVaultIdx] = useState(0);
  const [panelTab, setPanelTab] = useState<PanelTab>('coordinator');

  const vault = DEMO_VAULTS[vaultIdx];

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">Swarm Coordination</h1>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300 ring-1 ring-violet-500/20">
                Vertex Demo
              </span>
              <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/20">
                Ghost-Tunnel
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Multi-agent swarm consensus · EIP-712 Ghost-Tunnel handshake · A2A routing
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

      {/* ── Architecture explainer ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: '🤝',
            title: 'SwarmCoordinatorModule',
            body:  'On-chain Safe module. Adds swarm members (agents), assigns tasks, routes A2A traffic between cloud and Ghost-Tunnel endpoints.',
            color: 'border-violet-500/20 bg-violet-500/5',
            label: 'text-violet-300',
          },
          {
            icon: '🗳️',
            title: 'Consensus Engine',
            body:  'XMTP Group Chat (E2EE) or Encrypted Email (ECIES). 51% quorum majority. Glass Box audit trail for every resolved round.',
            color: 'border-amber-500/20 bg-amber-500/5',
            label: 'text-amber-300',
          },
          {
            icon: '🌐',
            title: 'Ghost-Tunnel Handshake',
            body:  'EIP-712 signed by Gnosis Safe (EIP-1271). Registers tunnel endpoint in KV. Heartbeat refresh every 5 min. Auto-staleness detection.',
            color: 'border-fuchsia-500/20 bg-fuchsia-500/5',
            label: 'text-fuchsia-300',
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

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">

        {/* ── Left: vault selector + panel ── */}
        <div className="space-y-4">

          {/* Vault selector */}
          <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">VAULT AGENT</div>
              <div className="flex gap-2 flex-wrap">
                {DEMO_VAULTS.map((v, i) => (
                  <button
                    key={i}
                    onClick={() => setVaultIdx(i)}
                    className={`flex flex-col gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-all ${
                      vaultIdx === i
                        ? 'border-violet-500/40 bg-violet-500/8'
                        : 'border-[rgba(176,128,92,0.15)] bg-transparent hover:border-[rgba(176,128,92,0.3)]'
                    }`}
                  >
                    <span className="text-xs font-semibold text-[#f2eee4]">{v.name}.{v.tld}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      agentId <span className="text-[#b0805c]">{v.agentId}</span> · {v.memberCount} members
                    </span>
                    <span className="font-mono text-[9px] text-zinc-500">
                      {v.safeAddress.slice(0, 6)}…{v.safeAddress.slice(-4)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Panel tab bar */}
            <div className="flex gap-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-1">
              {PANEL_TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setPanelTab(t.id)}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                    panelTab === t.id
                      ? 'bg-[rgba(176,128,92,0.15)] text-[#f2eee4]'
                      : 'text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {!authenticated ? (
              <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)] px-6 py-10 text-center">
                <p className="text-sm text-[var(--muted)]">Connect your wallet to interact.</p>
                <p className="mt-1 text-xs text-zinc-600">Privy wallet or injected provider used for EIP-712 signing.</p>
              </div>
            ) : (
              <>
                {panelTab === 'coordinator' && (
                  <SwarmCoordinatorDashboard
                    vaultName={vault.name}
                    walletAddress={connectedWallet}
                  />
                )}
                {panelTab === 'consensus' && (
                  <SwarmConsensus
                    vaultName={vault.name}
                    walletAddress={connectedWallet}
                    xmtpEnabled={vault.xmtpEnabled}
                    memberCount={vault.memberCount}
                  />
                )}
                {panelTab === 'handshake' && (
                  <GhostHandshakePanel
                    agentName={`${vault.name}.${vault.tld}`}
                    safeAddress={vault.safeAddress}
                    ghostId={vault.ghostId}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Right: flow diagram + ERC-8004 context ── */}
        <div className="space-y-3">

          {/* A2A flow */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-4 space-y-3">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">A2A SWARM FLOW</div>
            <div className="space-y-1">
              {[
                { step: '1', label: 'Agent receives task via nftmail / XMTP / A2A-RPC' },
                { step: '2', label: 'SwarmCoordinator routes to member pool' },
                { step: '3', label: 'Members vote → consensus hash logged to Glass Box' },
                { step: '4', label: 'Ghost agents routed via Ghost-Tunnel (EIP-712 verified)' },
                { step: '5', label: 'Output archived to Arweave (Ghost tier only)' },
                { step: '6', label: 'IP registered to Story Protocol, royalties → Safe' },
              ].map(s => (
                <div key={s.step} className="flex items-start gap-2.5 text-[10px]">
                  <span className="shrink-0 h-4 w-4 rounded-full bg-[rgba(176,128,92,0.15)] flex items-center justify-center text-[8px] font-bold text-[#b0805c]">
                    {s.step}
                  </span>
                  <span className="text-[var(--muted)] leading-relaxed">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ERC-8004 context */}
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/5 p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-violet-400">ERC-8004 REGISTRY</div>
            <div className="space-y-1.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">agentId (Gnosis)</span>
                <span className="font-mono text-violet-300">{DEMO_VAULTS[vaultIdx].agentId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Safe</span>
                <span className="font-mono text-[#b0805c]">
                  {DEMO_VAULTS[vaultIdx].safeAddress.slice(0, 6)}…{DEMO_VAULTS[vaultIdx].safeAddress.slice(-4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Ghost SBT ID</span>
                <span className="font-mono text-fuchsia-300">{DEMO_VAULTS[vaultIdx].ghostId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Consensus method</span>
                <span className={DEMO_VAULTS[vaultIdx].xmtpEnabled ? 'text-emerald-300' : 'text-sky-300'}>
                  {DEMO_VAULTS[vaultIdx].xmtpEnabled ? 'XMTP' : 'Email'}
                </span>
              </div>
            </div>
            <a
              href={`https://gnosisscan.io/address/${DEMO_VAULTS[vaultIdx].safeAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[9px] text-zinc-600 hover:text-violet-300 transition"
            >
              View Safe on Gnosisscan ↗
            </a>
          </div>

          {/* Ghost-Tunnel spec */}
          <div className="rounded-xl border border-fuchsia-500/15 bg-fuchsia-500/5 p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-fuchsia-400">GHOST-TUNNEL SPEC</div>
            <div className="space-y-1 font-mono text-[9px] text-zinc-500">
              <div><span className="text-zinc-400">version:</span> 1.0-ghost</div>
              <div><span className="text-zinc-400">heartbeat TTL:</span> 5 min</div>
              <div><span className="text-zinc-400">stale threshold:</span> 10 min</div>
              <div><span className="text-zinc-400">signing:</span> EIP-712 + EIP-1271</div>
              <div><span className="text-zinc-400">storage:</span> Cloudflare KV</div>
              <div><span className="text-zinc-400">discovery:</span> ERC-8004 registry</div>
            </div>
          </div>

          {/* Worker KV actions */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">WORKER KV ACTIONS</div>
            <div className="space-y-1">
              {[
                { action: 'ghostHandshake.register',  color: 'text-fuchsia-300' },
                { action: 'ghostHandshake.heartbeat', color: 'text-amber-300'   },
                { action: 'ghostHandshake.resolve',   color: 'text-violet-300'  },
                { action: 'ghostHandshake.list',      color: 'text-sky-300'     },
                { action: 'createConsensusRound',     color: 'text-emerald-300' },
                { action: 'castVote',                 color: 'text-emerald-300' },
              ].map(a => (
                <div key={a.action} className={`font-mono text-[9px] ${a.color}`}>
                  {a.action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
