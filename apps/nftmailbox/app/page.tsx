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
            <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95 md:w-12 md:h-12" />
            <span className="flex items-center gap-1.5">
              <span style={{ fontFamily: "'Ayuthaya", serif", color: '#d8d4cf' }} className="text-sm tracking-wide md:text-base">nftmail.box</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/beta-badge.svg" alt="beta" style={{ height: '0.6rem', width: 'auto', opacity: 0.85 }} />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://ghostagent.ninja"
              target="_blank"
              rel="noopener noreferrer"
              style={{ backgroundColor: '#0a0a0a', fontFamily: "'Ayuthaya', serif" }}
              className="rounded-full border border-[rgba(220,40,40,0.35)] px-4 py-2 text-xs font-semibold tracking-wider text-[#d8d4cf] transition hover:brightness-125"
            >
              GHOSTAGENT.NINJA
            </a>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center">
          <h1 style={{ fontFamily: "'Ayuthaya", serif", color: '#d8d4cf' }} className="text-3xl md:text-5xl font-bold tracking-tight flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3">
            nftmail.box
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/beta-badge.svg" alt="beta" style={{ height: '1rem', width: 'auto', opacity: 0.85, marginTop: '0.2rem' }} className="md:mt-0.4" />
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--muted)]">
            Claim a free email inbox. No credit card. No personal data.
          </p>
        </section>

        {/* Check an Inbox */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-base font-semibold text-white mb-4">Check an Inbox</h2>
            <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-2 mb-4">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value.toLowerCase());
                    setError('');
                  }}
                  placeholder="yourname"
                  className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2.5 pr-28 text-sm text-white placeholder-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)] transition"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
                  @nftmail.box
                </span>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[rgba(0,163,255,0.12)] border border-[rgba(0,163,255,0.3)] px-5 py-2.5 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] sm:w-auto w-full"
              >
                Check &rarr;
              </button>
            </form>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-4 border-t border-[var(--border)]">
              <p className="text-[10px] text-[var(--muted)]">Manage all your inboxes</p>
              <Link 
                href="/dashboard" 
                className="px-4 py-2 text-xs font-semibold text-white bg-[rgba(0,163,255,0.12)] border border-[rgba(0,163,255,0.3)] rounded-lg hover:bg-[rgba(0,163,255,0.2)] transition text-center sm:w-auto w-full"
              >
                Your Dashboard &rarr;
              </Link>
            </div>
          </div>
        </section>

        {/* Primary CTA — claim inbox */}
        <section className="w-full max-w-lg">
          <div className="rounded-2xl border border-[rgba(0,163,255,0.25)] bg-[var(--card)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-300">Free — no wallet required to start*</span>
            </div>
            <h2 className="text-base font-semibold text-white mb-1">Get your inbox</h2>
            <p className="text-xs text-[var(--muted)] mb-4">
              Choose a name. Your address will be <span className="text-[rgb(160,220,255)]">you@nftmail.box</span>
            </p>
            <div className="flex gap-2 mb-3">
              <a
                href="/nftmail"
                className="flex-1 rounded-lg bg-[rgba(0,163,255,0.15)] border border-[rgba(0,163,255,0.35)] px-5 py-3 text-sm font-semibold text-[rgb(160,220,255)] text-center hover:bg-[rgba(0,163,255,0.25)] transition"
              >
                Claim inbox →
              </a>
              <a
                href="/sdk"
                className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-3 text-xs font-semibold hover:bg-black/30 hover:text-white transition"
                style={{ color: '#8ee4ba' }}
              >
                API / SDK*
              </a>
            </div>
            <div className="flex items-center gap-4 pt-3 border-t border-[var(--border)]">
              {[['✓', 'Receive email'], ['✓', 'Send 10 free'], ['✓', '8-day history']].map(([tick, label]) => (
                <span key={label} className="text-[10px] text-[var(--muted)]"><span className="text-emerald-400">{tick}</span> {label}</span>
              ))}
            </div>
          </div>
        </section>

        
        <footer className="text-center text-xs text-[var(--muted)] space-y-1">
          <p className="text-[9px] text-[var(--muted)] opacity-70">*Free trial via cURL/npx or ENS wallet. Permanent inbox requires NFT mint.</p>
          <p>nftmail.box — Sovereign email for agents and humans</p>
          <div className="flex items-center justify-center gap-3 text-[9px] opacity-60">
            <a href="/terms" className="hover:opacity-100 transition">Terms of Use</a>
            <span>·</span>
            <a href="/privacy" className="hover:opacity-100 transition">Privacy Notice</a>
            <span>·</span>
            <span>© 2026 Ghost Agent Pty Ltd</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
