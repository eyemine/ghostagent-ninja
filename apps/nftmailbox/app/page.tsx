'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState('');

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

    router.push(`/inbox/${encodeURIComponent(name)}`);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-4 py-10 md:px-6">

        {/* Header */}
        <header className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/nftmail-logo.png" alt="NFTMail" width={48} height={48} className="opacity-95" />
            <span className="flex items-center gap-1.5">
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://gateway.lighthouse.storage/ipfs/bafkreihrbcstovmanpu3fgcpgxregh4krxj2jyvil3vapo2xz4giojulki" alt="beta" style={{ height: '0.5rem', width: 'auto', opacity: 0.85 }} />
            </span>
          </div>
          <div className="flex items-center gap-3">
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
        </header>

        {/* Hero */}
        <section className="text-center">
          <h1 style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-5xl font-bold tracking-tight flex items-center justify-center gap-3">
            nftmail.box
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://gateway.lighthouse.storage/ipfs/bafkreihrbcstovmanpu3fgcpgxregh4krxj2jyvil3vapo2xz4giojulki" alt="beta" style={{ height: '1.2rem', width: 'auto', opacity: 0.85, marginTop: '0.4rem' }} />
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--muted)]">
            Sovereign email identity on Gnosis. Mint, read, or check any inbox.
          </p>
        </section>

        {/* Already have account — yopmail-style lookup */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-sm font-semibold text-white mb-1">Already have an account?</h2>
            <p className="text-xs text-[var(--muted)] mb-4">
              Enter your name to check your inbox — connected wallet required to read private inbox.
            </p>
            <form onSubmit={handleLookup} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value.toLowerCase());
                    setError('');
                  }}
                  placeholder="ghost.agent"
                  className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2.5 pr-28 text-sm text-white placeholder-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)] transition"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
                  @nftmail.box
                </span>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[rgba(0,163,255,0.12)] px-5 py-2.5 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] border border-[rgba(0,163,255,0.3)]"
              >
                Go →
              </button>
            </form>
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
            <p className="mt-3 text-[10px] text-[var(--muted)]">
              Try: <button type="button" onClick={() => { setEmailInput('eyemine_'); }} className="text-violet-300 hover:underline">eyemine_</button> (Glass Box)
              {' · '}
              <button type="button" onClick={() => { setEmailInput('agent_molt'); }} className="text-[rgb(160,220,255)] hover:underline">agent_molt</button>
            </p>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4">
              <p className="text-[10px] text-[var(--muted)]">Manage all your inboxes in one place</p>
              <Link
                href="/dashboard"
                className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-black/30"
              >
                Dashboard →
              </Link>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="flex w-full max-w-lg items-center gap-4">
          <div className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">OR</span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        {/* Mint or Upgrade */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center">
            <h2 className="text-sm font-semibold text-white mb-1">New here?</h2>
            <p className="text-xs text-[var(--muted)] mb-4">
              Mint a free NFTmail inbox address or upgrade to paid for full feature Gnosis wallet and hardened security.
            </p>
            <div className="flex gap-3 justify-center">
              <a
                href="/nftmail"
                className="rounded-lg bg-[rgba(0,163,255,0.12)] px-6 py-2.5 text-xs font-semibold text-[rgb(160,220,255)] border border-[rgba(0,163,255,0.3)] hover:bg-[rgba(0,163,255,0.2)] transition"
              >
                NFTmail
              </a>
              <a
                href="/sdk"
                className="rounded-lg border border-[var(--border)] bg-black/20 px-6 py-2.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-black/30"
              >
                SDK Docs
              </a>
            </div>
          </div>
        </section>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { label: 'Free Tier', color: 'emerald' },
            { label: '8-Day History', color: 'blue' },
            { label: 'Glass Box Agents', color: 'violet' },
            { label: 'Sovereign Kill-Switch', color: 'red' },
            { label: 'Encrypted XMTP', color: 'emerald' },
          ].map((f) => (
            <span
              key={f.label}
              className={`rounded-full px-3 py-1 text-[10px] font-semibold ring-1 ${
                f.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' :
                f.color === 'blue' ? 'bg-[rgba(0,163,255,0.08)] text-[rgb(160,220,255)] ring-[rgba(0,163,255,0.2)]' :
                f.color === 'violet' ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' :
                'bg-red-500/10 text-red-300 ring-red-500/20'
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>

        <footer className="text-center text-xs text-[var(--muted)]">
          nftmail.box — Privacy is a Right, Sovereignty is an Upgrade
        </footer>
      </div>
    </div>
  );
}
