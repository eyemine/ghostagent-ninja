'use client';

/**
 * AgentIdentityCard
 * Reverse-lookup UI card: given an agent name / email, shows the full
 * on-chain identity graph (NFT → TBA → Safe → Story IP → tier → molt path).
 *
 * Usage (standalone search tool):
 *   <AgentIdentityCard />          — shows search input
 *
 * Usage (pre-populated, e.g. from dashboard):
 *   <AgentIdentityCard name="ghostagent" />
 */

import { useState, useEffect } from 'react';
import type { AgentIdentityGraph } from '../api/agent-lookup/route';

interface AgentIdentityCardProps {
  name?: string;   // pre-populate and auto-fetch
}

const TIER_COLOR: Record<string, string> = {
  basic:   'text-[var(--muted)]',
  lite:    'text-sky-300',
  premium: 'text-violet-300',
  ghost:   'text-fuchsia-300',
};

const TIER_LABEL: Record<string, string> = {
  basic:   'Basic',
  lite:    'Lite',
  premium: 'PRO',
  ghost:   'Ghost',
};

const PRIVACY_COLOR: Record<string, string> = {
  exposed:      'text-emerald-300',
  private:      'text-amber-300',
  'hard-privacy': 'text-red-400',
};

function truncateAddr(addr: string | null, chars = 8): string {
  if (!addr) return '—';
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1.5 text-[9px] text-[var(--muted)] hover:text-[#f2eee4] transition-colors shrink-0"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Row({ label, value, mono = false, color, copyValue, link }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  color?: string;
  copyValue?: string;
  link?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[rgba(176,128,92,0.1)] last:border-0">
      <span className="shrink-0 text-[10px] text-[var(--muted)] w-32">{label}</span>
      <div className={`flex items-center gap-1 min-w-0 flex-1 justify-end ${mono ? 'font-mono' : ''} ${color ?? 'text-[#f2eee4]'} text-[11px] text-right break-all`}>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
            {value}
          </a>
        ) : (
          <span>{value}</span>
        )}
        {copyValue && <CopyBtn text={copyValue} />}
      </div>
    </div>
  );
}

export function AgentIdentityCard({ name: initialName }: AgentIdentityCardProps) {
  const [query, setQuery] = useState(initialName ?? '');
  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState<AgentIdentityGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setGraph(null);
    try {
      const res = await fetch(`/api/agent-lookup?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json() as AgentIdentityGraph & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? 'Lookup failed');
      } else {
        setGraph(data);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch if name pre-populated
  useEffect(() => {
    if (initialName) lookup(initialName);
  }, [initialName]); // eslint-disable-line react-hooks/exhaustive-deps

  const gnosis = 'https://gnosisscan.io/address/';
  const ipfsGw = 'https://gateway.lighthouse.storage/ipfs/';

  return (
    <div className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] overflow-hidden">

      {/* ── Header / Search ── */}
      <div className="px-5 py-4 border-b border-[rgba(176,128,92,0.2)]">
        <div className="text-xs font-semibold tracking-[0.18em] text-[var(--muted)] mb-3">
          AGENT IDENTITY LOOKUP
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup(query)}
            placeholder="ghostagent_ or ghostagent_@nftmail.box"
            className="flex-1 rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] outline-none placeholder:text-[var(--muted)] focus:border-[rgba(176,128,92,0.45)] transition-colors font-mono"
          />
          <button
            type="button"
            onClick={() => lookup(query)}
            disabled={loading || !query.trim()}
            className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.4)] bg-[rgba(176,128,92,0.1)] px-4 py-2 text-xs font-semibold text-[#b0805c] hover:bg-[rgba(176,128,92,0.18)] transition-colors disabled:opacity-40"
          >
            {loading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/>
              </svg>
            ) : 'Lookup'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="px-5 py-3 text-xs text-red-400 border-b border-[rgba(176,128,92,0.1)]">
          ✗ {error}
        </div>
      )}

      {/* ── Not found / availability ── */}
      {graph && !graph.exists && (
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400/60" />
            <span className="text-xs text-amber-300 font-semibold">Not registered</span>
          </div>
          <p className="text-xs text-[var(--muted)]">
            <span className="font-mono text-[#f2eee4]">{graph.emailAddress}</span> has not been minted yet.
          </p>
          {graph.availability && (
            <p className="text-[10px] text-[var(--muted)]">{graph.availability.message}</p>
          )}
        </div>
      )}

      {/* ── Identity graph ── */}
      {graph && graph.exists && (
        <div className="px-5 py-4 space-y-5">

          {/* Status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-300 font-semibold">Registered</span>
            </div>
            <span className={`text-xs font-semibold ${TIER_COLOR[graph.accountTier] ?? 'text-[var(--muted)]'}`}>
              {TIER_LABEL[graph.accountTier] ?? graph.accountTier} tier
            </span>
            {graph.isPublic && (
              <span className="rounded-full border border-sky-500/30 bg-sky-500/5 px-2 py-0.5 text-[9px] font-semibold text-sky-300">
                🔍 Glassbox
              </span>
            )}
            <span className={`text-[10px] ${PRIVACY_COLOR[graph.privacyTier] ?? ''}`}>
              {graph.privacyTier === 'exposed' ? '◎ Exposed' : graph.privacyTier === 'private' ? '⊙ Private' : '⊘ Hard-Privacy'}
            </span>
          </div>

          {/* ── Email identity ── */}
          <div>
            <div className="mb-1.5 text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">EMAIL IDENTITY</div>
            <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2 space-y-0">
              <Row label="Agent email" value={graph.emailAddress} mono copyValue={graph.emailAddress} />
              <Row label="Namespace" value={graph.tld ?? '—'} mono color="text-violet-300" />
              {graph.collection && (
                <Row label="Collection" value={`${graph.collection} #${graph.tokenId}`} color="text-cyan-300" />
              )}
            </div>
          </div>

          {/* ── On-chain NFT ── */}
          <div>
            <div className="mb-1.5 text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">ON-CHAIN NFT</div>
            <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2 space-y-0">
              <Row
                label="Origin NFT"
                value={graph.originNft ?? '—'}
                mono
                color="text-[#b0805c]"
                copyValue={graph.originNft ?? undefined}
              />
              {graph.mintedTokenId != null && (
                <Row label="Token ID" value={`#${graph.mintedTokenId}`} mono />
              )}
              <Row
                label="NFT Owner (EOA)"
                value={truncateAddr(graph.onChainOwner)}
                mono
                color="text-amber-300"
                copyValue={graph.onChainOwner ?? undefined}
                link={graph.onChainOwner ? `${gnosis}${graph.onChainOwner}` : undefined}
              />
            </div>
          </div>

          {/* ── Smart accounts ── */}
          <div>
            <div className="mb-1.5 text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">SMART ACCOUNTS</div>
            <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2 space-y-0">
              <Row
                label="ERC-6551 TBA"
                value={graph.tbaAddress ? truncateAddr(graph.tbaAddress) : '—'}
                mono
                color={graph.tbaAddress ? 'text-sky-300' : 'text-[var(--muted)]'}
                copyValue={graph.tbaAddress ?? undefined}
                link={graph.tbaAddress ? `${gnosis}${graph.tbaAddress}` : undefined}
              />
              <Row
                label="Gnosis Safe"
                value={graph.safe ? truncateAddr(graph.safe) : '—'}
                mono
                color={graph.safe ? 'text-emerald-300' : 'text-[var(--muted)]'}
                copyValue={graph.safe ?? undefined}
                link={graph.safe ? `${gnosis}${graph.safe}` : undefined}
              />
              <Row
                label="Story IP"
                value={graph.storyIp ?? '—'}
                mono
                color={graph.storyIp ? 'text-fuchsia-300' : 'text-[var(--muted)]'}
                copyValue={graph.storyIp ?? undefined}
              />
              <Row
                label="Can Send"
                value={graph.canSend ? 'Yes' : 'No (Basic tier)'}
                color={graph.canSend ? 'text-emerald-300' : 'text-[var(--muted)]'}
              />
              {graph.expiresAt && (
                <Row
                  label="Expires"
                  value={new Date(graph.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  color={graph.expiresAt < Date.now() ? 'text-red-400' : 'text-[var(--muted)]'}
                />
              )}
            </div>
          </div>

          {/* ── IPFS Beacon ── */}
          {graph.beaconCid && (
            <div>
              <div className="mb-1.5 text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">IPFS BEACON METADATA</div>
              <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2 space-y-0">
                <Row
                  label="CID"
                  value={truncateAddr(graph.beaconCid, 10)}
                  mono
                  color="text-sky-300"
                  copyValue={graph.beaconCid}
                  link={`${ipfsGw}${graph.beaconCid}`}
                />
              </div>
            </div>
          )}

          {/* ── Molt path ── */}
          {graph.moltPath && (
            <div>
              <div className="mb-1.5 text-[9px] font-semibold tracking-[0.15em] text-[var(--muted)]">MOLT PATH</div>
              <div className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/20 px-4 py-2 space-y-0">
                <Row label="Level" value={graph.moltPath.currentLevel ?? '—'} color="text-violet-300" />
                <Row
                  label="Total xDAI Burned"
                  value={graph.moltPath.totalXdaiBurned != null ? `${graph.moltPath.totalXdaiBurned} xDAI` : '—'}
                  color="text-amber-300"
                />
                <Row
                  label="Surge Score"
                  value={graph.moltPath.surgeReputationScore != null ? graph.moltPath.surgeReputationScore.toString() : '—'}
                  color="text-fuchsia-300"
                />
                <Row
                  label="Molt Events"
                  value={graph.moltPath.evolutionHistoryLength != null ? graph.moltPath.evolutionHistoryLength.toString() : '—'}
                />
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Empty state ── */}
      {!graph && !loading && !error && (
        <div className="px-5 py-6 text-center text-xs text-[var(--muted)]">
          Enter an agent email or name to look up its on-chain identity.
        </div>
      )}

    </div>
  );
}
