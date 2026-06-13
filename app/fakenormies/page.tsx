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

      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">

        <div>
          <h1 className="text-3xl font-bold text-[#f2eee4] tracking-tight">FakeNormies</h1>
          <p className="mt-2 text-sm text-[#8a8a8a]">
            100 free AI agents on Gnosis Chain.<br />
            Each mint spawns an inbox, a wallet, and an identity.
          </p>
        </div>

        {/* FakeNormie Sandbox Panel */}
        <div className="w-full rounded-2xl border border-pink-500/30 bg-pink-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-left">
              <p className="text-sm font-semibold text-pink-300">FakeNormie Sandbox</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Claim a free FakeNormie NFT on Gnosis Chain — then use it as your agent identity.
              </p>
            </div>
          </div>

          {/* NFT image enclosed in Sandbox panel */}
          <div className="relative w-full h-48 rounded-2xl overflow-hidden border border-white/10 shadow-lg shadow-black/60">
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
              {/* CTA */}
              {!ready ? null : !authenticated ? (
                <button
                  onClick={login}
                  className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600 transition"
                >
                  Connect Wallet to Claim
                </button>
              ) : checking ? (
                <div className="rounded-lg bg-gray-800/50 px-4 py-3 text-sm text-gray-300">
                  Checking wallet…
                </div>
              ) : existingTokenId !== null ? (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-emerald-400">✓ You own a FakeNormie</p>
                  <p className="text-xs text-[var(--muted)]">
                    Token #{existingTokenId} · <span className="font-mono text-pink-300">{existingSlug || `token${existingTokenId}`}</span>
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleClaim}
                  disabled={minting}
                  className="w-full rounded-lg bg-pink-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-pink-600 transition"
                >
                  {minting ? 'Minting on Gnosis Chain…' : 'Claim 1 free FakeNormie →'}
                </button>
              )}

              {error && (
                <p className="text-xs text-red-400 text-center">{error}</p>
              )}

              <p className="text-[10px] text-[#555]">1 per wallet · gas sponsored by ghostagent.ninja</p>
            </>
            ) : (
          /* ── Success state ── */
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 space-y-2">
            <p className="text-sm font-semibold text-emerald-400">✓ Minted! Token ID: {result.tokenId}</p>
            <p className="text-xs text-[var(--muted)]">
              Your inbox is live — <span className="font-semibold text-[#f2eee4]">{result.humanEmail}</span>
            </p>
            <a
              href={result.inboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-[11px] text-sky-400 hover:underline"
            >
              Set up your agent inbox →
            </a>
          </div>
        )}
        </div>

        {/* Actions for Panel — shown when user has a FakeNormie */}
        {existingTokenId !== null && (
          <div className="w-full rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
            <p className="text-sm font-semibold text-[#f2eee4]">Actions for Panel</p>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`https://nftmail.box/inbox/${existingSlug ?? `token${existingTokenId}`}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 hover:bg-amber-500/20 transition"
              >
                <span>Agent Profile</span><span className="text-[#555]">/dashboard</span>
              </a>
              <Link
                href={`/molt?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2.5 text-xs text-fuchsia-300 hover:bg-fuchsia-500/20 transition"
              >
                <span>Molt</span><span className="text-[#555]">/molt</span>
              </Link>
              <Link
                href={`/dashboard/settings/ghost?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-zinc-500/30 bg-zinc-500/10 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-500/20 transition"
              >
                <span>Ghost Tier</span><span className="text-[#555]">/dashboard</span>
              </Link>
              <Link
                href="/dashboard/delegate"
                className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300 hover:bg-emerald-500/20 transition"
              >
                <span>Delegate NFT</span><span className="text-[#555]">/delegate</span>
              </Link>
              <Link
                href={`/dashboard/erc8048?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-xs text-cyan-300 hover:bg-cyan-500/20 transition"
              >
                <span>ERC-8048</span><span className="text-[#555]">/dashboard</span>
              </Link>
              <Link
                href={`/dashboard/swarm?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300 hover:bg-emerald-500/20 transition"
              >
                <span>Swarm</span><span className="text-[#555]">/dashboard</span>
              </Link>
              <Link
                href={`/dashboard/trade?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-xs text-violet-300 hover:bg-violet-500/20 transition"
              >
                <span>Trade Intent</span><span className="text-[#555]">/dashboard</span>
              </Link>
              <Link
                href={`/dashboard/hitl?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300 hover:bg-red-500/20 transition"
              >
                <span>HITL Gates</span><span className="text-[#555]">/dashboard</span>
              </Link>
              <Link
                href={`/ip-portal?agent=${existingSlug ?? `token${existingTokenId}`}`}
                className="flex items-center justify-between rounded-lg border border-[#7c4dff]/30 bg-[#7c4dff]/10 px-3 py-2.5 text-xs text-[#a78bfa] hover:bg-[#7c4dff]/20 transition"
              >
                <span>IP Portal</span><span className="text-[#555]">/ip-portal</span>
              </Link>
              <a
                href={`https://notapaperclip.red/osint/${existingSlug ?? `token${existingTokenId}`}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-xs text-[#8a8a8a] hover:text-[#f2eee4] transition"
              >
                <span>OSINT Audit</span><span className="text-[#555]">notapaperclip.red ↗</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
