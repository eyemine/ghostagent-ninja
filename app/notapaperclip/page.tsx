'use client';

/**
 * notapaperclip.red — Swarm Verification Portal
 *
 * Search by swarm ID to view:
 *   - Swarm members + active status
 *   - Paperclip TEE attestations (Glass Box proofs)
 *   - ERC-8004 reputation scores
 *   - 'Verified Swarm ✓' badge
 */

import { useState } from 'react';

interface Member {
  address:   string;
  agentName: string;
  joinedAt:  number;
}

interface Attestation {
  proofHash:  string;
  taskId:     string;
  agentName:  string;
  notaRef?:   string;
  notaUrl?:   string;
  verified:   boolean;
  timestamp:  number;
}

interface VerifyResult {
  swarmId:       string;
  verified:      boolean;
  fullyVerified: boolean;
  badge:         string;
  criteria: {
    hasMinMembers:     boolean;
    hasVerifiedProof:  boolean;
    allMembersHaveRep: boolean;
  };
  memberCount:    number;
  members:        Member[];
  attestations:   Attestation[];
  verifiedProofs: number;
  reputation:     Record<string, Array<{ paperclipScore: number; timestamp: number }>>;
  checkedAt:      number;
}

type SearchStatus = 'idle' | 'searching' | 'found' | 'notfound' | 'error';

function ShieldIcon({ verified }: { verified: boolean }) {
  return verified ? (
    <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <path d="m9 12 2 2 4-4"/>
    </svg>
  ) : (
    <svg className="h-5 w-5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function CriteriaRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
        met ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-500/20 text-zinc-500'
      }`}>
        {met ? '✓' : '·'}
      </span>
      <span className={met ? 'text-[#f2eee4]' : 'text-[var(--muted)]'}>{label}</span>
    </div>
  );
}

function ts(ms: number) {
  return new Date(ms).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
}

export default function NotapaperclipPage() {
  const [query, setQuery]       = useState('');
  const [status, setStatus]     = useState<SearchStatus>('idle');
  const [result, setResult]     = useState<VerifyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function search() {
    const id = query.trim().toLowerCase();
    if (!id) return;
    setStatus('searching');
    setResult(null);
    setErrorMsg('');

    try {
      const res  = await fetch(`/api/verify/swarm?swarmId=${encodeURIComponent(id)}`);
      const data = await res.json() as VerifyResult & { error?: string };

      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        setStatus('error');
        return;
      }

      if (data.memberCount === 0 && data.attestations.length === 0) {
        setStatus('notfound');
        return;
      }

      setResult(data);
      setStatus('found');
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen bg-[#0e0e0e] text-[#f2eee4]">
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">

        {/* ── Header ── */}
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <svg className="h-7 w-7 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            <h1 className="text-2xl font-bold tracking-tight">notapaperclip.red</h1>
          </div>
          <p className="text-sm text-zinc-400">
            Swarm verification portal — search a swarm ID to view TEE attestations, Glass Box proofs, and ERC-8004 reputation.
          </p>
        </div>

        {/* ── Search bar ── */}
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setStatus('idle'); }}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Enter swarm ID, e.g. ghost-alpha"
            className="flex-1 rounded-xl border border-violet-500/20 bg-white/[0.03] px-4 py-3 text-sm text-[#f2eee4] outline-none placeholder:text-zinc-600 focus:border-violet-500/50"
          />
          <button
            onClick={search}
            disabled={!query.trim() || status === 'searching'}
            className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-5 py-3 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40"
          >
            {status === 'searching' ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4"/></svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            )}
            Verify
          </button>
        </div>

        {/* ── States ── */}
        {status === 'error' && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {errorMsg}
          </div>
        )}

        {status === 'notfound' && (
          <div className="rounded-xl border border-zinc-700/40 bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-500">
            No swarm found for <span className="font-mono text-zinc-300">{query}</span>
          </div>
        )}

        {status === 'found' && result && (
          <div className="space-y-5">

            {/* ── Verified badge ── */}
            <div className={`flex items-center gap-4 rounded-2xl border px-5 py-4 ${
              result.fullyVerified
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : result.verified
                  ? 'border-violet-500/30 bg-violet-500/5'
                  : 'border-zinc-700/40 bg-white/[0.02]'
            }`}>
              <ShieldIcon verified={result.verified} />
              <div className="flex-1">
                <div className={`text-sm font-bold ${
                  result.fullyVerified ? 'text-emerald-300'
                  : result.verified    ? 'text-violet-300'
                  : 'text-zinc-400'
                }`}>
                  {result.badge}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  swarm: <span className="font-mono text-zinc-300">{result.swarmId}</span>
                  {' · '}checked {ts(result.checkedAt)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-zinc-500">members</div>
                <div className="text-lg font-bold text-[#f2eee4]">{result.memberCount}</div>
              </div>
            </div>

            {/* ── Criteria ── */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 space-y-2">
              <div className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500 mb-2">VERIFICATION CRITERIA</div>
              <CriteriaRow label={`≥ 2 active members (${result.memberCount} present)`} met={result.criteria.hasMinMembers} />
              <CriteriaRow label={`≥ 1 Paperclip attestation (${result.attestations.length} submitted, ${result.verifiedProofs} verified)`} met={result.criteria.hasVerifiedProof} />
              <CriteriaRow label="All members have ERC-8004 reputation" met={result.criteria.allMembersHaveRep} />
            </div>

            {/* ── Members ── */}
            {result.members.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06]">
                  <span className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500">SWARM MEMBERS</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {result.members.map((m, i) => {
                    const repKey = m.agentName?.toLowerCase() ?? m.address?.toLowerCase();
                    const repHistory = result.reputation[repKey];
                    const latestScore = repHistory?.[repHistory.length - 1]?.paperclipScore;
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-xs font-bold text-violet-300">
                          {(m.agentName || m.address).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#f2eee4] truncate">
                            {m.agentName || m.address}
                          </div>
                          {m.address && m.agentName && (
                            <div className="text-[10px] text-zinc-500 font-mono truncate">{m.address}</div>
                          )}
                        </div>
                        {latestScore !== undefined && (
                          <div className="shrink-0 text-right">
                            <div className="text-[9px] text-zinc-500">rep score</div>
                            <div className={`text-sm font-bold ${latestScore >= 700 ? 'text-emerald-400' : latestScore >= 400 ? 'text-amber-400' : 'text-red-400'}`}>
                              {Math.round(latestScore * 0.847)}/1000
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Attestations ── */}
            {result.attestations.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500">PAPERCLIP ATTESTATIONS</span>
                  <span className="text-[9px] text-zinc-600">{result.attestations.length} total · {result.verifiedProofs} verified</span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {result.attestations.slice(-5).reverse().map((a, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold ${
                        a.verified
                          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20'
                          : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20'
                      }`}>
                        {a.verified ? 'VERIFIED' : 'PENDING'}
                      </span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="text-xs text-zinc-300 truncate">
                          {a.agentName}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-[10px] text-violet-300 font-mono">
                            {a.proofHash ? a.proofHash.slice(0, 20) + '…' : '—'}
                          </code>
                          {(a.notaUrl || a.proofHash) && (
                            <a
                              href={a.notaUrl ?? `https://notapaperclip.red/verify/${a.proofHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-violet-500 hover:text-violet-300 transition"
                            >
                              view proof ↗
                            </a>
                          )}
                        </div>
                        <div className="text-[9px] text-zinc-600">{ts(a.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── No attestations yet ── */}
            {result.attestations.length === 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-xs text-zinc-600">
                No Paperclip attestations submitted yet for this swarm.
              </div>
            )}

          </div>
        )}

        {/* ── Footer ── */}
        <div className="border-t border-white/[0.06] pt-6 text-center text-[10px] text-zinc-700 space-y-1">
          <div>notapaperclip.red · Powered by GhostAgent.ninja</div>
          <div>TEE attestations via Paperclip · ERC-8004 reputation on Gnosis Chain</div>
        </div>

      </div>
    </div>
  );
}
