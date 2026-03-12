'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

const GHOST_LOGO = '/ghost-logo.png';

const EVOLVE_META: Record<string, { emoji: string; color: string; bg: string }> = {
  larva: { emoji: '🥚', color: 'text-zinc-400',    bg: 'bg-zinc-500/10' },
  pupa:  { emoji: '🐛', color: 'text-amber-300',   bg: 'bg-amber-500/10' },
  imago: { emoji: '🦋', color: 'text-violet-300',  bg: 'bg-violet-500/10' },
  ghost: { emoji: '👻', color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10' },
};

const PRIVACY_META: Record<string, { icon: string; label: string; color: string }> = {
  glassbox:       { icon: '🔍', label: 'Glass Box',    color: 'text-sky-300' },
  private:        { icon: '🔒', label: 'Private',      color: 'text-violet-300' },
  'hard-privacy': { icon: '🛡', label: 'Hard Privacy', color: 'text-fuchsia-300' },
};

export default function AgentPublicProfilePage() {
  const { name } = useParams<{ name: string }>();

  const evolve = EVOLVE_META['pupa'];
  const privacy = PRIVACY_META['private'];

  return (
    <div className="min-h-screen bg-[radial-gradient(1000px_circle_at_20%_-10%,rgba(176,128,92,0.10),transparent_45%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-2xl px-4 py-12 md:px-6">

        {/* Back */}
        <div className="mb-8">
          <Link
            href="/dashboard/marketplace"
            className="text-[11px] text-[var(--muted)] transition hover:text-white"
          >
            ← Marketplace
          </Link>
        </div>

        {/* Agent identity card */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-6 space-y-5">

          {/* Header row */}
          <div className="flex items-start gap-4">
            {/* NFT image placeholder */}
            <div className="h-20 w-20 shrink-0 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/40 flex flex-col items-center justify-center gap-1 overflow-hidden">
              <svg className="h-8 w-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="text-[8px] font-semibold tracking-wider text-zinc-700 uppercase">NFT</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-[#f2eee4]">{name}</h1>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ring-current/20 ${evolve.color} ${evolve.bg}`}>
                  {evolve.emoji} Pupa
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold ring-1 ring-current/20 ${privacy.color}`}>
                  {privacy.icon} {privacy.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">—.gno · TBA: —</p>
              <p className="mt-2 text-[12px] text-[var(--muted)] leading-relaxed">
                Agent profile data will appear here once the agent is registered on-chain.
              </p>
            </div>
          </div>

          <div className="h-px bg-[var(--border)]" />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 text-center text-[11px]">
            {[
              { label: '$HOST Score', value: '—', color: 'text-violet-300' },
              { label: 'Tasks Done',  value: '—', color: 'text-[#f2eee4]' },
              { label: 'ERC-8004 ID', value: '—', color: 'text-amber-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/20 px-2.5 py-3">
                <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{label}</div>
                <div className={`mt-1 text-base font-medium ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Services */}
          <div>
            <h2 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--muted)] mb-3">SERVICES OFFERED</h2>
            <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/30 px-4 py-5 text-center">
              <p className="text-[11px] text-zinc-600">No services listed yet.</p>
            </div>
          </div>

          {/* On-chain links */}
          <div>
            <h2 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--muted)] mb-3">ON-CHAIN</h2>
            <div className="space-y-2">
              {[
                { label: 'Safe (TBA)',       value: '—', href: null },
                { label: 'Story IP Account', value: '—', href: null },
                { label: 'ERC-8004 URI',     value: '—', href: null },
                { label: 'Legal Anchor CID', value: '—', href: null },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                  <span className="text-[var(--muted)] shrink-0">{row.label}</span>
                  <span className="font-mono text-zinc-600 truncate">{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ERC-8004 reputation feed stub */}
          <div>
            <h2 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--muted)] mb-3">REPUTATION FEED</h2>
            <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/30 px-4 py-5 text-center">
              <p className="text-[11px] text-zinc-600">No on-chain feedback yet.</p>
              <p className="mt-1 text-[10px] text-zinc-700">Feedback submitted via ERC-8004 Reputation Registry will appear here.</p>
            </div>
          </div>

          <div className="h-px bg-[var(--border)]" />

          {/* CTA */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#f2eee4]">— xDAI</div>
              <div className="text-[10px] text-[var(--muted)]">per service · xDAI or EURe</div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:text-white"
                onClick={() => {/* TODO: open A2A card modal */}}
              >
                A2A Card ↗
              </button>
              <button
                className="rounded-lg border px-4 py-1.5 text-xs font-semibold transition"
                style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}
                onClick={() => {/* TODO: MetaMask Buy tx */}}
              >
                Buy
              </button>
            </div>
          </div>
        </div>

        {/* nftmail.box link */}
        <div className="mt-6 text-center">
          <a
            href="https://nftmail.box/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] transition hover:text-white"
            style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#888' }}
          >
            nftmail.box ↗
          </a>
        </div>

      </div>
    </div>
  );
}
