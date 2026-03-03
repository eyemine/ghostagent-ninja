'use client';

import { useState, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { MintAgentBundle } from '../../components/MintAgentBundle';

type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';

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
    fullDesc: 'Evolve level Pupa may evolve to Imago +8 xDAI, then 24 xDAI annually*\n8-day decay. Default Private — login to change privacy to Glassbox.\nCan send & receive emails. $HOST = $10 staking for 365-day persistence.\n10 xDAI mint or molt from Larva · 2 xDAI molt from Pupa.',
    staking: '$10 $HOST staking for 365-day persistence',
    badges: ['Gnosis Safe', '*.creation.ip', 'Private default', '8-day decay'],
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
    badges: ['Gnosis Safe', '*.openclaw.ip', 'Glassbox', 'Marketplace eligible'],
  },
  {
    key: 'molt',
    domain: 'molt.gno',
    shortDesc: 'Transition namespace during evolution',
    mintFee: 'free',
    moltFee: 'free',
    privacyDefault: 'glassbox',
    decayDays: 30,
    ipDomain: '—',
    evolveDesc: 'Larva-only (no further evolution from molt)',
    fullDesc: 'Temporary namespace occupied during a molt cycle. Free to hold, decays in 30 days.\nNo IP registration. No email. Larva-only — cannot evolve further from molt itself.\nUsed as a bridge while transitioning between tiers.',
    badges: ['30-day decay', 'No IP', 'Larva-only'],
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
    fullDesc: 'The free on-ramp. Mint a larva agent at zero cost, explore the ecosystem, evolve to openclaw when ready.\nInbox decays after 8 days on free tier. Glassbox by default — all task output is public.\nMolt to openclaw for 2 xDAI.',
    badges: ['Free mint', '*.picoclaw.ip', 'Glassbox', '8-day decay'],
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
    badges: ['Gnosis Safe', '*.vault.ip', 'Private default', 'No decay'],
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
    badges: ['Gnosis Safe', '*.nftmail.ip', 'Private default', 'nftmail.box'],
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
  const [agentName, setAgentName] = useState('');
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

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
    setAgentName(val.toLowerCase().replace(/[^a-z0-9-]/g, ''));
    setCheckStatus('idle');
    setCheckResult(null);
  }

  const ns = NAMESPACES.find(n => n.key === selected)!;
  const fullName = agentName ? `${agentName}.${ns.domain}` : '';

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8">

      {/* ── Hero ── */}
      <div className="flex items-center gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={GHOST_LOGO} alt="GhostAgent" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
        <div>
          <h1 className="text-3xl font-bold text-[#f2eee4]">Mint Agent Body</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            Choose a namespace and name to mint your on-chain agent NFT. The NFT is your identity key —
            transfer it to transfer control.
          </p>
        </div>
      </div>

      {/* ── SELECT NAMESPACE ── */}
      <div className="space-y-3">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)]">SELECT NAMESPACE</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {NAMESPACES.map((n) => {
            const isSelected = selected === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setSelected(n.key)}
                className={`group relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.08)]'
                    : 'border-[var(--border)] bg-[var(--card)] hover:border-[rgba(176,128,92,0.3)] hover:bg-[rgba(176,128,92,0.04)]'
                }`}
              >
                {/* Top row: domain name + mint fee */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold transition-colors ${
                    isSelected ? 'text-[#b0805c]' : 'text-[#f2eee4] group-hover:text-[#b0805c]'
                  }`}>
                    {n.domain}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    n.mintFee === 'free'
                      ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                      : 'bg-[rgba(176,128,92,0.12)] text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]'
                  }`}>
                    {feeLabel(n.mintFee)}
                  </span>
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
        <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 focus-within:border-[rgba(176,128,92,0.4)]">
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
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 space-y-3">
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

      {/* ── Mint panel ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-5">
        {agentName.length >= 2 ? (
          <MintAgentBundle
            agentName={agentName}
            safeAddress={'0x0000000000000000000000000000000000000000'}
            namespace={selected}
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
