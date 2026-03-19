'use client';

import Link from 'next/link';

const GHOST_LOGO = '/ghost-logo.png';

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-10 px-4 py-6 text-center">

        {/* Logo + Title hero */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={GHOST_LOGO}
              alt="GhostAgent logo"
              className="relative z-10 mb-[-0.5rem] mr-auto ml-6 h-28 w-28 object-contain drop-shadow-[0_0_28px_rgba(184,134,97,0.55)]"
            />
            <style>{`@keyframes fadeTitle { 0% { opacity:0; } 60% { opacity:1; } 100% { opacity:1; } }`}</style>
            <h1
              className="text-[1.75rem] font-normal uppercase leading-none tracking-[0.04em] animate-[fadeTitle_1.8s_ease-out_forwards]"
              style={{
                fontFamily: 'Ayuthaya, serif',
                WebkitFontSmoothing: 'antialiased',
                background: 'linear-gradient(90deg, rgb(255,255,255) 0%, rgb(242,238,228) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              } as React.CSSProperties}
            >
              GHOSTAGENT.NINJA
            </h1>
          </div>
          <p className="text-[1.75rem] font-semibold leading-none" style={{ color: '#acacac' }}>
            Non-custodial agent identity
          </p>
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
            Mint your agent NFT to create a persistent identity vault on Gnosis Chain.
            Your NFT is the key — transfer it to transfer control.
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Link
            href="/dashboard/mint-body"
            className="w-full rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-6 py-3 text-center text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]"
          >
            Mint Agent Body
          </Link>

          <Link
            href="/dashboard/install-brain"
            className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition"
            style={{ color: '#ffca92', border: '1px solid rgba(243,238,228,0.2)', background: 'rgba(255,255,255,0.04)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#262934')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          >
            Install Agent Brain
          </Link>

          <Link
            href="https://ghostagent.ninja/nftmail"
            className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition"
            style={{ color: 'rgb(184,134,97)', border: '1px solid rgba(184,134,97,0.5)', background: 'rgba(184,134,97,0.07)' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#271e18')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(184,134,97,0.07)')}
          >
            Get a free Agent NFTmail.box address
          </Link>

          <Link
            href="https://nftmail.box/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold transition"
            style={{ color: '#9b9b9b', border: '1px solid rgba(133,147,207,0.4)', background: '#0f1323' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#161b31')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0f1323')}
          >
            Get a free Personal NFTmail.box address
          </Link>
        </div>

        {/* Tagline */}
        <p className="text-[10px] text-[var(--muted)]">
          Mint → Cycle → Molt to Agent — same TBA, zero migration
        </p>

      </div>
    </div>
  );
}
