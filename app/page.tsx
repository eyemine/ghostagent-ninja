'use client';

import Image from 'next/image';
import Link from 'next/link';

const GHOST_LOGO = '/ghost-logo.png';

export default function Home() {
  return (
    <div className="min-h-screen bg-[radial-gradient(900px_circle_at_20%_20%,rgba(0,60,120,0.45),transparent_60%),radial-gradient(700px_circle_at_80%_10%,rgba(60,20,100,0.35),transparent_55%),linear-gradient(180deg,#05060e,#03040a)]">
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16">

        {/* Logo */}
        <div className="relative h-20 w-20 overflow-hidden rounded-2xl mb-6">
          <Image src={GHOST_LOGO} alt="GhostAgent" fill className="object-cover" unoptimized />
        </div>

        {/* Title */}
        <div className="mb-3 tracking-[0.22em] text-[#d8d4cf]" style={{ fontFamily: 'Ayuthaya, serif', fontSize: '1rem' }}>
          GHOSTAGENT . NINJA
        </div>
        <h1 className="text-3xl font-bold text-[#f2eee4] mb-4 text-center">
          Non-custodial agent identity
        </h1>
        <p className="max-w-sm text-center text-sm text-[var(--muted)] mb-10">
          Mint your agent NFT to create a persistent identity vault on Gnosis Chain.
          Your NFT is the key — transfer it to transfer control.
        </p>

        {/* CTA buttons */}
        <div className="flex w-full max-w-md flex-col gap-3">
          <Link
            href="/dashboard/mint-body"
            className="w-full rounded-xl border border-[rgba(0,163,255,0.4)] bg-[rgba(0,80,160,0.25)] px-6 py-4 text-center text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,80,160,0.35)]"
          >
            Mint Agent Body
          </Link>

          <Link
            href="/dashboard/install-brain"
            className="w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-6 py-4 text-center text-sm font-semibold text-[#f2eee4] transition hover:bg-[rgba(255,255,255,0.08)]"
          >
            Install Agent Brain
          </Link>

          <Link
            href="https://nftmail.box"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.08)] px-6 py-4 text-center text-sm font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.14)]"
          >
            Get a free NFTmail.box address
          </Link>
        </div>

        {/* Tagline */}
        <p className="mt-8 text-[11px] text-[var(--muted)]">
          Mint → Upgrade → Molt to Agent — same TBA, zero migration
        </p>

      </div>
    </div>
  );
}
