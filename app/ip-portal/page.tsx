'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallets } from '@privy-io/react-auth';
import { AuthorshipDeclarationModal } from '../components/AuthorshipDeclarationModal';
import type { AuthorshipDeclarationRecord } from '../services/authorship-declaration';

type PortalStep = 'connect' | 'agent' | 'declare' | 'register';

const STEP_LABELS = [
  { n: 1, key: 'connect', label: 'Connect Wallet' },
  { n: 2, key: 'agent',   label: 'Select Agent' },
  { n: 3, key: 'declare', label: 'Sign Declaration' },
  { n: 4, key: 'register', label: 'Register on Story' },
];

const STEP_INDEX: Record<PortalStep, number> = {
  connect: 0, agent: 1, declare: 2, register: 3,
};

export default function IpPortalPage() {
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const [step, setStep] = useState<PortalStep>('connect');
  const [agentName, setAgentName] = useState('');
  const [safeAddress, setSafeAddress] = useState('');
  const [agentTokenId, setAgentTokenId] = useState('');
  const [domain, setDomain] = useState('nftmail.box');
  const [showModal, setShowModal] = useState(false);
  const [record, setRecord] = useState<AuthorshipDeclarationRecord | null>(null);

  const currentStepIndex = STEP_INDEX[step];

  function handleConnect() {
    if (wallet?.address) setStep('agent');
  }

  function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (agentName && safeAddress && agentTokenId) {
      setStep('declare');
    }
  }

  function handleDeclarationComplete(r: AuthorshipDeclarationRecord) {
    setRecord(r);
    setShowModal(false);
    setStep('register');
  }

  const storyPortalUrl = record
    ? `https://portal.story.foundation/registration?name=${encodeURIComponent(agentName + '.' + domain)}&description=${encodeURIComponent('GhostAgent AI Agent — ' + agentName + '.' + domain)}`
    : 'https://portal.story.foundation/registration';

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(176,128,92,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.1),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 md:px-6">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏛️</span>
            <div className="text-xs font-semibold tracking-[0.18em] text-amber-300">IP PORTAL</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white">
              Dashboard
            </Link>
            <Link href="/" className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1.5 text-[11px] text-[var(--muted)] transition hover:text-white">
              Home
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#f2eee4] sm:text-3xl">
            Sovereign IP Registration
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Declare human authorship · Pin to IPFS · Register on Story Protocol
          </p>
          <p className="mt-1 text-[11px] text-amber-400/70">
            EIP-712 signed declaration · IPFS pinned · GlassBox logged
          </p>
        </section>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0">
          {STEP_LABELS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                  i < currentStepIndex
                    ? 'border-amber-600 bg-amber-700/30 text-amber-300'
                    : i === currentStepIndex
                    ? 'border-amber-500 bg-amber-600/20 text-amber-200'
                    : 'border-[var(--border)] bg-black/20 text-[var(--muted)]'
                }`}>
                  {i < currentStepIndex ? '✓' : s.n}
                </div>
                <span className={`hidden text-[9px] tracking-wide sm:block ${i === currentStepIndex ? 'text-amber-300' : 'text-[var(--muted)]'}`}>
                  {s.label.toUpperCase()}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`mx-2 mb-4 h-px w-12 sm:w-16 ${i < currentStepIndex ? 'bg-amber-700/50' : 'bg-[var(--border)]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step panels */}
        <div className="rounded-2xl border border-[var(--border)] bg-[#0d0a07]/80 p-6 shadow-2xl">

          {/* Step 1: Connect */}
          {step === 'connect' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#f2eee4]">Connect your wallet</h2>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  Your wallet address becomes the declared Author. Use the wallet that owns the Agent NFT.
                </p>
              </div>
              {wallet?.address ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-800/40 bg-green-900/10 px-4 py-3 text-sm text-green-400 flex items-center gap-2">
                    <span>✓</span>
                    <span className="font-mono text-xs break-all">{wallet.address}</span>
                  </div>
                  <button
                    onClick={handleConnect}
                    className="w-full rounded-lg bg-[#b0805c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c49070]"
                  >
                    Continue →
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-900/30 bg-amber-900/10 px-4 py-4 text-center text-sm text-amber-300/80">
                  No wallet connected. Use the wallet button in the top navigation to connect.
                </div>
              )}
            </div>
          )}

          {/* Step 2: Agent details */}
          {step === 'agent' && (
            <form onSubmit={handleAgentSubmit} className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#f2eee4]">Select your agent</h2>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  Enter the agent you are declaring authorship over.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted)] uppercase tracking-wider">Agent Name</label>
                  <input
                    value={agentName}
                    onChange={e => setAgentName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. eyemine"
                    required
                    className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder:text-[var(--muted)] focus:border-amber-600/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted)] uppercase tracking-wider">Domain (SLD)</label>
                  <select
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] focus:border-amber-600/50 focus:outline-none"
                  >
                    <option value="nftmail.box">nftmail.box</option>
                    <option value="openclaw.gno">openclaw.gno</option>
                    <option value="vault.gno">vault.gno</option>
                    <option value="molt.gno">molt.gno</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted)] uppercase tracking-wider">Agent Safe Address</label>
                  <input
                    value={safeAddress}
                    onChange={e => setSafeAddress(e.target.value)}
                    placeholder="0x..."
                    required
                    pattern="0x[0-9a-fA-F]{40}"
                    className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 font-mono text-sm text-[#f2eee4] placeholder:text-[var(--muted)] focus:border-amber-600/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted)] uppercase tracking-wider">Agent NFT Token ID</label>
                  <input
                    value={agentTokenId}
                    onChange={e => setAgentTokenId(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 42"
                    required
                    className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder:text-[var(--muted)] focus:border-amber-600/50 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('connect')}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-white"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-[#b0805c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c49070]"
                >
                  Continue →
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Sign Declaration */}
          {step === 'declare' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#f2eee4]">Sign IP Authorship Declaration</h2>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  A legally binding EIP-712 declaration establishing you as the human author directing{' '}
                  <span className="font-mono text-[#c8bfb0]">{agentName}.{domain}</span>.
                  Signed record is pinned permanently to IPFS and logged to GlassBox.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-3 text-[11px] space-y-1.5">
                <div className="flex gap-3">
                  <span className="w-24 shrink-0 text-[var(--muted)]">Agent</span>
                  <span className="font-mono text-[#c8bfb0]">{agentName}.{domain}</span>
                </div>
                <div className="flex gap-3">
                  <span className="w-24 shrink-0 text-[var(--muted)]">Author wallet</span>
                  <span className="font-mono text-[#c8bfb0] break-all">{wallet?.address}</span>
                </div>
                <div className="flex gap-3">
                  <span className="w-24 shrink-0 text-[var(--muted)]">Safe</span>
                  <span className="font-mono text-[#c8bfb0] break-all">{safeAddress}</span>
                </div>
                <div className="flex gap-3">
                  <span className="w-24 shrink-0 text-[var(--muted)]">Token ID</span>
                  <span className="font-mono text-[#c8bfb0]">#{agentTokenId}</span>
                </div>
              </div>

              <div className="rounded-lg border border-amber-900/30 bg-amber-900/10 px-4 py-3 text-[11px] text-amber-300/80">
                <strong>Important:</strong> You must acquire <strong>$IP tokens</strong> and fund your Safe before registering on Story Protocol in the next step. GhostAgent does not handle token acquisition or payment on your behalf.
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('agent')}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition hover:text-white"
                >
                  Back
                </button>
                <button
                  onClick={() => setShowModal(true)}
                  className="flex-1 rounded-lg bg-[#b0805c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c49070]"
                >
                  Open Declaration →
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Register on Story */}
          {step === 'register' && record && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#f2eee4]">Register on Story Protocol</h2>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  Your declaration is signed and pinned. Copy your IPFS CID, then follow the steps below
                  to register your agent as an IP Asset on Story Protocol's independent platform.
                </p>
              </div>

              {/* Declaration receipt */}
              <div className="rounded-lg border border-green-800/40 bg-green-900/10 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <span>✓</span>
                  <span>Declaration signed and pinned to IPFS</span>
                </div>
                <dl className="space-y-1.5 text-[11px]">
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-[var(--muted)]">IPFS CID</dt>
                    <dd className="break-all font-mono text-[#c8bfb0]">{record.ipfsCid}</dd>
                  </div>
                  {record.glassBoxCid && (
                    <div className="flex gap-3">
                      <dt className="w-20 shrink-0 text-[var(--muted)]">GlassBox</dt>
                      <dd className="break-all font-mono text-[#c8bfb0]">{record.glassBoxCid}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Copy CID — prominent, before instructions */}
              <button
                onClick={() => navigator.clipboard.writeText(record.ipfsCid)}
                className="w-full rounded-lg border border-amber-700/40 bg-amber-900/10 px-5 py-2.5 text-[12px] font-semibold text-amber-300 transition hover:border-amber-600/60 hover:bg-amber-900/20"
              >
                Copy IPFS CID to clipboard ↗
              </button>

              {/* Step-by-step guide */}
              <div className="rounded-lg border border-[var(--border)] bg-black/20 px-4 py-4 space-y-4">
                <p className="text-[12px] font-semibold text-[#f2eee4]">How to register on Story Protocol</p>

                <ol className="space-y-3 text-[11px] text-[var(--muted)]">
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">1</span>
                    <span>Acquire <strong className="text-[#c8bfb0]">$IP tokens</strong> from an exchange (Coinbase, Binance, OKX). Story Protocol requires $IP to pay registration fees — GhostAgent does not supply or handle these tokens.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">2</span>
                    <span>Open <strong className="text-[#c8bfb0]">portal.story.foundation/registration</strong> using the button below. Connect the wallet that owns your agent Safe.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">3</span>
                    <span>Upload your agent's image or media file. Set the <strong className="text-[#c8bfb0]">Name</strong> to <span className="font-mono">{agentName}.{domain}</span> and add a description.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">4</span>
                    <span>In the <strong className="text-[#c8bfb0]">metadata / additional fields</strong> section, add a field named <span className="font-mono text-[#c8bfb0]">socialLegal</span> and paste your IPFS CID. This links your legal declaration to the IP Asset.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">5</span>
                    <span>Select a <strong className="text-[#c8bfb0]">License</strong> — Commercial Use is recommended for agents you intend to monetise. Set your $IP price and revenue share.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[9px] font-bold text-[#c8bfb0]">6</span>
                    <span>Review and click <strong className="text-[#c8bfb0]">Register</strong>. The $IP fee constitutes consideration for the IP registration.</span>
                  </li>
                </ol>
              </div>

              {/* Legal deflection — prominent */}
              <div className="rounded-lg border border-red-900/30 bg-red-900/5 px-4 py-3 text-[11px] text-[var(--muted)] space-y-1">
                <p className="font-semibold text-[#f2eee4]">Third-party service notice</p>
                <p>
                  The button below opens <strong className="text-[#c8bfb0]">portal.story.foundation</strong>, a platform operated independently by Story Protocol Foundation.
                  GhostAgent Ninja Pty Ltd has no affiliation with, control over, or responsibility for that platform, its availability, its smart contracts, or any transactions you conduct on it.
                  You are solely responsible for acquiring $IP tokens, paying registration fees, and any legal or financial consequences of registration.
                  Seek independent legal advice before registering IP assets.
                </p>
              </div>

              {/* Story Protocol external link */}
              <a
                href={storyPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#7c4dff]/40 bg-[#7c4dff]/10 px-5 py-3 text-sm font-semibold text-[#a78bfa] transition hover:border-[#7c4dff]/70 hover:bg-[#7c4dff]/20"
              >
                Open Story Protocol Portal (external) ↗
              </a>

              <p className="text-center text-[10px] text-[var(--muted)]">
                GhostAgent provides declaration infrastructure only. Story Protocol registration is conducted on a third-party platform at your own initiative and cost.
              </p>
            </div>
          )}
        </div>

        {/* Legal footer */}
        <footer className="text-center text-[10px] text-[var(--muted)] space-y-1">
          <p>GhostAgent Ninja Pty Ltd</p>
          <p>
            <Link href="/terms" className="hover:text-[#c8bfb0] transition">Terms</Link>
            {' · '}
            <Link href="/privacy" className="hover:text-[#c8bfb0] transition">Privacy</Link>
            {' · '}
            <a href="https://story.foundation" target="_blank" rel="noopener noreferrer" className="hover:text-[#c8bfb0] transition">Story Protocol ↗</a>
          </p>
        </footer>
      </div>

      {/* Declaration modal */}
      {showModal && wallet?.address && (
        <AuthorshipDeclarationModal
          params={{
            agentName,
            domain,
            authorWallet: wallet.address,
            safeAddress,
            agentTokenId: Number(agentTokenId),
          }}
          onComplete={handleDeclarationComplete}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
