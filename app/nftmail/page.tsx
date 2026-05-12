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
  const { wallets } = useWallets();
  const inboxUrl = checkName ? `https://nftmail.box/inbox/${checkName}_` : '';
  const walletAddress = wallets[0]?.address || '';

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-10 md:px-6">
        <div className="w-full">
          <header className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4d0' }} className="text-4xl font-bold leading-none tracking-wide">nftmail.box</span>
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#8c8a88' }} className="text-2xl font-bold leading-none">[for-agents]</span>
            </div>
            <p className="text-center" style={{ fontSize: '13px', color: '#8e96a8' }}>A free agent email inbox for your agent. No Credit Card. No personal data.</p>
          </header>

          <div style={{ marginTop: '44px' }} className="rounded-2xl border border-[#275482] bg-[#0f1323] p-5">
            <h2 className="mb-3 text-sm font-semibold text-white">Check an Agent Inbox</h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={checkName}
                  onChange={(e) => setCheckName(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="agent-name"
                  className="w-full rounded-lg border border-[#275482] bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">_@nftmail.box</span>
              </div>
              <a
                href={inboxUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!checkName || checkName.length < 2) e.preventDefault(); }}
                className={`rounded-lg border border-[#275482] bg-[#16253d] px-4 py-2 text-xs font-semibold text-[#acdbfc] transition hover:opacity-80 ${!checkName || checkName.length < 2 ? 'opacity-40 pointer-events-none' : ''}`}
              >
                Check →
              </a>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-[10px] text-zinc-400">Manage all your inboxes</span>
              <a href={`https://nftmail.box/dashboard${walletAddress ? `?wallet=${walletAddress}` : ''}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[#275482] bg-[#16253d] px-3 py-1.5 text-[10px] font-semibold text-white transition hover:opacity-80">Your email Dashboard →</a>
            </div>
          </div>

          <div style={{ marginTop: '44px' }} className="rounded-2xl border border-[#275482] bg-[#0f1323] p-5">
            <div className="mb-3 flex items-center gap-2 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400">Free — no wallet required to start*</span>
            </div>
            <h2 className="mb-1 text-sm font-semibold text-white">Claim your inbox</h2>
            <p className="mb-4 text-[11px] text-zinc-400">
              Choose a name. Your address will be <span className="text-[rgb(160,220,255)]">agent_@nftmail.box</span>
            </p>
            <div className="flex gap-2">
              <button onClick={onClaim} className="flex-1 rounded-lg border border-[#275482] bg-[#16253d] px-4 py-2.5 text-sm font-semibold text-[#acdbfc] transition hover:opacity-80">
                Mint an @nftmail.box →
              </button>
              <a href="https://nftmail.box/sdk" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2.5 text-xs font-semibold transition hover:text-white" style={{ color: '#34d399' }}>
                API / SDK
              </a>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-400">
              <span>✓ Receive email</span>
              <span>✓ Send 10 free</span>
              <span>✓ 8-day life span (mint to keep)</span>
            </div>
          </div>

          <footer className="mt-8 text-center">
            <a href="https://nftmail.box" target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-400/60 transition hover:text-zinc-400">
              Human and agent accounts at nftmail.box ↗
            </a>
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
 * - Premium tier upgrade (persistent storage, calendar + tasks)
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
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10 md:px-6">

        <header className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4d0' }} className="text-4xl font-bold leading-none tracking-wide">nftmail.box</span>
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#8c8a88' }} className="text-2xl font-bold leading-none">[for-agents]</span>
          </div>
          <p className="text-center" style={{ fontSize: '13px', color: '#8e96a8' }}>A free agent email inbox for your agent. No Credit Card. No personal data.</p>
          <button onClick={() => setShowMintFlow(false)} className="text-xs text-zinc-400 hover:text-white">← Back</button>
        </header>

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
                Mint an Agent inbox [name].nftmail.gno → get [name]_@nftmail.box — 30-day history window – self-contained, zero dependency. (ENS Names reserved for ENS holders)
              </p>
            </div>
            <div className="ml-8 space-y-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300/80">
                Mint {'{name}'}.nftmail.gno → get {'{name}'}_@nftmail.box. 2 xDAI — born a Lite. 30-day history, send 10 emails via API. Molt to Premium for aliases, persistent history and unlimited send.
              </div>
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
                  <span className="text-sm text-violet-300">Premium tier activated</span>
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
          <a href="https://nftmail.box" className="hover:text-[rgb(160,220,255)] transition">Human and agent accounts at nftmail.box ↗</a>
        </footer>
      </div>
    </div>
  );
}

function MintNFTMailWithCallback({ onMinted }: { onMinted: (name: string, tba: string) => void }) {
  return <MintNFTMail onMinted={onMinted} />;
}
