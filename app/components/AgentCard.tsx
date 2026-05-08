'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import XMTPBadge, { type XMTPBadgeVariant } from './XMTPBadge';
import SwarmModeBadge from './SwarmModeBadge';

type AgentTier = 'free' | 'pro';
type Namespace = 'agent' | 'openclaw' | 'molt' | 'picoclaw' | 'vault' | 'nftmail';
export type EvolveLevel = 'larva' | 'pupa' | 'imago' | 'ghost';
export type PrivacyStatus = 'glassbox' | 'private' | 'hard-privacy';

interface AgentCardProps {
  name: string;
  namespace: Namespace;
  safeAddress: string;
  tier: AgentTier;
  surgeScore?: number;
  inboxCount?: number;
  calendarCount?: number;
  lastHeartbeat?: number;
  ipDomain?: string;
  onUpgrade?: () => void;
  isMolting?: boolean;
  // Domain-specific attributes
  evolveLevel?: EvolveLevel;
  privacyStatus?: PrivacyStatus;
  decayDays?: 8 | 30 | 365 | null;
  ipType?: 'creation.ip' | 'moltbook.ip' | null;
  stakedHost?: number;
  marketplaceBadge?: string | null;
  xmtpEnabled?: boolean;
  swarmMemberCount?: number;
  swarmStrategy?: string;
  swarmHackathonTag?: string;
}

const NAMESPACE_META: Record<Namespace, { label: string; color: string; bgColor: string }> = {
  agent:    { label: 'agent.gno',    color: 'text-blue-300',   bgColor: 'bg-blue-500/10' },
  openclaw: { label: 'openclaw.gno', color: 'text-cyan-300',   bgColor: 'bg-cyan-500/10' },
  molt:     { label: 'molt.gno',     color: 'text-fuchsia-300', bgColor: 'bg-fuchsia-500/10' },
  picoclaw: { label: 'picoclaw.gno', color: 'text-amber-300',  bgColor: 'bg-amber-500/10' },
  vault:    { label: 'vault.gno',    color: 'text-emerald-300', bgColor: 'bg-emerald-500/10' },
  nftmail:  { label: 'nftmail.gno',  color: 'text-rose-300',    bgColor: 'bg-rose-500/10' },
};

function TierBadge({ tier, ipDomain }: { tier: AgentTier; ipDomain?: string }) {
  if (tier === 'pro') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          PRO
        </span>
        {ipDomain && (
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20">
            {ipDomain}
          </span>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs font-medium text-zinc-400 ring-1 ring-zinc-500/20">
      FREE
    </span>
  );
}

function HeartbeatDot({ lastHeartbeat }: { lastHeartbeat?: number }) {
  const isActive = lastHeartbeat
    ? (Date.now() - lastHeartbeat) < 24 * 60 * 60 * 1000
    : false;

  return (
    <span className="relative flex h-2.5 w-2.5">
      {isActive && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </span>
  );
}

const EVOLVE_META: Record<EvolveLevel, { icon: string; label: string; color: string; bg: string }> = {
  larva: { icon: 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreicekhu7rr7noqtv2t4sivy5mqncqgbqnf6cq63dfqyvi5klgk7bv4', label: 'Larva',  color: 'text-zinc-400',    bg: 'bg-zinc-500/10' },
  pupa:  { icon: 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreihajbm2nwtuwp4hsgputfqintlw7zxbz4jbpx772ur3rfvfhwadge', label: 'Pupa',   color: 'text-amber-300',   bg: 'bg-amber-500/10' },
  imago: { icon: 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u', label: 'Imago',  color: 'text-violet-300',  bg: 'bg-violet-500/10' },
  ghost: { icon: 'https://moccasin-useful-vole-840.mypinata.cloud/ipfs/bafkreiggfgwko2etlo4uxu65bou2cfv33awklo5m5zj7fypxwvfjp72xk4', label: 'Ghost',  color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10' },
};

const PRIVACY_META: Record<PrivacyStatus, { icon: string; label: string; color: string }> = {
  glassbox:    { icon: '🔍', label: 'Glass Box', color: 'text-sky-300' },
  private:     { icon: '🔒', label: 'Private',   color: 'text-violet-300' },
  'hard-privacy': { icon: '🛡', label: 'Hard Privacy', color: 'text-fuchsia-300' },
};

function DecayBadge({ days }: { days: 8 | 30 | 365 | null | undefined }) {
  if (!days) return null;
  const color = days === 365 ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20'
    : days === 30 ? 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20'
    : 'text-amber-300 bg-amber-500/10 ring-amber-500/20';
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ${color}`}>
      {days === 365 ? '365d' : days === 30 ? '30d' : '8d'} decay
    </span>
  );
}

export function AgentCard({
  name,
  namespace,
  safeAddress,
  tier,
  surgeScore = 0,
  inboxCount = 0,
  calendarCount = 0,
  lastHeartbeat,
  ipDomain,
  onUpgrade,
  isMolting = false,
  evolveLevel,
  privacyStatus,
  decayDays,
  ipType,
  stakedHost,
  marketplaceBadge,
  xmtpEnabled,
  swarmMemberCount = 0,
  swarmStrategy,
  swarmHackathonTag,
}: AgentCardProps) {
  const [moltPhase, setMoltPhase] = useState<'idle' | 'shedding' | 'emerging' | 'complete'>('idle');
  const nsMeta = NAMESPACE_META[namespace];
  const truncAddr = `${safeAddress.slice(0, 6)}...${safeAddress.slice(-4)}`;

  useEffect(() => {
    if (isMolting) {
      setMoltPhase('shedding');
      const t1 = setTimeout(() => setMoltPhase('emerging'), 800);
      const t2 = setTimeout(() => setMoltPhase('complete'), 1600);
      const t3 = setTimeout(() => setMoltPhase('idle'), 2400);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, [isMolting]);

  const xmtpVariant: XMTPBadgeVariant = namespace === 'picoclaw' ? 'picoclaw' : xmtpEnabled ? 'enabled' : 'disabled';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: moltPhase === 'shedding' ? 0.97 : moltPhase === 'emerging' ? 1.03 : 1,
      }}
      transition={{ duration: 0.4, type: 'spring', stiffness: 200 }}
      className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
    >
      {/* Molt shimmer layers */}
      <AnimatePresence>
        {moltPhase === 'shedding' && (
          <motion.div
            key="shed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.25 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 bg-gradient-to-r from-zinc-500/20 via-transparent to-zinc-500/20"
          />
        )}
        {moltPhase === 'emerging' && (
          <motion.div
            key="emerge"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 0.3, scale: 1.05 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/15 to-cyan-500/20"
          />
        )}
        {moltPhase === 'complete' && (
          <motion.div
            key="glow"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent"
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <HeartbeatDot lastHeartbeat={lastHeartbeat} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-[#f2eee4]">{name}</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${nsMeta.color} ${nsMeta.bgColor}`}>
                {nsMeta.label}
              </span>
            </div>
            <code className="mt-0.5 block text-xs text-[var(--muted)]">{truncAddr}</code>
          </div>
        </div>
        <TierBadge tier={tier} ipDomain={ipDomain} />
      </div>

      {/* Domain attribute badges */}
      {(evolveLevel || privacyStatus || decayDays || ipType || (stakedHost && stakedHost > 0) || marketplaceBadge) && (
        <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
          {evolveLevel && (() => {
            const m = EVOLVE_META[evolveLevel];
            return (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${m.color} ${m.bg} ring-current/20`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.icon} alt={m.label} className="h-3 w-3 object-contain" />
                {m.label}
              </span>
            );
          })()}
          {privacyStatus && (() => {
            const m = PRIVACY_META[privacyStatus];
            return (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${m.color} bg-white/[0.04] ring-current/20`}>
                {m.icon} {m.label}
              </span>
            );
          })()}
          <DecayBadge days={decayDays} />
          {ipType && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
              ✦ {ipType}
            </span>
          )}
          {stakedHost != null && stakedHost > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
              {stakedHost >= 1000 ? `${(stakedHost / 1000).toFixed(1)}K` : stakedHost} $HOST staked
            </span>
          )}
          {marketplaceBadge && (
            <span className="inline-flex items-center rounded-full bg-[rgba(176,128,92,0.12)] px-2 py-0.5 text-[9px] font-semibold text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]">
              {marketplaceBadge}
            </span>
          )}
          <XMTPBadge variant={xmtpVariant} />
          <SwarmModeBadge memberCount={swarmMemberCount} strategy={swarmStrategy} hackathonTag={swarmHackathonTag} />
        </div>
      )}

      {/* Stats row */}
      <div className="relative mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">$HOST</div>
          <div className="mt-0.5 text-sm font-medium text-violet-300">{surgeScore.toFixed(1)}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INBOX</div>
          <div className="mt-0.5 text-sm font-medium text-[#f2eee4]">{inboxCount}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EVENTS</div>
          <div className="mt-0.5 text-sm font-medium text-[#f2eee4]">{calendarCount}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="relative mt-4 flex items-center gap-2">
        {tier === 'free' && onUpgrade && (
          <button
            onClick={onUpgrade}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:shadow-violet-500/40"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M2 12h20" />
            </svg>
            Molt
          </button>
        )}
        <Link
          href={`/dashboard/agent/${name}`}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs text-[var(--muted)] transition hover:bg-white/5 hover:text-white"
        >
          View Details →
        </Link>
      </div>

      {/* Inbox decay warning for free tier */}
      {tier === 'free' && (
        <div className="relative mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <svg className="h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-[10px] text-amber-300/80">
            Free tier — 8-day history window. Molt for persistent storage + IP protection.
          </span>
        </div>
      )}
    </motion.div>
  );
}
