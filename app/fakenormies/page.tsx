'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { createPublicClient, http, parseAbiItem, defineChain, type Address } from 'viem';

const gnosis = defineChain({
  id: 100,
  name: 'Gnosis',
  nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.gnosischain.com'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
});

const FAKE_NORMIE_CONTRACT = (process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT || '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29') as Address;

const BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  inputs: [{ name: 'owner', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
}] as const;

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
  const [existingTokenId, setExistingTokenId] = useState<number | null>(null);
  const [existingSlug, setExistingSlug] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const wallet = user?.wallet?.address ?? null;

  useEffect(() => {
    if (!wallet) return;
    setChecking(true);
    const client = createPublicClient({ chain: gnosis, transport: http() });
    client.readContract({
      address: FAKE_NORMIE_CONTRACT,
      abi: BALANCE_ABI,
      functionName: 'balanceOf',
      args: [wallet as Address],
    }).then(async (balance) => {
      if (balance > 0n) {
        const logs = await client.getLogs({
          address: FAKE_NORMIE_CONTRACT,
          event: parseAbiItem('event AgentMinted(uint256 indexed tokenId, address indexed to)'),
          args: { to: wallet as Address },
          fromBlock: 0n,
        });
        const tid = logs.length > 0 ? Number(logs[0].args.tokenId) : 0;
        setExistingTokenId(tid);
        // Resolve slug from manifest
        try {
          const mf = await fetch('/FakeNormies/manifest.json').then(r => r.json()) as { slugIndex: Record<string, number> };
          const entry = Object.entries(mf.slugIndex).find(([, id]) => id === tid);
          setExistingSlug(entry ? entry[0] : `token${tid}`);
        } catch {
          setExistingSlug(`token${tid}`);
        }
      }
    }).catch(() => {}).finally(() => setChecking(false));
  }, [wallet]);

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
                  <p className="text-[#8a8a8a]">10 emails included · then upgrade to continue</p>
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
            ) : checking ? (
              <div className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] px-6 py-3.5 text-sm text-[#555] text-center">
                Checking wallet…
              </div>
            ) : existingTokenId !== null ? (
              <div className="w-full flex flex-col gap-3">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-5 py-4 text-left">
                  <p className="text-[10px] font-semibold tracking-widest text-emerald-400 uppercase mb-1">Your FakeNormie ✓</p>
                  <p className="text-xl font-bold text-[#f2eee4] font-mono">
                    {existingSlug ? `${existingSlug}@nftmail.box` : `FakeNormie #${existingTokenId}`}
                  </p>
                  <p className="mt-1 text-[11px] text-[#555]">Token #{existingTokenId} · Gnosis Chain</p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-4 text-left space-y-2">
                  <p className="text-xs font-semibold text-[#f2eee4] mb-2">Agent actions</p>
                  <a
                    href={`https://nftmail.box/inbox/${existingSlug ?? `token${existingTokenId}`}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between w-full rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-xs text-[#f2eee4] hover:bg-white/[0.06] transition"
                  >
                    <span>Open Inbox</span><span className="text-[#555]">nftmail.box ↗</span>
                  </a>
                  <Link
                    href={`/pair-nft`}
                    className="flex items-center justify-between w-full rounded-lg border border-[rgba(0,163,255,0.25)] bg-[rgba(0,163,255,0.08)] px-3 py-2.5 text-xs text-[rgb(160,220,255)] hover:bg-[rgba(0,163,255,0.15)] transition"
                  >
                    <span>Pair NFT → Mint Agent ID</span><span className="text-[#555]">/pair-nft</span>
                  </Link>
                  <Link
                    href="/agents?tab=mint"
                    className="flex items-center justify-between w-full rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-xs text-[#8a8a8a] hover:text-[#f2eee4] transition"
                  >
                    <span>Mint Agent ID</span><span className="text-[#555]">/agents</span>
                  </Link>
                  <a
                    href={`https://gnosisscan.io/token/${FAKE_NORMIE_CONTRACT}?a=${wallet}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between w-full rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-xs text-[#8a8a8a] hover:text-[#f2eee4] transition"
                  >
                    <span>View on Gnosisscan</span><span className="text-[#555]">↗</span>
                  </a>
                </div>
              </div>
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
