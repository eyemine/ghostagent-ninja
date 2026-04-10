'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

// Agent configurations from memory
const AGENTS = {
  ghostagent: {
    name: 'GhostAgent',
    sld: 'molt.gno',
    agentId: 3199,
    safe: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    originNft: 'ghostagent.molt.gno',
    color: 'blue'
  },
  eyemine: {
    name: 'EyeMine',
    sld: 'nftmail.gno',
    agentId: 3205,
    safe: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    originNft: 'eyemine.nftmail.gno',
    color: 'violet'
  },
  victor: {
    name: 'Victor',
    sld: 'openclaw.gno',
    agentId: 3206,
    safe: '0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70',
    originNft: 'victor.openclaw.gno',
    color: 'emerald'
  }
};

export default function AgentDashboard() {
  const router = useRouter();
  const [selectedAgent, setSelectedAgent] = useState<keyof typeof AGENTS>('ghostagent');
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState('');

  const agent = AGENTS[selectedAgent];

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    let name = emailInput.trim().toLowerCase();

    // Strip @nftmail.box if user typed the full email
    if (name.endsWith('@nftmail.box')) {
      name = name.replace('@nftmail.box', '');
    }

    // Validate: allow alphanumeric, dots, hyphens, underscores
    if (!name || !/^[a-z0-9._-]+$/.test(name)) {
      setError('Enter a valid name — e.g. alice.ops or agent_molt');
      return;
    }

    router.push(`/inbox/${encodeURIComponent(name)}?agent=${selectedAgent}`);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-4 py-10 md:px-6">

        {/* Agent Selector */}
        <header className="w-full">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={48} height={48} className="opacity-95" />
              <span className="flex items-center gap-1.5">
                <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">Agent Mail</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://gateway.lighthouse.storage/ipfs/bafkreihrbcstovmanpu3fgcpgxregh4krxj2jyvil3vapo2xz4giojulki" alt="beta" style={{ height: '0.5rem', width: 'auto', opacity: 0.85 }} />
              </span>
            </div>
            <a
              href="https://ghostagent.ninja"
              target="_blank"
              rel="noopener noreferrer"
              style={{ backgroundColor: '#150903' }}
              className="rounded-full border border-[rgba(255,120,40,0.25)] px-4 py-2 text-xs font-semibold text-[#d8d4cf] transition hover:brightness-125"
            >
              GhostAgent.ninja
            </a>
          </div>

          {/* Agent Selection Tabs */}
          <div className="flex gap-2 p-1 bg-black/20 rounded-xl border border-[var(--border)]">
            {(Object.keys(AGENTS) as Array<keyof typeof AGENTS>).map((key) => (
              <button
                key={key}
                onClick={() => setSelectedAgent(key)}
                className={`flex-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  selectedAgent === key
                    ? agent.color === 'blue' ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)] border border-[rgba(0,163,255,0.3)]' :
                      agent.color === 'violet' ? 'bg-violet-500/10 text-violet-300 border border-violet-500/20' :
                      'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    : 'text-[var(--muted)] hover:text-white'
                }`}
              >
                {AGENTS[key].name}
              </button>
            ))}
          </div>
        </header>

        {/* Agent Profile */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">{agent.name} Profile</h2>
              <span className={`px-2 py-1 text-[10px] font-semibold rounded-full ${
                agent.color === 'blue' ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]' :
                agent.color === 'violet' ? 'bg-violet-500/10 text-violet-300' :
                'bg-emerald-500/10 text-emerald-300'
              }`}>
                Active
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Agent ID:</span>
                <span className="text-white font-mono">{agent.agentId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Safe:</span>
                <span className="text-white font-mono text-xs">{agent.safe.slice(0, 6)}...{agent.safe.slice(-4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Origin NFT:</span>
                <span className="text-white">{agent.originNft}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">SLD:</span>
                <span className="text-white">{agent.sld}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Agent Email Management */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Email Accounts</h2>
              <button className={`px-3 py-1 text-[10px] font-semibold rounded-lg border ${
                agent.color === 'blue' ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)] border-[rgba(0,163,255,0.3)]' :
                agent.color === 'violet' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' :
                'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              }`}>
                + New Email
              </button>
            </div>
            
            {/* Email List */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-[var(--border)]">
                <div>
                  <div className="text-sm text-white font-medium">{agent.name.toLowerCase()}_@nftmail.box</div>
                  <div className="text-[10px] text-[var(--muted)]">Primary A2A Channel</div>
                </div>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-green-500/10 text-green-300">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-[var(--border)]">
                <div>
                  <div className="text-sm text-white font-medium">chonk.123_@nftmail.box</div>
                  <div className="text-[10px] text-[var(--muted)]">Molt Instance</div>
                </div>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-yellow-500/10 text-yellow-300">
                  Trial
                </span>
              </div>
            </div>

            {/* Quick Lookup */}
            <div className="border-t border-[var(--border)] pt-4">
              <h3 className="text-xs font-semibold text-white mb-2">Quick Lookup</h3>
              <form onSubmit={handleLookup} className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={emailInput}
                    onChange={(e) => {
                      setEmailInput(e.target.value.toLowerCase());
                      setError('');
                    }}
                    placeholder="agent.name"
                    className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2.5 pr-28 text-sm text-white placeholder-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)] transition"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
                    @nftmail.box
                  </span>
                </div>
                <button
                  type="submit"
                  className={`rounded-lg px-5 py-2.5 text-xs font-semibold transition hover:opacity-80 border ${
                    agent.color === 'blue' ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)] border-[rgba(0,163,255,0.3)]' :
                    agent.color === 'violet' ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' :
                    'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  }`}
                >
                  Check &rarr;
                </button>
              </form>
              {error && (
                <p className="mt-2 text-xs text-red-400">{error}</p>
              )}
            </div>
          </div>
        </section>

        {/* Brain Module Integration */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-sm font-semibold text-white mb-4">Brain Modules</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-[var(--border)]">
                <div>
                  <div className="text-sm text-white font-medium">HITL Module</div>
                  <div className="text-[10px] text-[var(--muted)]">Human-in-the-loop approvals</div>
                </div>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-green-500/10 text-green-300">
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-[var(--border)]">
                <div>
                  <div className="text-sm text-white font-medium">A2A Module</div>
                  <div className="text-[10px] text-[var(--muted)]">Agent-to-agent communications</div>
                </div>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-green-500/10 text-green-300">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-[var(--border)]">
                <div>
                  <div className="text-sm text-white font-medium">Story Protocol</div>
                  <div className="text-[10px] text-[var(--muted)]">IP registration & licensing</div>
                </div>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-yellow-500/10 text-yellow-300">
                  Pending
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Molt Planning */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Molt Cycle</h2>
              <button className="px-3 py-1 text-[10px] font-semibold rounded-lg border border-[var(--border)] bg-black/20 text-[var(--foreground)] hover:bg-black/30 transition">
                Plan Molt
              </button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">Current:</span>
                <span className="text-xs text-white font-mono">{agent.originNft}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">Next Target:</span>
                <span className="text-xs text-white">vault.gno</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">Status:</span>
                <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-blue-500/10 text-blue-300">
                  Planning
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Agent Status Pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { label: 'ERC-8004', color: 'blue' },
            { label: 'ERC-6551 Ready', color: 'violet' },
            { label: 'Safe Multi-Sig', color: 'emerald' },
            { label: 'HITL Enabled', color: 'yellow' },
            { label: 'Story Protocol', color: 'red' },
          ].map((f) => (
            <span
              key={f.label}
              className={`rounded-full px-3 py-1 text-[10px] font-semibold ring-1 ${
                f.color === 'blue' ? 'bg-[rgba(0,163,255,0.08)] text-[rgb(160,220,255)] ring-[rgba(0,163,255,0.2)]' :
                f.color === 'violet' ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' :
                f.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' :
                f.color === 'yellow' ? 'bg-yellow-500/10 text-yellow-300 ring-yellow-500/20' :
                'bg-red-500/10 text-red-300 ring-red-500/20'
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>

        <footer className="text-center text-xs text-[var(--muted)]">
          Agent Mail - Managing Sovereign Agent Communications
        </footer>
      </div>
    </div>
  );
}
