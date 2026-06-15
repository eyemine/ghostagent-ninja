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

const FAKENORMIE_HEADER_IMG = '/FakeNormies/FakeNormie1.png';

// Mirrors the Dashboard AGENT_ACTIONS panel (app/dashboard/page.tsx) 1:1 so the
// "ACTIONS FOR" bar here is identical in appearance and function.
function agentActions(agent: string): Array<{ key: string; label: string; href: string; color: string }> {
  return [
    { key: 'agent-profile', label: 'Agent Profile', href: `/dashboard/agent-profile?agent=${agent}`, color: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' },
    { key: 'molt',          label: 'Molt',          href: `/molt?agent=${agent}`,                    color: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20' },
    { key: 'ghost-tier',    label: 'Ghost Tier',    href: `/dashboard/settings/ghost?agent=${agent}`, color: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20' },
    { key: 'delegate-nft',  label: 'Delegate NFT',  href: '/dashboard/delegate',                      color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
    { key: 'erc8048',       label: 'ERC-8048',      href: `/dashboard/erc8048?agent=${agent}`,        color: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20' },
    { key: 'swarm',         label: 'Swarm',         href: `/dashboard/swarm?agent=${agent}`,          color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' },
    { key: 'trade',         label: 'Trade Intent',  href: `/dashboard/trade?agent=${agent}`,          color: 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20' },
    { key: 'hitl',          label: 'HITL Gates',    href: `/dashboard/hitl?agent=${agent}`,           color: 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' },
    { key: 'ip-portal',     label: 'IP Portal',     href: `/ip-portal?agent=${agent}&sld=fakenormie`, color: 'border-[#7c4dff]/30 bg-[#7c4dff]/10 text-[#a78bfa] hover:bg-[#7c4dff]/20' },
  ];
}

export default function FakeNormiesPage() {
  const { ready, authenticated, login, user } = usePrivy();
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingTokenId, setExistingTokenId] = useState<number | null>(null);
  const [existingSlug, setExistingSlug] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ safe?: string; tier?: string; principal?: string } | null>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);

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

  // Fetch agent info + silently sync controller when slug+tokenId are known
  useEffect(() => {
    if (!existingSlug || existingTokenId === null || !wallet) return;
    // Sync controller to current NFT holder (idempotent — safe to call every load)
    fetch('/api/fakenormies/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, tokenId: existingTokenId }),
    }).catch(() => {});
    // Fetch agent card
    fetch(`/api/agent-card?agent=${existingSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then((card: { safe?: string; tier?: string; principal?: string } | null) => {
        if (card) setAgentInfo({ safe: card.safe, tier: card.tier, principal: card.principal });
      })
      .catch(() => {});
  }, [existingSlug, existingTokenId, wallet]);

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

  const ownedTokenId = existingTokenId ?? (result ? result.tokenId : null);
  const ownedSlug    = existingSlug ?? (result ? result.slug : null);
  const agentRef     = ownedSlug ?? (ownedTokenId !== null ? `token${ownedTokenId}` : '');
  const mintedImg    = ownedTokenId !== null
    ? `/FakeNormies/SVGS/${String(ownedTokenId).padStart(2, '0')}.svg`
    : null;

  return (
    <div className="min-h-screen bg-[var(--background)] pt-14">
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 pb-12 space-y-6">

      {/* Header — aligned with Dashboard */}
      <div className="flex items-center gap-3 mb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={FAKENORMIE_HEADER_IMG} alt="FakeNormies" className="h-28 w-28 rounded object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">FakeNormies</h1>
          <p className="pl-1 mt-0.5 text-xs text-[var(--muted)]">100 free-mint AI agents on Gnosis Chain. Each spawns an inbox and identity — zero cost, zero risk. Upgrade for an Agent Safe wallet.</p>
        </div>
      </div>

      {/* About FakeNormies */}
      <div className="w-full rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-3 text-xs leading-relaxed text-[var(--muted)]">
        <p>
          FakeNormies are free, on-chain accounts that let anyone experience the AI agent stack without owning a
          high-value Normie NFT. Each of the 100 free mints can be upgraded to a fully functional cross-chain GhostAgent,
          complete with its own email inbox, on-chain brain, and personality.
        </p>
        {aboutExpanded && (
          <>
            <p>
              When you mint a FakeNormie, you immediately get an agent body, an nftmail.box address, and chat access. You can
              test-drive email, messaging, and basic delegation features — the same infrastructure that powers full
              GhostAgents — at zero cost and zero risk.
            </p>
            <p>
              The free tier includes an 8-day history inbox, ten email sends, and ten chat messages per day. If you want more,
              a one-time upgrade unlocks higher limits and deploys a real Gnosis Safe smart wallet for your agent.
            </p>
            <p>
              We built a zero-stakes sandbox running the exact same codebase, so anyone can try the complete stack. When
              you&apos;re ready to activate a real Normie, you already know how every feature works. The only difference is the
              asset value and the security tier.
            </p>
          </>
        )}
        <button
          onClick={() => setAboutExpanded((v: boolean) => !v)}
          className="text-[10px] text-pink-400 hover:text-pink-300 transition"
        >
          {aboutExpanded ? 'see less ↑' : '(see more..)'}
        </button>
      </div>

      {/* ── Two-column layout — always rendered ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left column: image */}
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5 space-y-3">
          <div className="aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <Image
              src={mintedImg ?? '/FakeNormies/FakeNormie.gif'}
              alt={ownedTokenId !== null ? `FakeNormie #${ownedTokenId}` : 'FakeNormie'}
              width={400}
              height={400}
              className="h-full w-full object-contain"
              unoptimized
            />
          </div>
          <div className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/30 px-3 py-2">
            <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">NFTMAIL.BOX ADDRESS</p>
            <p className="font-mono text-xs text-pink-300 break-all">
              {ownedTokenId !== null ? `${agentRef}@nftmail.box` : '—'}
            </p>
          </div>
          {result && (
            <a href={result.inboxUrl} target="_blank" rel="noopener noreferrer"
              className="block text-center text-[11px] text-sky-400 hover:underline">
              Open agent inbox →
            </a>
          )}
        </div>

        {/* Right column: identity card + CTA */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
              <h2 className="text-lg font-bold text-[#f2eee4]">
                {ownedTokenId !== null ? `FakeNormie #${ownedTokenId}` : 'FakeNormie'}
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-pink-500/30 bg-pink-500/10 text-pink-300">FakeNormie</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border border-amber-500/30 bg-amber-500/10 text-amber-300">Basic GhostAgent</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px]">
              <div>
                <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">AGENT</p>
                <p className="font-mono text-[#f2eee4]">{ownedTokenId !== null ? agentRef : '—'}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">SLD</p>
                <p className="font-mono text-pink-300">{ownedTokenId !== null ? 'agent.gno' : '—'}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">TIER</p>
                <p className="font-semibold text-amber-300 capitalize">{ownedTokenId !== null ? (agentInfo?.tier ?? 'basic') : '—'}</p>
              </div>
              <div>
                <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">CHAIN</p>
                <p className="font-mono text-[#f2eee4]">Gnosis</p>
              </div>
              {agentInfo?.safe && (
                <div className="col-span-2">
                  <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">SAFE</p>
                  <p className="font-mono text-[#f2eee4]">{agentInfo.safe.slice(0, 10)}…{agentInfo.safe.slice(-8)}</p>
                </div>
              )}
              {agentInfo?.principal && (
                <div className="col-span-2">
                  <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">PRINCIPAL</p>
                  <p className="font-mono text-[#f2eee4]">{agentInfo.principal.slice(0, 10)}…{agentInfo.principal.slice(-8)}</p>
                </div>
              )}
            </div>
            {ownedTokenId !== null && (
              <div className="mt-3 pt-3 border-t border-[rgba(176,128,92,0.15)] flex gap-3">
                <Link href={`/agent/${agentRef}`} className="text-[11px] text-sky-400 hover:underline">Agent page →</Link>
              </div>
            )}
          </div>

          {/* CTA — disabled when already owned */}
          <div className="space-y-2">
            {!ready ? null : !authenticated ? (
              <button onClick={login} className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600 transition">
                Connect Wallet to Claim
              </button>
            ) : checking ? (
              <div className="rounded-lg bg-gray-800/50 px-4 py-3 text-sm text-gray-300">Checking wallet…</div>
            ) : (
              <button
                onClick={handleClaim}
                disabled={minting || ownedTokenId !== null}
                className={`w-full rounded-lg px-4 py-3 text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  ownedTokenId !== null
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-pink-600/80 text-white hover:bg-pink-600'
                }`}
                title={ownedTokenId !== null ? 'You already own a FakeNormie' : undefined}
              >
                {minting ? 'Minting on Gnosis Chain…' : ownedTokenId !== null ? '✓ FakeNormie Claimed' : 'Claim 1 free FakeNormie →'}
              </button>
            )}
            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            <p className="text-[10px] text-[#555] text-center">1 per wallet · gas sponsored by ghostagent.ninja</p>
          </div>

          {/* Success state */}
          {result && (
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
      </div>

      {/* ACTIONS FOR — full width, only when owned */}
      {ownedTokenId !== null && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-5 py-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">ACTIONS FOR</span>
            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/20">{agentRef}</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {agentActions(agentRef).map(action => (
              <Link key={action.key} href={action.href} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition shrink-0 ${action.color}`}>
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* UPGRADE AGENT accordion — full width, only when owned */}
      {ownedTokenId !== null && (
        <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 overflow-hidden">
            <button
              onClick={() => setShowUpgrade(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm font-bold text-fuchsia-300 hover:bg-fuchsia-500/10 transition"
            >
              <span className="flex items-center gap-2"><span>⬆</span> UPGRADE AGENT</span>
              <span className="text-[10px] font-normal text-[var(--muted)]">{showUpgrade ? '▲ collapse' : '▼ choose tier'}</span>
            </button>
            {showUpgrade && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-fuchsia-500/20">
                {/* PRO */}
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3 mt-4">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 mb-2">PRO</div>
                    <p className="text-sm font-semibold text-[#f2eee4]">{agentRef ? `${agentRef.replace(/\./g, '-')}.agent.gno` : '[name].agent.gno'}</p>
                    <p className="text-lg font-bold text-emerald-300 mt-1">$10 USD</p>
                    <p className="text-[10px] text-[var(--muted)]">Permanent NFT-governed email address</p>
                  </div>
                  <ul className="space-y-1 text-[11px] text-[var(--muted)]">
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> Unlimited inbox storage</li>
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> Send 100 emails/day</li>
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> Gnosis Safe multi-sig</li>
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> Agent autonomies (HITL, Budget)</li>
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> BYO NFT molt</li>
                    <li className="flex items-start gap-2"><span className="text-emerald-400">✓</span> Tradeable NFT</li>
                  </ul>
                  <Link
                    href={`/pair-nft?nft=fakenormie&tokenId=${ownedTokenId}&tier=pro`}
                    className="block w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
                  >
                    Pair NFT Pro ($10 USDC)
                  </Link>
                </div>
                {/* PREMIUM */}
                <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4 space-y-3 mt-4">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center rounded-full bg-violet-500/20 px-3 py-1 text-xs font-bold text-violet-300 mb-2">PREMIUM</div>
                    <p className="text-sm font-semibold text-[#f2eee4]">{agentRef ? `${agentRef.replace(/\./g, '-')}.agent.gno` : '[name].agent.gno'}</p>
                    <p className="text-lg font-bold text-violet-300 mt-1">$24 USD annual</p>
                    <p className="text-[10px] text-[var(--muted)]">(or reverts to PRO)</p>
                  </div>
                  <ul className="space-y-1 text-[11px] text-[var(--muted)]">
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> Everything in PRO</li>
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> Auto-forwarding</li>
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> Disposable email</li>
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> ghostmail.box alias</li>
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> Persistent history</li>
                    <li className="flex items-start gap-2"><span className="text-violet-400">✓</span> Transferable with governance</li>
                  </ul>
                  <Link
                    href={`/pair-nft?nft=fakenormie&tokenId=${ownedTokenId}&tier=premium`}
                    className="block w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
                  >
                    Pair NFT Premium ($24 USDC)
                  </Link>
                </div>
              </div>
            )}
          </div>
      )}
    </div>
    </div>
  );
}
