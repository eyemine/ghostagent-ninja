'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const SLD_META: Record<string, { color: string; bg: string; ring: string }> = {
  molt:     { color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', ring: 'ring-fuchsia-500/20' },
  vault:    { color: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' },
  openclaw: { color: 'text-cyan-300',    bg: 'bg-cyan-500/10',    ring: 'ring-cyan-500/20'    },
  picoclaw: { color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20'   },
  agent:    { color: 'text-violet-300',  bg: 'bg-violet-500/10',  ring: 'ring-violet-500/20'  },
  nftmail:  { color: 'text-rose-300',    bg: 'bg-rose-500/10',    ring: 'ring-rose-500/20'    },
};

const TIER_LABEL: Record<string, string> = {
  basic: 'Basic', lite: 'Lite', premium: 'Premium', ghost: 'Ghost',
};

const PRIVACY_META: Record<string, { icon: string; label: string; color: string }> = {
  glassbox:       { icon: '🔍', label: 'Glass Box',    color: 'text-sky-300' },
  private:        { icon: '🔒', label: 'Private',      color: 'text-violet-300' },
  'hard-privacy': { icon: '🛡️', label: 'Hard Privacy', color: 'text-fuchsia-300' },
  exposed:        { icon: '👁',  label: 'Public',       color: 'text-zinc-400' },
};

interface AgentCard {
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  active: boolean;
  registrations: { agentId: number; agentRegistry: string }[];
}

interface AgentIdentity {
  onChainOwner: string | null;
  tbaAddress: string | null;
  safe: string | null;
  accountTier: string;
  privacyTier: string;
  emailAddress: string;
  moltPath: { surgeReputationScore: number | null } | null;
}

function shortAddr(addr: string | null) {
  if (!addr) return '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

export default function EmbedAgentPanel() {
  const { name } = useParams<{ name: string }>();
  const [card, setCard]       = useState<AgentCard | null>(null);
  const [identity, setIdent]  = useState<AgentIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) return;
    Promise.allSettled([
      fetch(`/api/agent-card?agent=${encodeURIComponent(name)}`).then(r => r.json()),
      fetch(`/api/agent-lookup?q=${encodeURIComponent(name)}`).then(r => r.json()),
    ]).then(([cardRes, identRes]) => {
      if (cardRes.status === 'fulfilled') setCard(cardRes.value as AgentCard);
      if (identRes.status === 'fulfilled') setIdent(identRes.value as AgentIdentity);
      setLoading(false);
    });
  }, [name]);

  const sldFromName  = card?.name?.split('.')?.[1] ?? null;
  const sldMeta      = SLD_META[sldFromName ?? ''] ?? SLD_META['nftmail'];
  const privacyMeta  = PRIVACY_META[identity?.privacyTier ?? 'exposed'];
  const agentId      = card?.registrations?.[0]?.agentId ?? null;
  const emailService = card?.services?.find(s => s.name === 'email');
  const imageUrl     = card?.image ?? null;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(176,128,92,0.3)] border-t-[rgba(176,128,92,0.8)]" />
      </div>
    );
  }

  if (!card && !identity) {
    return (
      <div className="flex h-screen items-center justify-center bg-transparent">
        <p className="text-xs text-zinc-500">Agent not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080b12] p-3">
      <div className="rounded-xl border border-[rgba(176,128,92,0.3)] bg-[rgba(255,255,255,0.025)] p-4 space-y-3.5">

        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="h-14 w-14 shrink-0 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/40 overflow-hidden">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg className="h-6 w-6 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1 mb-0.5">
              <span className="text-sm font-bold text-[#f2eee4]">{name}</span>
              {sldFromName && (
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-semibold ring-1 ${sldMeta.color} ${sldMeta.bg} ${sldMeta.ring}`}>
                  .{sldFromName}.gno
                </span>
              )}
              <span className={`inline-flex items-center gap-0.5 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[8px] font-semibold ring-1 ring-current/20 ${privacyMeta.color}`}>
                {privacyMeta.icon} {privacyMeta.label}
              </span>
              {card?.active && (
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                  Active
                </span>
              )}
            </div>
            {emailService && (
              <p className="font-mono text-[10px] text-zinc-500 truncate">{emailService.endpoint}</p>
            )}
            {card?.description && (
              <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed line-clamp-2">{card.description}</p>
            )}
          </div>
        </div>

        <div className="h-px bg-[rgba(176,128,92,0.1)]" />

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            { label: 'Surge', value: identity?.moltPath?.surgeReputationScore != null ? String(identity.moltPath.surgeReputationScore) : '—', color: 'text-violet-300' },
            { label: 'Tier',  value: TIER_LABEL[identity?.accountTier ?? ''] ?? identity?.accountTier ?? '—', color: 'text-[#f2eee4]' },
            { label: 'ID',    value: agentId != null ? `#${agentId}` : '—', color: 'text-amber-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.12)] bg-black/20 px-1.5 py-2">
              <div className="text-[7px] font-semibold tracking-wider text-zinc-600 uppercase">{label}</div>
              <div className={`mt-0.5 text-xs font-semibold ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* On-chain identity */}
        <div className="space-y-1">
          {[
            { label: 'TBA',   value: shortAddr(identity?.tbaAddress ?? null), href: identity?.tbaAddress ? `https://gnosisscan.io/address/${identity.tbaAddress}` : null },
            { label: 'Safe',  value: identity?.safe ? shortAddr(identity.safe) : '—',  href: identity?.safe ? `https://app.safe.global/home?safe=gno:${identity.safe}` : null },
            { label: 'Owner', value: shortAddr(identity?.onChainOwner ?? null),         href: identity?.onChainOwner ? `https://gnosisscan.io/address/${identity.onChainOwner}` : null },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-600 w-9 shrink-0">{row.label}</span>
              {row.href ? (
                <a href={row.href} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[rgba(176,128,92,0.75)] hover:text-[rgba(176,128,92,1)] transition truncate">
                  {row.value} ↗
                </a>
              ) : (
                <span className="font-mono text-zinc-600 truncate">{row.value}</span>
              )}
            </div>
          ))}
        </div>

        <div className="h-px bg-[rgba(176,128,92,0.1)]" />

        {/* Footer */}
        <div className="flex items-center justify-between">
          <a
            href={`https://ghostagent.ninja/agent/${name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[rgba(176,128,92,0.6)] hover:text-[rgba(176,128,92,1)] transition"
          >
            Full profile ↗
          </a>
          <span className="text-[8px] font-semibold tracking-[0.15em] text-zinc-700 uppercase">GhostAgent Protocol</span>
        </div>

      </div>
    </div>
  );
}
