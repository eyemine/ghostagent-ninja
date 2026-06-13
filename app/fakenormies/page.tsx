'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

interface MintResult {
  tokenId: number;
  slug: string;
  humanEmail: string;
  agentEmail: string;
  txHash: string;
  inboxUrl: string;
  explorer: string;
}

export default function FakeNormiesPage() {
  const { ready, authenticated, login, user } = usePrivy();
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wallet = user?.wallet?.address ?? null;

  async function handleClaim() {
    if (!wallet) return;
    setMinting(true);
    setError(null);
    try {
      const res = await fetch('/api/fakenormies/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json() as MintResult & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Mint failed');
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Mint failed');
    } finally {
      setMinting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0b0c0f] flex flex-col items-center justify-center px-4 py-16">

      {/* Hero */}
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">

        <div className="relative w-48 h-48 rounded-2xl overflow-hidden border border-white/10 shadow-lg shadow-black/60">
          <Image
            src="/FakeNormies/FakeNormie.gif"
            alt="FakeNormie"
            fill
            className="object-cover"
            unoptimized
          />
        </div>

        {!result ? (
          <>
            <div>
              <h1 className="text-3xl font-bold text-[#f2eee4] tracking-tight">FakeNormies</h1>
              <p className="mt-2 text-sm text-[#8a8a8a]">
                100 free AI agents on Gnosis Chain.<br />
                Each mint spawns an inbox, a wallet, and an identity.
              </p>
            </div>

            {/* Tier summary */}
            <div className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] divide-y divide-white/[0.05] text-left text-xs">
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-lg">👻</span>
                <div>
                  <p className="font-semibold text-[#f2eee4]">Basic — Free</p>
                  <p className="text-[#8a8a8a]">10 sends/day · 10 chat/day · demo delegation</p>
                </div>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-lg">⚡</span>
                <div>
                  <p className="font-semibold text-[#f2eee4]">Pro — 10 USDC on Base</p>
                  <p className="text-[#8a8a8a]">50 sends/day · unlimited chat · real Safe wallet</p>
                </div>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-lg">🔮</span>
                <div>
                  <p className="font-semibold text-[#f2eee4]">Premium — 24 USDC/yr on Base</p>
                  <p className="text-[#8a8a8a]">Unlimited everything · treasury · CDR vault</p>
                </div>
              </div>
            </div>

            {/* CTA */}
            {!ready ? null : !authenticated ? (
              <button
                onClick={login}
                className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-6 py-3 text-sm font-semibold text-[#f2eee4] hover:bg-white/[0.09] transition"
              >
                Connect Wallet
              </button>
            ) : (
              <button
                onClick={handleClaim}
                disabled={minting}
                className="w-full rounded-xl bg-[rgba(0,163,255,0.15)] border border-[rgba(0,163,255,0.35)] px-6 py-3.5 text-sm font-bold text-[rgb(160,220,255)] hover:bg-[rgba(0,163,255,0.25)] disabled:opacity-50 transition"
              >
                {minting ? 'Minting your agent…' : 'Claim your free FakeNormie →'}
              </button>
            )}

            {error && (
              <p className="text-xs text-red-400 text-center">{error}</p>
            )}

            <p className="text-[10px] text-[#555] mt-1">1 per wallet · gas sponsored by ghostagent.ninja</p>
          </>
        ) : (
          /* ── Success state ── */
          <div className="w-full flex flex-col gap-4">
            <div className="rounded-xl border border-[rgba(0,255,128,0.2)] bg-[rgba(0,255,128,0.05)] px-5 py-4 text-left">
              <p className="text-[10px] font-semibold tracking-widest text-[#3dffa0] uppercase mb-1">
                Token #{result.tokenId} minted ✓
              </p>
              <p className="text-xl font-bold text-[#f2eee4] font-mono">{result.humanEmail}</p>
              <p className="mt-1 text-[11px] text-[#555]">
                Agent comms: <span className="font-mono text-[#777]">{result.agentEmail}</span>
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-4 text-left space-y-3">
              <p className="text-xs font-semibold text-[#f2eee4]">Next steps</p>
              <ol className="space-y-2 text-xs text-[#8a8a8a] list-decimal list-inside">
                <li>Your inbox is live — start receiving emails now</li>
                <li>Connect your wallet at nftmail.box to send</li>
                <li>Upgrade to Pro on Base to unlock 50 sends/day + real Safe</li>
              </ol>
            </div>

            <a
              href={result.inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-xl bg-[rgba(0,163,255,0.15)] border border-[rgba(0,163,255,0.35)] px-6 py-3 text-sm font-bold text-[rgb(160,220,255)] hover:bg-[rgba(0,163,255,0.25)] transition text-center"
            >
              Set up your agent →
            </a>

            <div className="flex gap-3 text-xs">
              <a
                href={result.explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[#8a8a8a] hover:text-[#f2eee4] transition"
              >
                View on Gnosisscan ↗
              </a>
              <Link
                href="/dashboard"
                className="flex-1 text-center rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[#8a8a8a] hover:text-[#f2eee4] transition"
              >
                Dashboard →
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
