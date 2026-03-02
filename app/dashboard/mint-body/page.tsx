'use client';

import { useState } from 'react';
import Image from 'next/image';
import { MintAgentBundle } from '../../components/MintAgentBundle';

type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';

const GHOST_LOGO = '/ghost-logo.png';

const NAMESPACES: {
  key: Namespace;
  domain: string;
  description: string;
  glassbox?: boolean;
}[] = [
  { key: 'agent',    domain: 'agent.gno',    description: 'General purpose agent identity' },
  { key: 'openclaw', domain: 'openclaw.gno', description: 'Open-claw public agent — full audit trail' },
  { key: 'molt',     domain: 'molt.gno',     description: 'Transition agent — molts to vault when ready', glassbox: true },
  { key: 'picoclaw', domain: 'picoclaw.gno', description: 'Lightweight pico agent for micro-tasks' },
  { key: 'vault',    domain: 'vault.gno',    description: 'Private vault — encrypted, sovereign identity' },
  { key: 'nftmail',  domain: 'nftmail.gno',  description: 'NFTmail agent — bundled email address' },
];

const BOTTOM_FEATURES = [
  {
    title: 'Token-Bound Account',
    desc: 'Each NFT automatically deploys a TBA (ERC-6551) on Gnosis Chain — a smart account tied to your NFT.',
  },
  {
    title: 'Sovereign Identity',
    desc: 'Transfer the NFT = transfer the agent. No migration, no re-provisioning. Same TBA address forever.',
  },
  {
    title: 'IP Registration',
    desc: 'Pro agents register on Story Protocol — your agent\'s work output is IP-protected by default.',
  },
];

export default function MintBodyPage() {
  const [selected, setSelected] = useState<Namespace>('agent');
  const [agentName, setAgentName] = useState('');

  const ns = NAMESPACES.find(n => n.key === selected)!;

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">

      {/* ── Hero: logo left of heading ── */}
      <div className="flex items-center gap-6">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
          <Image src={GHOST_LOGO} alt="GhostAgent" fill className="object-cover" unoptimized />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-[#f2eee4]">Mint Agent Body</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            Choose a namespace and name to mint your on-chain agent NFT. The NFT is your identity key —
            transfer it to transfer control.
          </p>
        </div>
      </div>

      {/* ── SELECT NAMESPACE ── */}
      <div className="space-y-3">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">SELECT NAMESPACE</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAMESPACES.map((n) => {
            const isSelected = selected === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setSelected(n.key)}
                className={`relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.08)]'
                    : 'border-[var(--border)] bg-[var(--card)] hover:border-[rgba(176,128,92,0.3)] hover:bg-[rgba(176,128,92,0.04)]'
                }`}
              >
                {n.glassbox && (
                  <span className="absolute right-3 top-3 rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold tracking-wider text-violet-300 ring-1 ring-violet-500/30">
                    GLASSBOX
                  </span>
                )}
                <span className={`text-sm font-semibold ${isSelected ? 'text-[#b0805c]' : 'text-[#f2eee4]'}`}>
                  {n.domain}
                </span>
                <span className="text-xs text-[var(--muted)]">{n.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AGENT NAME ── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">AGENT NAME</div>
        <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
          <input
            value={agentName}
            onChange={e => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="e.g. postmaster"
            className="flex-1 bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
          />
          <span className="shrink-0 text-sm text-[var(--muted)]">.{ns.domain}</span>
        </div>
      </div>

      {/* ── Mint panel ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-5">
        {agentName.length >= 2 ? (
          <MintAgentBundle
            agentName={agentName}
            safeAddress={'0x0000000000000000000000000000000000000000'}
            namespace={selected}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">Enter an agent name above to continue.</p>
        )}
      </div>

      {/* ── Bottom feature blocks ── */}
      <div className="grid gap-6 sm:grid-cols-3">
        {BOTTOM_FEATURES.map((f) => (
          <div key={f.title} className="space-y-2">
            <div className="text-sm font-semibold text-[#f2eee4]">{f.title}</div>
            <p className="text-xs text-[var(--muted)]">{f.desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}
