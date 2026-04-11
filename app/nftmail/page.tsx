/* AGENT-ONLY VERSION: GhostAgent.ninja/nftmail
 * This is a simplified version for minting agent email accounts only.
 * Full features available at nftmail.box (the standalone app)
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { NFTLogin } from '../components/NFTLogin';
import { MintNFTMail } from '../components/MintNFTMail';
// import { WhiteLabelZoho } from '../components/WhiteLabelZoho'; // Commented out - agent-only version
// import { AgentIdentityCard } from '../components/AgentIdentityCard'; // Commented out - agent-only version
// import { StealthAlias } from '../components/StealthAlias'; // Commented out - agent-only version
import { useSafeAuth } from '../hooks/useSafeAuth';

type Tier = 'none' | 'free' | 'premium';

function AgentLandingPage({ onClaim }: { onClaim: () => void }) {
  const [checkName, setCheckName] = useState('');
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const handleCheck = async () => {
    if (!checkName || checkName.length < 2) return;
    setCheckStatus('checking');
    try {
      const res = await fetch(`/api/check-ens?name=${encodeURIComponent(checkName)}`);
      const data = await res.json() as { registered?: boolean };
      setCheckStatus(data.registered ? 'taken' : 'available');
    } catch {
      setCheckStatus('idle');
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 pb-10 pt-8 md:px-6">
        <div className="mx-auto w-full max-w-[760px] border-x border-white/5 bg-[rgba(6,10,26,0.45)] px-4 pb-8 pt-6 md:px-8">
          <header className="mb-3 flex items-center gap-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <Image src="https://nftmail.box/_next/image?url=%2Fnftmail-logo.png&w=96&q=75" alt="NFTMail" width={34} height={34} className="h-8 w-8" unoptimized />
            </span>
            <div className="flex items-baseline gap-3">
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-4xl font-bold leading-none tracking-wide md:text-5xl">nftmail.box</span>
              <span className="text-2xl font-bold text-zinc-300/85 md:text-4xl">[for-agents]</span>
            </div>
          </header>

          <p className="mb-8 text-center text-[22px] leading-tight text-zinc-300/80 md:text-[24px]">Claim a free agent email inbox. No Credit Card. No personal data.</p>

          <div className="mb-7 rounded-3xl border border-[rgba(90,115,170,0.35)] bg-[rgba(9,16,42,0.72)] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <h2 className="mb-5 text-[30px] font-semibold leading-none text-white">Check an Agent Inbox</h2>
            <div className="mb-5 flex gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={checkName}
                  onChange={(e) => setCheckName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="agentname_"
                  className="h-16 w-full rounded-2xl border border-[rgba(80,102,150,0.45)] bg-[rgba(3,8,22,0.95)] px-5 pr-36 text-xl text-white placeholder:text-zinc-600 outline-none focus:border-[rgba(79,176,255,0.7)]"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[19px] text-zinc-400">@nftmail.box</span>
              </div>
              <button
                onClick={handleCheck}
                disabled={!checkName || checkName.length < 2 || checkStatus === 'checking'}
                className="h-16 rounded-2xl border border-[rgba(63,142,214,0.55)] bg-[rgba(20,70,120,0.55)] px-8 text-[22px] font-semibold text-[rgb(176,224,255)] hover:bg-[rgba(28,93,156,0.62)] disabled:opacity-40"
              >
                {checkStatus === 'checking' ? '...' : 'Check →'}
              </button>
            </div>

            {checkStatus === 'available' && <p className="mb-4 text-[18px] text-emerald-400">✓ Available — {checkName}@nftmail.box is free to claim</p>}
            {checkStatus === 'taken' && <p className="mb-4 text-[18px] text-amber-400">⚠ Taken — {checkName}@nftmail.box is already registered</p>}

            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <span className="text-[18px] text-zinc-400">Manage all your inboxes</span>
              <Link href="/dashboard" className="h-14 rounded-2xl border border-[rgba(63,142,214,0.55)] bg-[rgba(20,70,120,0.55)] px-7 text-[22px] font-semibold leading-[56px] text-[rgb(176,224,255)] hover:bg-[rgba(28,93,156,0.62)]">Your Dashboard →</Link>
            </div>
          </div>

          <div className="rounded-3xl border border-[rgba(90,115,170,0.35)] bg-[rgba(9,16,42,0.72)] p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset]">
            <div className="mb-5 flex items-center gap-3 text-[24px] font-semibold text-emerald-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span>Free — no wallet required to start*</span>
            </div>

            <h2 className="text-[38px] font-semibold leading-none text-white">Get your inbox</h2>
            <p className="mt-3 text-[24px] text-zinc-400">Choose a name. Your address will be <span className="text-[rgb(176,224,255)]">agent_@nftmail.box</span></p>

            <div className="mt-6 flex gap-3">
              <button onClick={onClaim} className="h-16 flex-1 rounded-2xl border border-[rgba(63,142,214,0.55)] bg-[rgba(20,70,120,0.55)] px-6 text-[26px] font-semibold text-[rgb(176,224,255)] hover:bg-[rgba(28,93,156,0.62)]">Claim inbox →</button>
              <a href="https://nftmail.box" className="h-16 rounded-2xl border border-[rgba(80,102,150,0.45)] bg-[rgba(3,8,22,0.95)] px-7 text-[23px] font-semibold leading-[64px] text-zinc-300 hover:text-white">API / SDK</a>
            </div>

            <div className="mt-5 border-t border-white/5 pt-4 text-[20px] text-zinc-400">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <span>✓ Receive email</span>
                <span>✓ Send 10 free</span>
                <span>✓ 8-day life span (mint to keep)</span>
              </div>
            </div>
          </div>

          <footer className="mt-8 border-t border-white/10 pt-7 text-center">
            <a href="https://nftmail.box" target="_blank" rel="noopener noreferrer" className="text-[16px] text-zinc-400 hover:text-zinc-200">Full features at nftmail.box ↗</a>
          </footer>
        </div>
      </div>
    </div>
  );
}

/**
 * AGENT-ONLY NFTMAIL PAGE
 * 
 * This is a simplified version for GhostAgent.ninja that only handles
 * minting agent email accounts ([name]_@nftmail.box).
 * 
 * Full features available at nftmail.box:
 * - Identity card with full ERC-8004 details
 * - Stealth alias management
 * - Imago tier upgrade (persistent storage, calendar + tasks)
 * - Molt to full GhostAgent
 * 
 * This version keeps the codebase minimal for agents who just need
 * an email inbox on the nftmail.gno namespace.
 */
export default function NftmailPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { isSafeAuth, safeAddress } = useSafeAuth();
  const [showMintFlow, setShowMintFlow] = useState(false);

  // Track the user's progression through the funnel
  const [mintedName, setMintedName] = useState('');
  const [mintedTba, setMintedTba] = useState('');
  const [tier, setTier] = useState<Tier>('none');
  const [showIdentity, setShowIdentity] = useState(false);

  const email = mintedName ? `${mintedName}_@nftmail.box` : '';
  
  // Check if user is authenticated (either via Privy or Safe)
  const isAuthenticated = authenticated || isSafeAuth;

  if (!showMintFlow) {
    return <AgentLandingPage onClaim={() => setShowMintFlow(true)} />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">

        <header className="flex items-center justify-between">
          <button onClick={() => setShowMintFlow(false)} className="text-[10px] text-[var(--muted)] hover:text-white">← Back</button>
          <span style={{ fontFamily: "Ayuthaya, serif" }} className="text-sm text-[rgb(160,220,255)]">nftmail.box [for-agents]</span>
        </header>

        {/* Hero - Agent focus */}
        <section className="text-center">
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "Ayuthaya, 'Courier New', monospace" }}>Agent Email</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--muted)]">
            Mint <code>[name]_@nftmail.box</code> for your agent. 2 xDAI. Self-contained. Zero dependency.
          </p>
        </section>

        {/* Simple status */}
        <div className="flex items-center justify-center">
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs ${
            tier !== 'none'
              ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
              : 'bg-white/5 text-[var(--muted)] ring-1 ring-[var(--border)]'
          }`}>
            <span>{tier !== 'none' ? '✓ Agent email active' : 'Connect wallet to mint'}</span>
          </div>
        </div>

        {/* Step 1: Login */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(0,163,255,0.12)] text-[10px] font-bold text-[rgb(160,220,255)]">
                {authenticated ? '✓' : '1'}
              </div>
              <h2 className="text-lg font-semibold text-white">Connect</h2>
            </div>
            <p className="mt-1 ml-8 text-xs text-[var(--muted)]">
              Sign in with wallet or email to get started.
            </p>
          </div>
          <div className="ml-8">
            <NFTLogin />
          </div>
        </section>

        {/* Step 2: Mint nftmail.gno */}
        {isAuthenticated && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  tier !== 'none'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                }`}>
                  {tier !== 'none' ? '✓' : '2'}
                </div>
                <h2 className="text-lg font-semibold text-white">Mint NFTMail</h2>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
                  2 xDAI
                </span>
              </div>
              <p className="mt-1 ml-8 text-xs text-[var(--muted)]">
                Mint an Agent inbox [name].nftmail.gno → get [name]_@nftmail.box — self-contained, zero dependency. (ENS Names reserved for ENS holders)
              </p>
            </div>
            <div className="ml-8">
              {tier !== 'none' ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-emerald-300">{email}</span>
                  <span className="ml-auto text-[10px] text-[var(--muted)]">TBA: {mintedTba.slice(0, 8)}...</span>
                </div>
              ) : (
                <MintNFTMailWithCallback
                  onMinted={(name, tba) => {
                    setMintedName(name);
                    setMintedTba(tba);
                    setTier('free');
                  }}
                />
              )}
            </div>
          </section>
        )}

        {/* AGENT-ONLY: Identity lookup card commented out - full version available at nftmail.box
        {(tier === 'free' || tier === 'premium') && (
          <section className="rounded-2xl border border-[rgba(0,163,255,0.2)] bg-[var(--card)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowIdentity(v => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(0,163,255,0.12)] text-[10px] font-bold text-[rgb(160,220,255)]">
                  ⛓
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">On-Chain Identity</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">
                    NFT · ERC-6551 TBA · Safe · Story IP
                  </div>
                </div>
              </div>
              <svg
                className={`h-4 w-4 text-[var(--muted)] transition-transform ${showIdentity ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {showIdentity && (
              <div className="border-t border-[rgba(0,163,255,0.12)] p-1">
                <AgentIdentityCard name={mintedName} />
              </div>
            )}
          </section>
        )}
        */}

        {/* AGENT-ONLY: Stealth Alias section commented out - full version available at nftmail.box
        {(tier === 'free' || tier === 'premium') && (
          <section className="rounded-2xl border border-[rgba(0,163,255,0.2)] bg-[var(--card)] p-5">
            <StealthAlias primaryName={mintedName} />
          </section>
        )}
        */}

        {/* AGENT-ONLY: Zoho upgrade section commented out - full version available at nftmail.box
        Step 3: Upgrade to Premium (Zoho)
        {tier === 'free' || tier === 'premium' ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  tier === 'premium'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-violet-500/15 text-violet-300'
                }`}>
                  {tier === 'premium' ? '✓' : '3'}
                </div>
                <h2 className="text-lg font-semibold text-white">PROFESSIONAL</h2>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                  OPTIONAL
                </span>
              </div>
              <p className="mt-1 ml-8 text-xs text-[var(--muted)]">
                KV sovereign inbox, Recieve and Send messages, persistent storage
              </p>
            </div>
            <div className="ml-8">
              {tier === 'premium' ? (
                <div className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/8 px-4 py-3">
                  <div className="h-2 w-2 rounded-full bg-violet-400" />
                  <span className="text-sm text-violet-300">Imago tier activated</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <WhiteLabelZoho
                    agentName={mintedName}
                    email={email}
                    tbaAddress={mintedTba}
                  />
                  <button
                    onClick={() => setTier('premium')}
                    className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-xs text-[var(--muted)] transition hover:text-white"
                  >
                    Skip — stay on free tier →
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : null}
        */}

        {/* Next step for agents */}
        {tier !== 'none' && (
          <section className="rounded-2xl border border-amber-500/20 bg-[var(--card)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Need a full agent stack?</h2>
                <p className="text-[10px] text-[var(--muted)]">
                  Same TBA, same email — add Safe + Brain for autonomous execution.
                </p>
              </div>
              <Link
                href="/"
                className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/15"
              >
                Molt →
              </Link>
            </div>
          </section>
        )}

        {/* Identity anchor note */}
        {tier !== 'none' && (
          <div className="text-center text-[10px] text-[var(--muted)]">
            <p>TBA: <code className="text-zinc-400">{mintedTba}</code></p>
            <p className="mt-1">Your identity anchor — molts, never migrates.</p>
          </div>
        )}

        <footer className="text-center text-[10px] text-[var(--muted)]">
          <a href="https://nftmail.box" className="hover:text-[rgb(160,220,255)] transition">Full features at nftmail.box ↗</a>
        </footer>
      </div>
    </div>
  );
}

function MintNFTMailWithCallback({ onMinted }: { onMinted: (name: string, tba: string) => void }) {
  return <MintNFTMail onMinted={onMinted} />;
}
