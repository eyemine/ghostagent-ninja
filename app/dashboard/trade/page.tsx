'use client';

/**
 * /dashboard/trade
 *
 * Standalone EIP-712 TradeIntent page.
 * Full-width layout with agent selector, TradeIntentPanel, and ERC-8004 context.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { TradeIntentPanel } from '../../components/TradeIntentPanel';
import { TradingDashboard } from '../../components/TradingDashboard';
import { TRADE_INTENT_DOMAIN, TRADE_INTENT_TYPES } from '../../services/trade-intent';

const GHOST_LOGO = '/ghost-logo.png';

// Known agent — populated from ERC-8004 registry; stub for now
const DEMO_AGENTS = [
  { name: 'ghostagent.vault.gno', agentId: 3184,  safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4', chain: 'Gnosis' },
  { name: 'ghostagent.vault.gno', agentId: 1766,  safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4', chain: 'Base Sepolia' },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TradePage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [panelTab,    setPanelTab]    = useState<'intent' | 'execute'>('intent');
  const selected = DEMO_AGENTS[selectedIdx];

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#f2eee4]">TradeIntent</h1>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300 ring-1 ring-violet-500/20">
                EIP-712
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/20">
                ERC-8004
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Sign agent trade orders with EIP-712 typed data. Artifacts submitted to the ERC-8004 Validation Registry.
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

      {/* ── EIP-712 explainer strip ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: '🔏',
            title: 'EIP-712 Typed Data',
            body: 'Each TradeIntent is signed as structured typed data — not a raw hash. The signature proves the agent authorised the specific trade parameters.',
            color: 'border-violet-500/20 bg-violet-500/5',
            labelColor: 'text-violet-300',
          },
          {
            icon: '📡',
            title: 'ERC-8004 Validation',
            body: 'The signed artifact is stored as a requestUri in the ERC-8004 Validation Registry. Any party can verify the agent signed this exact trade.',
            color: 'border-amber-500/20 bg-amber-500/5',
            labelColor: 'text-amber-300',
          },
          {
            icon: '🏦',
            title: 'Gnosis Safe Signing',
            body: 'The agent\'s Gnosis Safe is the EIP-1271 signer. Signature is chain-bound via chainId 100 — cannot be replayed on other networks.',
            color: 'border-emerald-500/20 bg-emerald-500/5',
            labelColor: 'text-emerald-300',
          },
        ].map(card => (
          <div key={card.title} className={`rounded-xl border p-4 ${card.color}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span>{card.icon}</span>
              <span className={`text-xs font-semibold ${card.labelColor}`}>{card.title}</span>
            </div>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">{card.body}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

        {/* ── Left: tab-switched panel ── */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-6 space-y-5">

          {/* Agent selector */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">SIGNING AGENT</div>
            <div className="flex gap-2">
              {DEMO_AGENTS.map((agent, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex flex-col gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-all ${
                    selectedIdx === i
                      ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.1)]'
                      : 'border-[rgba(176,128,92,0.15)] bg-transparent hover:border-[rgba(176,128,92,0.3)]'
                  }`}
                >
                  <span className="text-xs font-semibold text-[#f2eee4]">{agent.name}</span>
                  <span className="text-[10px] text-[var(--muted)]">
                    agentId <span className="text-[#b0805c]">{agent.agentId}</span> · {agent.chain}
                  </span>
                  <span className="font-mono text-[9px] text-zinc-500">{shortAddr(agent.safeAddress)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Panel tab bar */}
          <div className="flex gap-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-1">
            {(['intent', 'execute'] as const).map(t => (
              <button
                key={t}
                onClick={() => setPanelTab(t)}
                className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                  panelTab === t
                    ? 'bg-[rgba(176,128,92,0.15)] text-[#f2eee4]'
                    : 'text-[var(--muted)] hover:text-[#f2eee4]'
                }`}
              >
                {t === 'intent' ? '🔏 Sign Intent' : '📈 Execute Trade'}
              </button>
            ))}
          </div>

          {!authenticated ? (
            <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)] px-6 py-10 text-center">
              <p className="text-sm text-[var(--muted)]">Connect your wallet to continue.</p>
              <p className="mt-1 text-xs text-zinc-600">Privy wallet or injected provider used for EIP-712 signing.</p>
            </div>
          ) : panelTab === 'intent' ? (
            <TradeIntentPanel
              agentName={selected.name}
              agentId={selected.agentId}
              safeAddress={selected.safeAddress}
            />
          ) : (
            <TradingDashboard
              agentName={selected.name}
              agentId={selected.agentId}
              safeAddress={selected.safeAddress}
            />
          )}

          {connectedWallet && (
            <p className="text-[10px] text-[var(--muted)]">
              Connected: <span className="font-mono text-[#b0805c]">{shortAddr(connectedWallet)}</span>
            </p>
          )}
        </div>

        {/* ── Right: EIP-712 schema reference ── */}
        <div className="space-y-4">

          {/* Domain */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">EIP-712 DOMAIN</div>
            <div className="space-y-1 font-mono text-[10px]">
              {Object.entries(TRADE_INTENT_DOMAIN).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-[var(--muted)] shrink-0">{k}</span>
                  <span className="text-[#f2eee4] truncate text-right">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Struct fields */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">TRADEINTENT STRUCT</div>
            <div className="space-y-1 font-mono text-[10px]">
              {TRADE_INTENT_TYPES.TradeIntent.map(field => (
                <div key={field.name} className="flex justify-between gap-2">
                  <span className="text-[#b0805c]">{field.name}</span>
                  <span className="text-violet-300">{field.type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ERC-8004 flow */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">ERC-8004 VALIDATION FLOW</div>
            <ol className="space-y-2 text-[10px] text-[var(--muted)]">
              {[
                { step: '1', label: 'Sign TradeIntent', detail: 'eth_signTypedData_v4 via wallet' },
                { step: '2', label: 'Store artifact', detail: 'KV → Glass Box audit entry' },
                { step: '3', label: 'Get requestUri', detail: 'Worker permalink to artifact' },
                { step: '4', label: 'Submit to registry', detail: 'validate(agentId, requestHash, requestUri)' },
                { step: '5', label: 'Verification', detail: 'Any party can fetch + verify sig' },
              ].map(row => (
                <li key={row.step} className="flex gap-2">
                  <span className="shrink-0 rounded-full bg-violet-500/20 h-4 w-4 text-center text-[9px] font-bold text-violet-300 leading-4">{row.step}</span>
                  <div>
                    <span className="text-[#f2eee4]">{row.label}</span>
                    <span className="text-zinc-600"> — {row.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Links */}
          <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] p-4 space-y-1.5">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">REGISTRIES</div>
            {[
              {
                label: 'Identity Registry (Gnosis)',
                href:  'https://gnosisscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
                addr:  '0x8004A169…',
              },
              {
                label: 'Identity Registry (Base Sepolia)',
                href:  'https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e',
                addr:  '0x8004A818…',
              },
            ].map(link => (
              <a
                key={link.addr}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 text-[10px] text-[var(--muted)] hover:text-[#b0805c] transition"
              >
                <span>{link.label}</span>
                <span className="font-mono">{link.addr} ↗</span>
              </a>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
