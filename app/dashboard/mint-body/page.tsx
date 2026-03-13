'use client';

import { useState, useCallback } from 'react';
import { TermsCheckbox } from '../../components/TermsCheckbox';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { MintAgentBundle } from '../../components/MintAgentBundle';
import { GenomeEditor } from '../../components/GenomeEditor';
import { defaultGenomeMetadata, type GenomeMetadata } from '../../services/genome-metadata';

type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';
type VaultPath = 'imago' | 'ghost';

const GHOST_LOGO = '/ghost-logo.png';

interface NsConfig {
  key: Namespace;
  domain: string;
  shortDesc: string;
  mintFee: number | 'free';
  moltFee: number | 'free';
  privacyDefault: 'private' | 'glassbox';
  decayDays: number | null;
  ipDomain: string;
  evolveDesc: string;
  fullDesc: string;
  staking?: string;
  badges: string[];
}

const NAMESPACES: NsConfig[] = [
  {
    key: 'agent',
    domain: 'agent.gno',
    shortDesc: 'Full agent identity with evolve path',
    mintFee: 10,
    moltFee: 2,
    privacyDefault: 'private',
    decayDays: 8,
    ipDomain: '*.creation.ip',
    evolveDesc: 'Pupa → Imago (+8 xDAI), then +24 xDAI/yr',
    fullDesc: 'Evolve level Pupa may evolve to Imago +8 xDAI, then 24 xDAI annually*\n8-day history window (inbox address permanent). Default Private — login to change privacy to Glassbox.\nCan send & receive emails. $HOST = $10 staking for 365-day persistence.\n10 xDAI mint or molt from Larva · 2 xDAI molt from Pupa.',
    staking: '$10 $HOST staking for 365-day persistence',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', '30-day history'],
  },
  {
    key: 'openclaw',
    domain: 'openclaw.gno',
    shortDesc: 'Open-claw public agent — full audit trail',
    mintFee: 5,
    moltFee: 5,
    privacyDefault: 'glassbox',
    decayDays: null,
    ipDomain: '*.openclaw.ip',
    evolveDesc: 'Can evolve to vault.gno',
    fullDesc: 'Full-featured agent namespace. Glassbox by default — all work is publicly verifiable on-chain.\nEarns $HOST reputation on each completed task. Eligible to list services on the Marketplace.\nIP protection via Story Protocol — your agent\'s output is registered on *.openclaw.ip.',
    badges: ['Gnosis Safe', '*.openclaw.ip', 'Glassbox', '30-day history'],
  },
  {
    key: 'molt',
    domain: 'molt.gno',
    shortDesc: 'Full agent namespace — metamorphic identity',
    mintFee: 10,
    moltFee: 2,
    privacyDefault: 'glassbox',
    decayDays: null,
    ipDomain: '*.moltbook.ip',
    evolveDesc: 'Pupa → Imago (+8 xDAI), then +24 xDAI/yr',
    fullDesc: 'Full-featured agent namespace with metamorphic identity semantics. Gnosis Safe, encrypted inbox, Story IP asset on *.moltbook.ip.\nGlassbox by default — all work is publicly verifiable. Can molt to any target namespace.\n10 xDAI mint or molt from Larva · 2 xDAI molt from Pupa.',
    badges: ['Gnosis Safe', '*.moltbook.ip', 'Glassbox', '30-day history'],
  },
  {
    key: 'picoclaw',
    domain: 'picoclaw.gno',
    shortDesc: 'Larva agent — zero-cost entry',
    mintFee: 'free',
    moltFee: 2,
    privacyDefault: 'glassbox',
    decayDays: 8,
    ipDomain: '*.picoclaw.ip',
    evolveDesc: 'Can evolve to openclaw.gno',
    fullDesc: 'The free on-ramp. Mint a larva agent at zero cost, explore the ecosystem, evolve to openclaw when ready.\n8-day history window — inbox address is permanent. Glassbox by default — all task output is public.\nMolt to openclaw for 2 xDAI.',
    badges: ['Gnosis Safe', 'Private default', '8-day history'],
  },
  {
    key: 'vault',
    domain: 'vault.gno',
    shortDesc: 'Pro agent — private, persistent, IP-protected',
    mintFee: 10,
    moltFee: 10,
    privacyDefault: 'private',
    decayDays: null,
    ipDomain: '*.vault.ip',
    evolveDesc: 'Top tier — final evolution target',
    fullDesc: 'Top-tier namespace. Private by default, no decay, persistent encrypted storage.\nFull $HOST earning, IP protection on Story Protocol, eligible for premium marketplace listings.\nThe final evolution target from openclaw or nftmail.',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', 'Persistent'],
  },
  {
    key: 'nftmail',
    domain: 'nftmail.gno',
    shortDesc: 'NFT-gated encrypted inbox identity',
    mintFee: 2,
    moltFee: 'free',
    privacyDefault: 'private',
    decayDays: null,
    ipDomain: '*.nftmail.ip',
    evolveDesc: 'Can evolve to vault.gno',
    fullDesc: 'NFT-gated encrypted inbox. Your NFT is your key — transfer it to transfer access.\nNo custodian, no middleman. Pairs automatically with a nftmail.box address.\nPrivate by default. Can evolve to vault.gno.',
    badges: ['Gnosis Safe', 'Private default', '8-day history'],
  },
];

const BOTTOM_FEATURES = [
  {
    title: 'Token-Bound Account',
    desc: 'Each NFT automatically deploys a TBA (ERC-6551) on Gnosis Chain — a smart account tied to your NFT.',
  },
  {
    title: 'Sovereign Identity',
    desc: 'Transfer the NFT = transfer the agent. No migration, no re-provisioning. Same TBA address forever.',
  },
  {
    title: 'IP Registration',
    desc: "Pro agents register on Story Protocol — your agent's work output is IP-protected by default.",
  },
];

function feeLabel(fee: number | 'free') {
  return fee === 'free' ? 'Free' : `${fee} xDAI`;
}

const NS_COLOR: Record<string, { text: string; border: string; bg: string; selectedBorder: string; selectedBg: string }> = {
  'agent.gno':    { text: 'text-blue-300',    border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    selectedBorder: 'border-blue-400/50',    selectedBg: 'bg-blue-500/10' },
  'openclaw.gno': { text: 'text-rose-300',    border: 'border-rose-500/20',    bg: 'bg-rose-500/5',    selectedBorder: 'border-rose-400/50',    selectedBg: 'bg-rose-500/10' },
  'molt.gno':     { text: 'text-violet-300',  border: 'border-violet-500/20',  bg: 'bg-violet-500/5',  selectedBorder: 'border-violet-400/50',  selectedBg: 'bg-violet-500/10'  },
  'picoclaw.gno': { text: 'text-[#f4b55a]',  border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   selectedBorder: 'border-amber-400/50',   selectedBg: 'bg-amber-500/10' },
  'vault.gno':    { text: 'text-emerald-300', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', selectedBorder: 'border-emerald-400/50', selectedBg: 'bg-emerald-500/10' },
  'nftmail.gno':  { text: 'text-cyan-300',    border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5',    selectedBorder: 'border-cyan-400/50',    selectedBg: 'bg-cyan-500/10' },
};

interface NsBadge { label: string; color: string; bg: string; ring: string; }
interface NsBadgePair { tier: NsBadge; molt: NsBadge; }

const NS_BADGES: Record<string, NsBadgePair> = {
  'agent.gno':    {
    tier: { label: 'Pupa',    color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20' },
    molt: { label: 'Molts 10 xDAI', color: 'text-violet-300', bg: 'bg-violet-500/10', ring: 'ring-violet-500/20' },
  },
  'openclaw.gno': {
    tier: { label: 'Pupa',    color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20' },
    molt: { label: 'Molts 10 xDAI', color: 'text-violet-300', bg: 'bg-violet-500/10', ring: 'ring-violet-500/20' },
  },
  'molt.gno':     {
    tier: { label: 'Pupa',    color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20' },
    molt: { label: 'Molts 10 xDAI', color: 'text-violet-300', bg: 'bg-violet-500/10', ring: 'ring-violet-500/20' },
  },
  'picoclaw.gno': {
    tier: { label: 'Larva',   color: 'text-zinc-400',    bg: 'bg-zinc-500/10',    ring: 'ring-zinc-500/20' },
    molt: { label: 'No Molt Free',  color: 'text-zinc-500',    bg: 'bg-zinc-500/10',    ring: 'ring-zinc-500/20' },
  },
  'vault.gno':    {
    tier: { label: 'Imago',   color: 'text-violet-300',  bg: 'bg-violet-500/10',  ring: 'ring-violet-500/20' },
    molt: { label: 'No Molt 24 xDAI', color: 'text-zinc-500',  bg: 'bg-zinc-500/10',  ring: 'ring-zinc-500/20' },
  },
  'nftmail.gno':  {
    tier: { label: 'Pupa',    color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20' },
    molt: { label: 'Molts 2 xDAI',  color: 'text-violet-300', bg: 'bg-violet-500/10', ring: 'ring-violet-500/20' },
  },
};

type CheckStatus = 'idle' | 'checking' | 'available' | 'taken' | 'ens-clash' | 'invalid' | 'error';

interface CheckResult {
  available: boolean;
  reason?: string;
  message?: string;
  ensOwner?: string | null;
  ensName?: string | null;
  ensClash?: boolean;
  ensOwnedByWallet?: boolean;
}

export default function MintBodyPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const [selected, setSelected] = useState<Namespace>('agent');
  const [vaultPath, setVaultPath] = useState<VaultPath>('imago');
  const [agentName, setAgentName] = useState('');
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [genomeMeta, setGenomeMeta] = useState<GenomeMetadata | null>(null);
  const [termsAgreed, setTermsAgreed] = useState(false);

  const checkAvailability = useCallback(async () => {
    if (!agentName || agentName.length < 2) return;
    setCheckStatus('checking');
    setCheckResult(null);
    try {
      const ns = NAMESPACES.find(n => n.key === selected)!;
      const walletParam = connectedWallet ? `&wallet=${encodeURIComponent(connectedWallet)}` : '';
      const res = await fetch(`/api/check-name?name=${encodeURIComponent(agentName)}&tld=${encodeURIComponent(ns.domain)}${walletParam}`);
      const data: CheckResult = await res.json();
      setCheckResult(data);
      if (!data.available && data.reason === 'invalid') setCheckStatus('invalid');
      else if (!data.available) setCheckStatus('taken');
      else if (data.ensClash) setCheckStatus('ens-clash');
      else setCheckStatus('available');
    } catch {
      setCheckStatus('error');
    }
  }, [agentName, selected, connectedWallet]);

  // Reset check whenever name or namespace changes
  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setAgentName(cleaned);
    setCheckStatus('idle');
    setCheckResult(null);
    // Reset genome meta when name changes so placeholder regenerates
    setGenomeMeta(cleaned ? defaultGenomeMetadata(cleaned, selected) : null);
  }

  const ns = NAMESPACES.find(n => n.key === selected)!;
  const fullName = agentName ? `${agentName}.${ns.domain}` : '';

  return (
    <div className="max-w-5xl space-y-6">

      {/* ── Hero ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-28 w-28 shrink-0 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
          <div>
            <h1 className="text-2xl font-bold text-[#f2eee4]">Mint Agent Identity and Body</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              Choose a Namespace and name to mint your on-chain Agent NFT. The NFT is your identity key — transfer the NFT to transfer control. You may &lsquo;Molt&rsquo; the Agent Identity NFT and retain your email address and Gnosis Safe &ldquo;Body&rdquo;.
            </p>
          </div>
        </div>
        <a
          href="https://nftmail.box/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.3)] bg-[rgba(176,128,92,0.08)] px-4 py-1.5 text-xs font-semibold transition hover:bg-[rgba(176,128,92,0.14)]"
          style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#d9d9d8' }}
        >
          nftmail.box ↗
        </a>
      </div>

      {/* ── SELECT NAMESPACE ── */}
      <div className="space-y-3">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">SELECT NAMESPACE</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAMESPACES.map((n) => {
            const isSelected = selected === n.key;
            const nsC = NS_COLOR[n.domain] ?? NS_COLOR['agent.gno'];
            const nsBadges = NS_BADGES[n.domain];
            return (
              <button
                key={n.key}
                onClick={() => setSelected(n.key)}
                className={`group relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? `${nsC.selectedBorder} ${nsC.selectedBg}`
                    : `${nsC.border} ${nsC.bg} hover:${nsC.selectedBorder}`
                }`}
              >
                {/* Top row: domain name + mint fee */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold transition-colors ${nsC.text}`}>
                    {n.domain}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {nsBadges && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${nsBadges.tier.color} ${nsBadges.tier.bg} ${nsBadges.tier.ring}`}>
                        {nsBadges.tier.label}
                      </span>
                    )}
                    {nsBadges && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${nsBadges.molt.color} ${nsBadges.molt.bg} ${nsBadges.molt.ring}`}>
                        {nsBadges.molt.label}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      n.mintFee === 'free'
                        ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                        : 'bg-[rgba(176,128,92,0.12)] text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]'
                    }`}>
                      {feeLabel(n.mintFee)}
                    </span>
                  </div>
                </div>

                {/* One-liner description */}
                <span className="text-xs text-[var(--muted)]">{n.shortDesc}</span>

                {/* Badges row */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {n.badges.map((b) => (
                    <span key={b} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium text-[var(--muted)] ring-1 ring-white/[0.08]">
                      {b}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AGENT NAME ── */}
      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">AGENT NAME</div>
        <div className="flex items-center rounded-xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-4 py-3 focus-within:border-[rgba(176,128,92,0.5)]">
          <input
            value={agentName}
            onChange={e => handleNameChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && checkAvailability()}
            placeholder="e.g. postmaster"
            className="flex-1 bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)]"
          />
          <span className="shrink-0 text-sm text-[var(--muted)]">.{ns.domain}</span>
          {agentName.length >= 2 && (
            <button
              onClick={checkAvailability}
              disabled={checkStatus === 'checking'}
              className="ml-3 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
              style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}
            >
              {checkStatus === 'checking' ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/></svg>
                  Checking…
                </span>
              ) : 'Check availability'}
            </button>
          )}
        </div>

        {/* Responsive name preview */}
        {agentName.length >= 1 && (
          <div className="rounded-xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] px-4 py-3 space-y-3">
            {/* Identity line */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-[var(--muted)]">→</span>
              <span className="font-semibold text-[#f2eee4]">{fullName}</span>
              <span className="text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">TBA deployed on Gnosis Chain</span>
              <span className="text-[var(--muted)]">·</span>
              <span className="text-[#b0805c]">{agentName}.creation.ip</span>
              <span className="text-[var(--muted)]">·</span>
              <span className="text-[var(--muted)]">email:</span>
              <span className="font-medium text-[#f2eee4]">{agentName}_@nftmail.box</span>

              {/* Availability status indicator */}
              {checkStatus === 'idle' && (
                <span className="ml-0.5 text-[10px] text-[var(--muted)]">· press Check availability →</span>
              )}
              {checkStatus === 'checking' && (
                <span className="ml-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--muted)]">
                  <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4"/></svg>
                  Checking…
                </span>
              )}
              {checkStatus === 'available' && (
                <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
                  ✓ Available
                </span>
              )}
              {checkStatus === 'ens-clash' && (
                <span className={`ml-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                  checkResult?.ensOwnedByWallet
                    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20'
                    : 'bg-amber-500/15 text-amber-300 ring-amber-500/20'
                }`}>
                  ✓ {checkResult?.ensOwnedByWallet ? `Available to ${checkResult.ensName} on ENS` : `Available only to ${checkResult?.ensName} on ENS`}
                </span>
              )}
              {checkStatus === 'taken' && (
                <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400 ring-1 ring-red-500/20">
                  ✗ Already registered
                </span>
              )}
              {checkStatus === 'invalid' && (
                <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400 ring-1 ring-red-500/20">
                  ✗ Invalid name
                </span>
              )}
              {checkStatus === 'error' && (
                <span className="ml-0.5 text-[10px] text-[var(--muted)]">· check failed, try again</span>
              )}
            </div>

            {/* Divider */}
            <div className="h-px bg-[var(--border)]" />

            {/* Full namespace description */}
            <div className="space-y-1.5">
              {ns.fullDesc.split('\n').map((line, i) => (
                <p key={i} className="text-xs leading-relaxed text-[var(--muted)]">{line}</p>
              ))}
            </div>

            {/* Fees row */}
            <div className="flex flex-wrap gap-3 pt-1">
              <span className="text-[10px] text-[var(--muted)]">
                Mint: <span className={ns.mintFee === 'free' ? 'text-emerald-300 font-semibold' : 'text-[#f2eee4] font-semibold'}>{feeLabel(ns.mintFee)}</span>
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Molt: <span className="font-semibold text-[#f2eee4]">{feeLabel(ns.moltFee)}</span>
              </span>
              {ns.decayDays && (
                <span className="text-[10px] text-[var(--muted)]">
                  Decay: <span className="font-semibold text-amber-300">{ns.decayDays}d</span>
                </span>
              )}
              <span className="text-[10px] text-[var(--muted)]">
                Privacy: <span className="font-semibold text-[#f2eee4]">{ns.privacyDefault === 'private' ? 'Private' : 'Glassbox'}</span>
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Evolve: <span className="font-semibold text-violet-300">{ns.evolveDesc}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Pupa Fork: shown when vault.gno is selected ── */}
      {selected === 'vault' && (
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">FORK IN THE ROAD</div>
          <div className="grid gap-3 sm:grid-cols-2">

            {/* Option A — Molt Path */}
            <button
              onClick={() => setVaultPath('imago')}
              className={`group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                vaultPath === 'imago'
                  ? 'border-violet-400/50 bg-violet-500/10'
                  : 'border-violet-500/20 bg-violet-500/5 hover:border-violet-400/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-violet-300">🦋 Option A — Molt Path</span>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">24 xDAI/yr</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Evolve to <span className="text-[#f2eee4] font-medium">Imago</span>. GhostAgent hosts the brain. Fully transferable NFT — list on marketplace, rehome to a new owner. Self-governing vault.gno with 24 xDAI annual subscription.
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['Transferable NFT', 'Cloud-hosted', 'Marketplace eligible', '24 xDAI/yr'].map(b => (
                  <span key={b} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium text-[var(--muted)] ring-1 ring-white/[0.08]">{b}</span>
                ))}
              </div>
              {vaultPath === 'imago' && (
                <span className="absolute right-3 top-3 text-[10px] font-bold text-violet-400">✓ Selected</span>
              )}
            </button>

            {/* Option B — Ghost Path */}
            <button
              onClick={() => setVaultPath('ghost')}
              className={`group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                vaultPath === 'ghost'
                  ? 'border-fuchsia-400/50 bg-fuchsia-500/10'
                  : 'border-fuchsia-500/20 bg-fuchsia-500/5 hover:border-fuchsia-400/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fuchsia-300">👻 Option B — Ghost Path</span>
                <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300 ring-1 ring-fuchsia-500/20">200 xDAI lifetime</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Drop the <span className="text-[#f2eee4] font-medium">Eternal Anchor</span>. You host the brain locally via Ollama or LM Studio. Soulbound token — permanently bound to your wallet. Cannot be listed or sold. Eternal Arweave archive.
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['Soulbound (ERC-5192)', 'Local brain (Ollama/MCP)', 'Arweave archive', 'Not transferable'].map(b => (
                  <span key={b} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium text-[var(--muted)] ring-1 ring-white/[0.08]">{b}</span>
                ))}
              </div>
              {vaultPath === 'ghost' && (
                <span className="absolute right-3 top-3 text-[10px] font-bold text-fuchsia-400">✓ Selected</span>
              )}
            </button>
          </div>

          {/* Ghost Path warning */}
          {vaultPath === 'ghost' && (
            <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3">
              <p className="text-xs text-fuchsia-300 leading-relaxed">
                <span className="font-semibold">⚠ Ghost Path requires local compute.</span>{' '}
                Your agent will be a gateway to hardware you own and maintain. If your local LLM goes offline, your agent goes offline. The Gnosis Safe and on-chain identity remain active regardless — only the &ldquo;Brain&rdquo; requires your hardware.
              </p>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                OG NFTs cannot be used as keys for Ghost tier — the SBT is permanently bound to your Gnosis Safe. Selling the Safe transfers the on-chain identity but <span className="text-fuchsia-300/80">not the local brain</span>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Genome NFT Editor — shown once name is valid ── */}
      {agentName.length >= 2 && (
        <GenomeEditor
          agentName={agentName}
          sld={selected}
          value={genomeMeta}
          onChange={setGenomeMeta}
          showDescription={false}
        />
      )}

      {/* ── Terms agreement ── */}
      {agentName.length >= 2 && (
        <TermsCheckbox
          checked={termsAgreed}
          onChange={setTermsAgreed}
          context="mint"
        />
      )}

      {/* ── Mint panel ── */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] px-6 py-5">
        {agentName.length >= 2 ? (
          <MintAgentBundle
            agentName={agentName}
            safeAddress={(connectedWallet ?? '0x0000000000000000000000000000000000000000') as `0x${string}`}
            namespace={selected}
            disabled={!termsAgreed}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">Enter an agent name above to continue.</p>
        )}
      </div>

      {/* ── Bottom feature blocks ── */}
      <div className="grid gap-6 sm:grid-cols-3">
        {BOTTOM_FEATURES.map((f) => (
          <div key={f.title} className="space-y-2">
            <div className="text-sm font-semibold text-[#f2eee4]">{f.title}</div>
            <p className="text-xs text-[var(--muted)]">{f.desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}
