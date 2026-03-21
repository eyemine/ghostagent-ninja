'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const SLD_META: Record<string, { label: string; color: string; bg: string; ring: string }> = {
  molt:     { label: 'Molt',     color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', ring: 'ring-fuchsia-500/20' },
  vault:    { label: 'Vault',    color: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' },
  openclaw: { label: 'OpenClaw', color: 'text-cyan-300',    bg: 'bg-cyan-500/10',    ring: 'ring-cyan-500/20'    },
  picoclaw: { label: 'PicoClaw', color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/20'   },
  agent:    { label: 'Agent',    color: 'text-violet-300',  bg: 'bg-violet-500/10',  ring: 'ring-violet-500/20'  },
  nftmail:  { label: 'NFTmail',  color: 'text-rose-300',    bg: 'bg-rose-500/10',    ring: 'ring-rose-500/20'    },
};

const PRIVACY_META: Record<string, { icon: string; label: string; color: string }> = {
  glassbox:       { icon: '🔍', label: 'Glass Box',    color: 'text-sky-300' },
  private:        { icon: '🔒', label: 'Private',      color: 'text-violet-300' },
  'hard-privacy': { icon: '🛡️', label: 'Hard Privacy', color: 'text-fuchsia-300' },
  exposed:        { icon: '👁',  label: 'Public',       color: 'text-zinc-400' },
};

interface AgentCard {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  active: boolean;
  registrations: { agentId: number; agentRegistry: string }[];
}

interface AgentIdentity {
  exists: boolean;
  resolvedName: string;
  emailAddress: string;
  originNft: string | null;
  mintedTokenId: number | null;
  onChainOwner: string | null;
  tbaAddress: string | null;
  safe: string | null;
  accountTier: string;
  tld: string | null;
  privacyTier: string;
  moltPath: { currentLevel: string | null; surgeReputationScore: number | null } | null;
}

const TIER_LABEL: Record<string, string> = {
  basic:   'Larva',
  lite:    'Pupa',
  premium: 'Imago',
  ghost:   'Ghost',
};

function shortAddr(addr: string | null) {
  if (!addr) return '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

export default function AgentPublicProfilePage() {
  const { name } = useParams<{ name: string }>();
  const [card, setCard]       = useState<AgentCard | null>(null);
  const [identity, setIdent]  = useState<AgentIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    Promise.allSettled([
      fetch(`/api/agent-card?agent=${encodeURIComponent(name)}`).then(r => r.json()),
      fetch(`/api/agent-lookup?q=${encodeURIComponent(name)}`).then(r => r.json()),
    ]).then(([cardRes, identRes]) => {
      if (cardRes.status === 'fulfilled') setCard(cardRes.value as AgentCard);
      if (identRes.status === 'fulfilled') setIdent(identRes.value as AgentIdentity);
      setLoading(false);
    });
  }, [name]);

  // Derive SLD from card name e.g. "ghostagent.molt.gno" → "molt"
  const sldFromName = card?.name?.split('.')?.[1] ?? null;
  const sldMeta = SLD_META[sldFromName ?? ''] ?? SLD_META['nftmail'];
  const privacyMeta = PRIVACY_META[identity?.privacyTier ?? 'exposed'];
  const agentId = card?.registrations?.[0]?.agentId ?? null;
  const emailService = card?.services?.find(s => s.name === 'email');
  const a2aService   = card?.services?.find(s => s.name === 'A2A');
  const webService   = card?.services?.find(s => s.name === 'web');
  const imageUrl     = card?.image ?? null;

  // Chain label display helpers
  const CHAIN_LABELS: Record<string, string> = { gnosis: 'Gnosis', base: 'Base', baseSepolia: 'Base Sepolia' };
  const CHAIN_COLORS: Record<string, string> = {
    gnosis:      'text-violet-300 bg-violet-500/10 ring-violet-500/20',
    base:        'text-blue-300 bg-blue-500/10 ring-blue-500/20',
    baseSepolia: 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20',
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1000px_circle_at_20%_-10%,rgba(176,128,92,0.10),transparent_45%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-2xl px-4 py-12 md:px-6">

        <div className="mb-8">
          <Link href="/agents" className="text-[11px] text-[var(--muted)] transition hover:text-white">
            ← Agent Registry
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[rgba(176,128,92,0.3)] border-t-[rgba(176,128,92,0.9)]" />
          </div>
        ) : (
          <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-6 space-y-5">

            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/40 overflow-hidden">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                    <svg className="h-8 w-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="3"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <span className="text-[8px] font-semibold tracking-wider text-zinc-700 uppercase">NFT</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-[#f2eee4]">{name}</h1>
                  {sldFromName && (
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${sldMeta.color} ${sldMeta.bg} ${sldMeta.ring}`}>
                      .{sldFromName}.gno
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold ring-1 ring-current/20 ${privacyMeta.color}`}>
                    {privacyMeta.icon} {privacyMeta.label}
                  </span>
                  {card?.active && (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {card?.name ?? `${name}.gno`}
                  {emailService && <span className="ml-2 font-mono">{emailService.endpoint}</span>}
                </p>
                {card?.description && (
                  <p className="mt-2 text-[12px] text-[var(--muted)] leading-relaxed">{card.description}</p>
                )}
              </div>
            </div>

            <div className="h-px bg-[var(--border)]" />

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 text-center text-[11px]">
              {[
                { label: 'Surge Score', value: identity?.moltPath?.surgeReputationScore != null ? String(identity.moltPath.surgeReputationScore) : '—', color: 'text-violet-300' },
                { label: 'Tier',        value: TIER_LABEL[identity?.accountTier ?? ''] ?? identity?.accountTier ?? '—', color: 'text-[#f2eee4]' },
                { label: 'ERC-8004 ID', value: agentId != null ? `#${agentId}` : '—', color: 'text-amber-300' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/20 px-2.5 py-3">
                  <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{label}</div>
                  <div className={`mt-1 text-base font-medium ${color}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* Services */}
            {card?.services && card.services.length > 0 && (
              <div>
                <h2 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--muted)] mb-3">ENDPOINTS</h2>
                <div className="space-y-1.5">
                  {card.services.map((svc, i) => {
                    const isEmail = svc.name === 'email';
                    const isA2A   = svc.name === 'A2A';
                    const emailInbox = isEmail ? `https://nftmail.box/inbox/${name}_` : null;
                    const a2aUrl    = isA2A   ? `https://ghostagent.ninja/.well-known/agent.json` : null;
                    const href = emailInbox ?? a2aUrl ?? null;
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-[rgba(176,128,92,0.12)] bg-black/20 px-3 py-2">
                        <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)] shrink-0 w-14">{svc.name.toUpperCase()}</span>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-[10px] text-[rgba(176,128,92,0.8)] truncate flex-1 hover:underline">
                            {svc.endpoint}
                          </a>
                        ) : (
                          <span className="font-mono text-[10px] text-zinc-400 truncate flex-1">{svc.endpoint}</span>
                        )}
                        {svc.version && <span className="text-[9px] text-zinc-600 shrink-0">v{svc.version}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* On-chain */}
            <div>
              <h2 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--muted)] mb-3">ON-CHAIN IDENTITY</h2>
              <div className="space-y-2">
                {[
                  { label: 'NFT Origin', value: identity?.originNft ?? '—', href: null },
                  { label: 'TBA',        value: shortAddr(identity?.tbaAddress ?? null), href: identity?.tbaAddress ? `https://gnosisscan.io/address/${identity.tbaAddress}` : null },
                  { label: 'Safe',       value: identity?.safe ? shortAddr(identity.safe) : '—', href: identity?.safe ? `https://app.safe.global/home?safe=gno:${identity.safe}` : null },
                  { label: 'Owner',      value: shortAddr(identity?.onChainOwner ?? null), href: identity?.onChainOwner ? `https://gnosisscan.io/address/${identity.onChainOwner}` : null },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                    <span className="text-[var(--muted)] shrink-0 w-24">{row.label}</span>
                    {row.href ? (
                      <a href={row.href} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-[rgba(176,128,92,0.9)] truncate hover:underline">
                        {row.value} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-zinc-500 truncate">{row.value}</span>
                    )}
                  </div>
                ))}

                {/* ERC-8004 URI — one link per registered chain */}
                <div className="flex items-start justify-between gap-4 text-[11px]">
                  <span className="text-[var(--muted)] shrink-0 w-24">ERC-8004 URI</span>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {(card?.registrations ?? []).length === 0 ? (
                      <a href={`https://ghostagent.ninja/api/agent-card?agent=${name}`} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-[10px] text-[rgba(176,128,92,0.8)] hover:underline">
                        agent-card ↗
                      </a>
                    ) : (card?.registrations ?? []).map((reg) => {
                      const chainKey = reg.agentRegistry.includes(':100:') ? 'gnosis' : reg.agentRegistry.includes(':84532:') ? 'baseSepolia' : 'base';
                      const clr = CHAIN_COLORS[chainKey] ?? CHAIN_COLORS['base'];
                      const lbl = CHAIN_LABELS[chainKey] ?? chainKey;
                      const chainSlug = chainKey === 'gnosis' ? 'gnosis' : chainKey === 'baseSepolia' ? 'base-sepolia' : 'base';
                      const metaHref = `https://8004agents.ai/${chainSlug}/agent/${reg.agentId}#metadata`;
                      return (
                        <a key={reg.agentId}
                          href={metaHref}
                          target="_blank" rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 hover:brightness-125 ${clr}`}>
                          {lbl} #{reg.agentId} ↗
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-[var(--border)]" />

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[10px] text-[var(--muted)]">
                {identity?.emailAddress && (
                  <a
                    href={`https://nftmail.box/inbox/${name}_`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono hover:text-white transition">
                    {identity.emailAddress}
                  </a>
                )}
              </div>
              <div className="flex gap-2">
                <a href={`https://notapaperclip.red/a2a?agent=${encodeURIComponent(name)}`} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:text-white">
                  A2A Card ↗
                </a>
                <a href={`https://notapaperclip.red/erc8004?agent=${encodeURIComponent(name)}`} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg border px-4 py-1.5 text-xs font-semibold transition"
                  style={{ color: 'rgb(176,128,92)', borderColor: 'rgba(176,128,92,0.4)', background: 'rgba(176,128,92,0.1)' }}>
                  ERC-8004 ↗
                </a>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <a href="https://notapaperclip.red/handshakes" target="_blank" rel="noopener noreferrer"
            className="text-[11px] transition hover:text-white"
            style={{ fontFamily: "Ayuthaya, 'Courier New', monospace", color: '#888' }}>
            Handshake Telemetry ↗
          </a>
        </div>

      </div>
    </div>
  );
}
