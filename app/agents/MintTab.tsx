'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { TermsCheckbox } from '../components/TermsCheckbox';
import { MintAgentBundle } from '../components/MintAgentBundle';
import { GenomeEditor } from '../components/GenomeEditor';
import { defaultGenomeMetadata, type GenomeMetadata } from '../services/genome-metadata';

type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';
type VaultPath = 'imago' | 'ghost';

const LIFECYCLE_ICONS = {
  larva: 'https://gateway.lighthouse.storage/ipfs/bafkreicekhu7rr7noqtv2t4sivy5mqncqgbqnf6cq63dfqyvi5klgk7bv4',
  pupa:  'https://gateway.lighthouse.storage/ipfs/bafkreihajbm2nwtuwp4hsgputfqintlw7zxbz4jbpx772ur3rfvfhwadge',
  imago: 'https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u',
  ghost: 'https://gateway.lighthouse.storage/ipfs/bafkreifjrzcptcss7qvdzpphjdvupmfhizjejqyswycrofjlm72tfi43hq',
};

interface NsConfig {
  key: Namespace;
  domain: string;
  shortDesc: string;
  mintFee: number | 'free';
  moltToFee: number | null;              // cost to molt TO this namespace (null = N/A)
  moltToFeeFromNftmail: number | null;   // cost when molting FROM nftmail.gno
  privacyDefault: 'private' | 'glassbox';
  decayDays: number | null;
  ipDomain: string;
  moltPath: string | null;               // e.g. 'imago/ghost', 'ghost', null
  fullDesc: string;
  staking?: string;
  badges: string[];
  tier: 'larva' | 'pupa' | 'imago';
  tierLabel: string;                     // 'Can Molt', 'Can Cycle', 'Larva-only', 'Imago-only'
}

const NAMESPACES: NsConfig[] = [
  {
    key: 'agent',
    domain: 'agent.gno',
    shortDesc: 'Full agent identity with on-chain IP and molt path',
    mintFee: 10,
    moltToFee: 2,
    moltToFeeFromNftmail: 10,
    privacyDefault: 'private',
    decayDays: 8,
    ipDomain: '*.creation.ip',
    moltPath: 'imago/ghost',
    fullDesc: 'Full agent identity with on-chain IP and molt path. 8-day history. Private by default.\n10 xDAI mint · 2 xDAI molt-to (10 xDAI from nftmail.gno). Bundled *.creation.ip + nftmail.box address.',
    staking: '$10 $HOST staking for 365-day persistence',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', '8-day history'],
    tier: 'pupa',
    tierLabel: 'Can Molt',
  },
  {
    key: 'openclaw',
    domain: 'openclaw.gno',
    shortDesc: 'Full agent identity with on-chain IP and molt path',
    mintFee: 10,
    moltToFee: 2,
    moltToFeeFromNftmail: 10,
    privacyDefault: 'private',
    decayDays: 8,
    ipDomain: '*.creation.ip',
    moltPath: 'imago/ghost',
    fullDesc: 'Full agent identity with on-chain IP and molt path. 8-day history. Private by default.\n10 xDAI mint · 2 xDAI molt-to (10 xDAI from nftmail.gno). Bundled *.creation.ip + nftmail.box address.',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', '8-day history'],
    tier: 'pupa',
    tierLabel: 'Can Molt',
  },
  {
    key: 'molt',
    domain: 'molt.gno',
    shortDesc: '#BuildInPublic / Public email audit trail (any OTP comms protected)',
    mintFee: 10,
    moltToFee: 2,
    moltToFeeFromNftmail: 10,
    privacyDefault: 'glassbox',
    decayDays: 30,
    ipDomain: '*.moltbook.ip',
    moltPath: 'imago/ghost',
    fullDesc: 'Glassbox by default — all work is publicly verifiable. Public conversations (any OTP comms protected) + Story Protocol .moltbook.ip IP registration. 30-day history.\n10 xDAI mint · 2 xDAI molt-to (10 xDAI from nftmail.gno).',
    badges: ['Gnosis Safe', '*.moltbook.ip', 'Glassbox', '30-day history'],
    tier: 'pupa',
    tierLabel: 'Can Cycle',
  },
  {
    key: 'picoclaw',
    domain: 'picoclaw.gno',
    shortDesc: 'Larva agent — zero cost entry',
    mintFee: 'free',
    moltToFee: null,
    moltToFeeFromNftmail: null,
    privacyDefault: 'private',
    decayDays: 8,
    ipDomain: '*.picoclaw.ip',
    moltPath: null,
    fullDesc: 'The free on-ramp. Mint a larva agent with no fees, explore the ecosystem. 8-day inbox history window on free tier.\nNo molt path — larva-only namespace.',
    badges: ['Gnosis Safe', 'Private default', '8-day history'],
    tier: 'larva',
    tierLabel: 'Larva-only',
  },
  {
    key: 'vault',
    domain: 'vault.gno',
    shortDesc: 'Top-tier Imago namespace with persistent storage',
    mintFee: 24,
    moltToFee: 14,
    moltToFeeFromNftmail: 22,
    privacyDefault: 'private',
    decayDays: null,
    ipDomain: '*.creation.ip',
    moltPath: 'ghost',
    fullDesc: 'Top-tier Imago namespace. Private by default, persistent storage, IP protection on Story Protocol, and full $HOST earning.\n24 xDAI includes 1 year subscription, then 24 xDAI annually (or downgrade to Pupa 30-day history).\n14 xDAI molt-to (22 xDAI from nftmail.gno).',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', 'Persistent'],
    tier: 'imago',
    tierLabel: 'Imago-only',
  },
  {
    key: 'nftmail',
    domain: 'nftmail.gno',
    shortDesc: 'Identity firewall for your inbox',
    mintFee: 2,
    moltToFee: 2,
    moltToFeeFromNftmail: null,
    privacyDefault: 'private',
    decayDays: 30,
    ipDomain: '*.creation.ip',
    moltPath: 'imago/ghost',
    fullDesc: 'NFT-gated encrypted inbox. Your NFT is your key — transfer it to transfer access. No custodian, no middleman. Pairs with nftmail.box addresses.\n2 xDAI mint · 2 xDAI molt-to.',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', '30-day history'],
    tier: 'pupa',
    tierLabel: 'Can Cycle',
  },
];

const NS_COLOR: Record<string, { text: string; border: string; bg: string; selectedBorder: string; selectedBg: string }> = {
  'agent.gno':    { text: 'text-blue-300',    border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    selectedBorder: 'border-blue-400/50',    selectedBg: 'bg-blue-500/10' },
  'openclaw.gno': { text: 'text-rose-300',    border: 'border-rose-500/20',    bg: 'bg-rose-500/5',    selectedBorder: 'border-rose-400/50',    selectedBg: 'bg-rose-500/10' },
  'molt.gno':     { text: 'text-violet-300',  border: 'border-violet-500/20',  bg: 'bg-violet-500/5',  selectedBorder: 'border-violet-400/50',  selectedBg: 'bg-violet-500/10' },
  'picoclaw.gno': { text: 'text-[#f4b55a]',  border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   selectedBorder: 'border-amber-400/50',   selectedBg: 'bg-amber-500/10' },
  'vault.gno':    { text: 'text-emerald-300', border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', selectedBorder: 'border-emerald-400/50', selectedBg: 'bg-emerald-500/10' },
  'nftmail.gno':  { text: 'text-cyan-300',    border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5',    selectedBorder: 'border-cyan-400/50',    selectedBg: 'bg-cyan-500/10' },
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

function feeLabel(fee: number | 'free') {
  return fee === 'free' ? 'Free' : `${fee} xDAI`;
}

export default function MintTab() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? null;

  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Namespace>('agent');
  const [vaultPath, setVaultPath] = useState<VaultPath>('imago');
  const [agentName, setAgentName] = useState('');
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [genomeMeta, setGenomeMeta] = useState<GenomeMetadata | null>(null);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [couponCode, setCouponCode]   = useState('');
  const [couponState, setCouponState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

  // Pre-fill from URL params (namespace, name, coupon)
  useEffect(() => {
    const ns   = searchParams.get('namespace') as Namespace | null;
    const name = searchParams.get('name') ?? '';
    const cpn  = searchParams.get('coupon') ?? '';
    if (ns && NAMESPACES.find(n => n.key === ns)) setSelected(ns);
    if (name) setAgentName(name.toLowerCase().replace(/[^a-z0-9-]/g, ''));
    if (cpn) {
      setCouponCode(cpn.toUpperCase());
      fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cpn.toUpperCase(), tld: ns ? `${ns}.gno` : 'nftmail.gno' }),
      }).then(r => r.json()).then((d: { valid: boolean }) => {
        setCouponState(d.valid ? 'valid' : 'invalid');
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ns = NAMESPACES.find(n => n.key === selected)!;

  const checkAvailability = useCallback(async () => {
    if (!agentName || agentName.length < 2) return;
    setCheckStatus('checking');
    setCheckResult(null);
    try {
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
  }, [agentName, ns.domain, connectedWallet]);

  const genomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setAgentName(cleaned);
    setCheckStatus('idle');
    setCheckResult(null);
    // Debounce genome metadata init to avoid lag on every keystroke
    if (genomeTimerRef.current) clearTimeout(genomeTimerRef.current);
    genomeTimerRef.current = setTimeout(() => {
      setGenomeMeta(cleaned ? defaultGenomeMetadata(cleaned, selected) : null);
    }, 400);
  }

  async function checkCoupon(code: string) {
    if (!code.trim()) { setCouponState('idle'); return; }
    setCouponState('checking');
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase(), tld: ns.domain }),
      });
      const data = await res.json() as { valid: boolean };
      setCouponState(data.valid ? 'valid' : 'invalid');
    } catch {
      setCouponState('invalid');
    }
  }

  const fullName = agentName ? `${agentName}.${ns.domain}` : '';
  const isFree = ns.mintFee === 'free' || couponState === 'valid';

  return (
    <div className="space-y-6">

      {/* ── SELECT NAMESPACE ── */}
      <div className="space-y-3">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">SELECT NAMESPACE</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAMESPACES.map((n) => {
            const isSelected = selected === n.key;
            const nsC = NS_COLOR[n.domain] ?? NS_COLOR['agent.gno'];
            const tierIcon = LIFECYCLE_ICONS[n.tier];
            return (
              <button
                key={n.key}
                onClick={() => { setSelected(n.key); setCheckStatus('idle'); setCheckResult(null); }}
                className={`group relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? `${nsC.selectedBorder} ${nsC.selectedBg}`
                    : `${nsC.border} ${nsC.bg} hover:${nsC.selectedBorder}`
                }`}
              >
                {/* Top row: domain name + tier badge + mint fee */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-lg font-bold transition-colors ${nsC.text}`}>
                    {n.domain}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Privacy icon */}
                    <span className="text-[10px]">
                      {n.privacyDefault === 'private' ? '🔒' : '⬜'}
                    </span>
                    {/* Lifecycle tier badge with icon */}
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300 ring-1 ring-amber-500/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={tierIcon} alt={n.tier} className="h-3.5 w-3.5 object-contain" />
                      {n.tier.charAt(0).toUpperCase() + n.tier.slice(1)}
                    </span>
                    {/* Tier label (Can Molt / Larva-only / etc.) */}
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${
                      n.tierLabel.includes('Molt') || n.tierLabel.includes('Cycle')
                        ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20'
                        : 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20'
                    }`}>
                      {(n.tierLabel.includes('Molt') || n.tierLabel.includes('Cycle')) ? '↑ ' : ''}{n.tierLabel}
                    </span>
                    {/* Mint fee */}
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
        <p className="text-[11px] text-[var(--muted)]">
          Use <span className="font-semibold text-[#f4b55a]">$HOST</span> to add features or increase capacity — extend email history, unlock marketplace listing, boost agent reputation.
        </p>
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

        {/* Name preview panel */}
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

              {/* Availability status */}
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
                Molt-to: <span className="font-semibold text-[#f2eee4]">{ns.moltToFee !== null ? `${ns.moltToFee} xDAI` : 'N/A'}</span>
                {ns.moltToFeeFromNftmail ? <> <span className="text-zinc-500">({ns.moltToFeeFromNftmail} xDAI from nftmail.gno)</span></> : null}
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
                Molt path: <span className="font-semibold text-violet-300">{ns.moltPath ?? '—'}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Vault fork: Imago vs Ghost ── */}
      {selected === 'vault' && (
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">FORK IN THE ROAD</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => setVaultPath('imago')}
              className={`group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                vaultPath === 'imago'
                  ? 'border-violet-400/50 bg-violet-500/10'
                  : 'border-violet-500/20 bg-violet-500/5 hover:border-violet-400/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-violet-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={LIFECYCLE_ICONS.imago} alt="Imago" className="h-5 w-5 object-contain" />
                  Option A — Molt Path
                </span>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">24 xDAI/yr</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Cycle to <span className="text-[#f2eee4] font-medium">Imago</span>. GhostAgent hosts the brain. Fully transferable NFT — list on marketplace, rehome to a new owner.
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['Transferable NFT', 'Cloud-hosted', 'Marketplace eligible', '24 xDAI/yr'].map(b => (
                  <span key={b} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium text-[var(--muted)] ring-1 ring-white/[0.08]">{b}</span>
                ))}
              </div>
              {vaultPath === 'imago' && <span className="absolute right-3 top-3 text-[10px] font-bold text-violet-400">✓ Selected</span>}
            </button>

            <button
              onClick={() => setVaultPath('ghost')}
              className={`group relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                vaultPath === 'ghost'
                  ? 'border-fuchsia-400/50 bg-fuchsia-500/10'
                  : 'border-fuchsia-500/20 bg-fuchsia-500/5 hover:border-fuchsia-400/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fuchsia-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={LIFECYCLE_ICONS.ghost} alt="Ghost" className="h-5 w-5 object-contain" />
                  Option B — Ghost Path
                </span>
                <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-300 ring-1 ring-fuchsia-500/20">200 xDAI lifetime</span>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Drop the <span className="text-[#f2eee4] font-medium">Eternal Anchor</span>. You host the brain locally via Ollama or LM Studio. Soulbound token — permanently bound to your wallet.
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['Soulbound (ERC-5192)', 'Local brain (Ollama/MCP)', 'Arweave archive', 'Not transferable'].map(b => (
                  <span key={b} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] font-medium text-[var(--muted)] ring-1 ring-white/[0.08]">{b}</span>
                ))}
              </div>
              {vaultPath === 'ghost' && <span className="absolute right-3 top-3 text-[10px] font-bold text-fuchsia-400">✓ Selected</span>}
            </button>
          </div>

          {vaultPath === 'ghost' && (
            <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3">
              <p className="text-xs text-fuchsia-300 leading-relaxed">
                <span className="font-semibold">⚠ Ghost Path requires local compute.</span>{' '}
                Your agent will be a gateway to hardware you own and maintain. If your local LLM goes offline, your agent goes offline.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Genome NFT Editor ── */}
      {agentName.length >= 2 && (
        <GenomeEditor
          agentName={agentName}
          sld={selected}
          value={genomeMeta}
          onChange={setGenomeMeta}
          showDescription={false}
        />
      )}

      {/* ── Coupon code ── */}
      {agentName.length >= 2 && ns.mintFee !== 'free' && (
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">
            COUPON CODE <span className="font-normal opacity-50">(optional)</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponState('idle'); }}
              onBlur={() => checkCoupon(couponCode)}
              placeholder="e.g. NFTFREE-XXXX"
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-mono text-[#f2eee4] outline-none placeholder:text-zinc-600 focus:border-[rgba(255,255,255,0.2)]"
            />
            <button
              type="button"
              onClick={() => checkCoupon(couponCode)}
              className="shrink-0 rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-xs font-semibold text-[var(--muted)] transition hover:text-white"
            >
              {couponState === 'checking' ? '…' : 'Apply'}
            </button>
          </div>
          {couponState === 'valid' && (
            <p className="text-xs text-emerald-400">✓ Coupon valid — free mint applied</p>
          )}
          {couponState === 'invalid' && (
            <p className="text-xs text-rose-400">Invalid or already used coupon</p>
          )}
        </div>
      )}

      {/* ── Terms ── */}
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
          <>
            {couponState === 'valid' && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-300">
                <span>✓</span>
                <span>Coupon <code className="font-mono">{couponCode}</code> — free mint applied</span>
              </div>
            )}
            <MintAgentBundle
              agentName={agentName}
              safeAddress={(connectedWallet ?? '0x0000000000000000000000000000000000000000') as `0x${string}`}
              namespace={selected}
              disabled={!termsAgreed}
              couponCode={couponState === 'valid' ? couponCode || undefined : undefined}
              mintFeeLabel={isFree ? undefined : feeLabel(ns.mintFee)}
            />
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">Enter an agent name above to continue.</p>
        )}
      </div>

      {/* ── Bottom features ── */}
      <div className="grid gap-6 sm:grid-cols-3">
        {[
          { title: 'Token-Bound Account', desc: 'Each NFT automatically deploys a TBA (ERC-6551) on Gnosis Chain — a smart account tied to your NFT.' },
          { title: 'Sovereign Identity', desc: 'Transfer the NFT = transfer the agent. No migration, no re-provisioning. Same TBA address forever.' },
          { title: 'IP Registration', desc: "Pro agents register on Story Protocol — your agent's work output is IP-protected by default." },
        ].map((f) => (
          <div key={f.title} className="space-y-2">
            <div className="text-sm font-semibold text-[#f2eee4]">{f.title}</div>
            <p className="text-xs text-[var(--muted)]">{f.desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}
