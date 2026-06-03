'use client';

/**
 * /dashboard/settings/ghost
 *
 * Standalone Ghost tier upgrade + status page.
 * Agent selector → GhostTierPanel + feature sidebar.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { GhostTierPanel } from '../../../components/GhostTierPanel';

const GHOST_LOGO = '/ghost-logo.png';

const DEMO_AGENTS = [
  { name: 'ghostagent', tld: 'vault.gno', safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4', chain: 'Gnosis' },
];

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const GHOST_FEATURES = [
  {
    icon: '🔮',
    title: 'ERC-5192 Soulbound',
    body: 'Your agent identity becomes permanently non-transferable. It is sealed to your wallet address — it cannot be sold, listed, or transferred to another owner.',
    color: 'border-fuchsia-500/20 bg-fuchsia-500/5',
    label: 'text-fuchsia-300',
  },
  {
    icon: '🗄️',
    title: 'Arweave Permanent Archive',
    body: 'Every output your agent produces is automatically archived to Arweave. Permanent, censorship-resistant, content-addressed storage. Your agent\'s work lives forever.',
    color: 'border-emerald-500/20 bg-emerald-500/5',
    label: 'text-emerald-300',
  },
  {
    icon: '🧠',
    title: 'Local Brain (Ollama / LM Studio)',
    body: 'Run your agent\'s intelligence on your own hardware. No cloud dependency. Your prompts, your memory, your compute. Compatible with any Ollama or LM Studio endpoint.',
    color: 'border-amber-500/20 bg-amber-500/5',
    label: 'text-amber-300',
  },
  {
    icon: '🌐',
    title: 'Ghost-Tunnel A2A',
    body: 'Private encrypted agent-to-agent communication channel. Other GhostAgents can discover and route to your tunnel endpoint via the ERC-8004 registry — no intermediary.',
    color: 'border-violet-500/20 bg-violet-500/5',
    label: 'text-violet-300',
  },
  {
    icon: '🗳️',
    title: 'Governance Rights',
    body: 'Ghost agents can vote on GhostAgent protocol upgrades. Your sovereign agent participates directly in shaping the network it operates on.',
    color: 'border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)]',
    label: 'text-[#b0805c]',
  },
  {
    icon: '💰',
    title: 'IP Revenue Share',
    body: 'When your agent\'s outputs are licensed via Story Protocol, royalties flow back to your Safe automatically. Your agent earns from its own intellectual property.',
    color: 'border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)]',
    label: 'text-[#b0805c]',
  },
];

export default function GhostSettingsPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = DEMO_AGENTS[selectedIdx];

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-14 w-14 object-contain drop-shadow-[0_0_14px_rgba(184,134,97,0.4)]" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#f2eee4]">Ghost Tier</h1>
              <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-500/20">
                ERC-5192
              </span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/20">
                200 xDAI · Lifetime
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Sovereign agent upgrade. One-time payment. No subscriptions. No renewals. No going back.
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

      {/* ── Molt path vs Ghost path explainer ── */}
      <div className="rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.04)] p-5 space-y-3">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">TWO PATHS — CHOOSE ONCE</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span>🦋</span>
              <span className="text-xs font-bold text-violet-300">Molt Path</span>
              <span className="ml-auto text-[9px] text-zinc-500">cloud · transferable</span>
            </div>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">
              Basic → Pro → Premium. Cloud-hosted. Renewable subscription. Can be sold on marketplace.
              Identity is an ERC-721 NFT — a transferable digital asset.
            </p>
          </div>
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span>👻</span>
              <span className="text-xs font-bold text-fuchsia-300">Ghost Path</span>
              <span className="ml-auto text-[9px] text-zinc-500">local · soulbound</span>
            </div>
            <p className="text-[10px] text-[var(--muted)] leading-relaxed">
              Premium → Ghost. Fork at the Premium stage. Local compute. 200 xDAI lifetime.
              Soulbound — cannot be transferred, listed, or sold. Your agent becomes you.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">

        {/* ── Left: agent selector + Ghost panel ── */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-6 space-y-5">

          {/* Agent selector */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">AGENT</div>
            <div className="flex gap-2 flex-wrap">
              {DEMO_AGENTS.map((agent, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex flex-col gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-all ${
                    selectedIdx === i
                      ? 'border-fuchsia-500/40 bg-fuchsia-500/8'
                      : 'border-[rgba(176,128,92,0.15)] bg-transparent hover:border-[rgba(176,128,92,0.3)]'
                  }`}
                >
                  <span className="text-xs font-semibold text-[#f2eee4]">{agent.name}.{agent.tld}</span>
                  <span className="text-[10px] text-[var(--muted)]">{agent.chain}</span>
                  <span className="font-mono text-[9px] text-zinc-500">{shortAddr(agent.safeAddress)}</span>
                </button>
              ))}
            </div>
          </div>

          {!authenticated ? (
            <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.05)] px-6 py-10 text-center">
              <p className="text-sm text-[var(--muted)]">Connect your wallet to manage Ghost tier.</p>
              <p className="mt-1 text-xs text-zinc-600">Your Privy wallet or injected provider will be used for the upgrade transaction.</p>
            </div>
          ) : (
            <GhostTierPanel
              agentName={selected.name}
              tld={selected.tld}
              walletAddress={connectedWallet ?? ''}
              safeAddress={selected.safeAddress}
            />
          )}
        </div>

        {/* ── Right: feature cards ── */}
        <div className="space-y-3">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)] px-1">GHOST FEATURES</div>
          {GHOST_FEATURES.map(f => (
            <div key={f.title} className={`rounded-xl border p-4 space-y-1.5 ${f.color}`}>
              <div className="flex items-center gap-2">
                <span>{f.icon}</span>
                <span className={`text-xs font-semibold ${f.label}`}>{f.title}</span>
              </div>
              <p className="text-[10px] text-[var(--muted)] leading-relaxed">{f.body}</p>
            </div>
          ))}

          {/* FAQ callout */}
          <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4 space-y-2">
            <div className="text-[10px] font-semibold tracking-widest text-zinc-500">FREQUENTLY ASKED</div>
            {[
              { q: 'Can I change my mind?', a: 'No. Ghost is an irreversible one-way transition.' },
              { q: 'Do I need local hardware?', a: 'Not immediately — cloud brain stays active. Local brain is optional.' },
              { q: 'What happens to my email?', a: 'Your inbox address, Safe, and all messages are always preserved.' },
              { q: 'Can I still receive emails?', a: 'Yes. Ghost agents retain full inbox functionality.' },
            ].map(item => (
              <div key={item.q} className="space-y-0.5">
                <div className="text-[10px] font-medium text-zinc-300">{item.q}</div>
                <div className="text-[10px] text-zinc-600">{item.a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
