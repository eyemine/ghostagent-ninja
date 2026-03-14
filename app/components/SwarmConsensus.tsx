'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  type ConsensusRound, type CoordinationMethod, type VoteValue,
  METHOD_LABEL, METHOD_BADGE, strategyLabel,
} from '../services/swarm-coordination';

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const RESULT_COLOR: Record<string, string> = {
  approved: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  rejected: 'text-red-400 bg-red-500/10 ring-red-500/20',
  pending:  'text-amber-300 bg-amber-500/10 ring-amber-500/20',
  timeout:  'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20',
};

const VOTE_COLOR: Record<VoteValue, string> = {
  yes:     'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
  no:      'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20',
  abstain: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20',
};

const METHOD_COLOR: Record<CoordinationMethod, string> = {
  xmtp:  'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  email: 'text-sky-300 bg-sky-500/10 ring-sky-500/20',
};

interface Props {
  vaultName:     string;
  walletAddress: string;
  xmtpEnabled:   boolean;
  memberCount:   number;
}

interface RoundResponse {
  rounds?: ConsensusRound[];
  error?:  string;
}

export default function SwarmConsensus({ vaultName, walletAddress, xmtpEnabled, memberCount }: Props) {
  const [rounds,       setRounds]       = useState<ConsensusRound[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [topic,        setTopic]        = useState('');
  const [payload,      setPayload]      = useState('');
  const [strategy,     setStrategy]     = useState<'consensus' | 'parallel' | 'pipeline' | 'competitive'>('consensus');
  const [creating,     setCreating]     = useState(false);
  const [voting,       setVoting]       = useState<string | null>(null); // roundId being voted on
  const [voterName,    setVoterName]    = useState('');
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [expandedId,   setExpandedId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/swarm/coordinator?vault=${encodeURIComponent(vaultName)}&section=consensus`);
      const data = await res.json() as RoundResponse;
      setRounds(Array.isArray(data.rounds) ? data.rounds : []);
    } catch {
      setRounds([]);
    } finally {
      setLoading(false);
    }
  }, [vaultName]);

  useEffect(() => { load(); }, [load]);

  async function createRound() {
    if (!topic.trim() || creating) return;
    setCreating(true);
    setErrorMsg(null);
    try {
      const res  = await fetch('/api/swarm/coordinator', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'createConsensusRound',
          vaultName,
          walletAddress,
          topic:         topic.trim(),
          payload:       payload.trim() || topic.trim(),
          strategy,
          xmtpEnabled,
        }),
      });
      const data = await res.json() as { round?: ConsensusRound; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to create round');
      if (data.round) setRounds(prev => [data.round!, ...prev]);
      setTopic('');
      setPayload('');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  }

  async function castVote(roundId: string, vote: VoteValue) {
    if (!voterName.trim() || voting) return;
    setVoting(roundId);
    setErrorMsg(null);
    try {
      const res  = await fetch('/api/swarm/coordinator', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'castVote',
          vaultName,
          roundId,
          agentName: voterName.trim(),
          vote,
        }),
      });
      const data = await res.json() as { round?: ConsensusRound; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Vote failed');
      if (data.round) {
        setRounds(prev => prev.map(r => r.id === roundId ? data.round! : r));
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setVoting(null);
    }
  }

  const pendingRounds   = rounds.filter(r => r.result === 'pending');
  const resolvedRounds  = rounds.filter(r => r.result !== 'pending');
  const method: CoordinationMethod = xmtpEnabled ? 'xmtp' : 'email';

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-[#f2eee4]">Swarm Consensus</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${METHOD_COLOR[method]}`}>
              {METHOD_BADGE[method]}
            </span>
            <span className="text-[10px] text-[var(--muted)]">{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-[10px] text-[var(--muted)]">{METHOD_LABEL[method]}</p>
        </div>
        <button onClick={load} className="text-[10px] text-[var(--muted)] hover:text-[#f2eee4] transition">
          ↻ Refresh
        </button>
      </div>

      {/* ── Create round ── */}
      <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-white/[0.02] p-4 space-y-3">
        <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">START CONSENSUS ROUND</div>

        <input
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Proposal topic (e.g. 'Approve 0.05 xDAI payment to 0xabc…')"
          className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs text-[#f2eee4] placeholder:text-zinc-600 outline-none focus:border-[rgba(176,128,92,0.4)]"
        />

        <textarea
          value={payload}
          onChange={e => setPayload(e.target.value)}
          placeholder="Optional payload / context (JSON, memo, tx hash…)"
          rows={2}
          className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs text-[#f2eee4] placeholder:text-zinc-600 outline-none focus:border-[rgba(176,128,92,0.4)] resize-none"
        />

        <div className="flex items-center gap-3">
          <div className="text-[10px] text-[var(--muted)] shrink-0">Strategy:</div>
          <div className="flex gap-1 flex-wrap">
            {(['consensus', 'parallel', 'pipeline', 'competitive'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`rounded-lg border px-2.5 py-1 text-[9px] font-semibold transition-all ${
                  strategy === s
                    ? 'border-[rgba(176,128,92,0.5)] bg-[rgba(176,128,92,0.12)] text-[#f2eee4]'
                    : 'border-[rgba(176,128,92,0.15)] text-[var(--muted)] hover:text-[#f2eee4]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="ml-auto text-[9px] text-zinc-600">{strategyLabel(strategy)}</div>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] text-red-400">
            {errorMsg}
          </div>
        )}

        <button
          disabled={!topic.trim() || creating || memberCount === 0}
          onClick={createRound}
          className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83"/></svg>
              Broadcasting to swarm…
            </span>
          ) : `Start Round (${METHOD_BADGE[method]})`}
        </button>
      </div>

      {/* ── Pending rounds ── */}
      {loading ? (
        <div className="py-6 text-center text-[11px] text-[var(--muted)] animate-pulse">Loading rounds…</div>
      ) : pendingRounds.length > 0 ? (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">PENDING ROUNDS ({pendingRounds.length})</div>
          {pendingRounds.map(round => (
            <RoundCard
              key={round.id}
              round={round}
              voterName={voterName}
              onVoterNameChange={setVoterName}
              onVote={(v) => castVote(round.id, v)}
              voting={voting === round.id}
              expanded={expandedId === round.id}
              onToggle={() => setExpandedId(prev => prev === round.id ? null : round.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-black/20 px-4 py-5 text-center">
          <p className="text-[11px] text-zinc-600">No pending rounds. Start one above.</p>
        </div>
      )}

      {/* ── Resolved rounds ── */}
      {resolvedRounds.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold tracking-widest text-[var(--muted)]">RESOLVED ({resolvedRounds.length})</div>
          {resolvedRounds.slice(0, 5).map(round => (
            <RoundCard
              key={round.id}
              round={round}
              voterName={voterName}
              onVoterNameChange={setVoterName}
              onVote={(v) => castVote(round.id, v)}
              voting={voting === round.id}
              expanded={expandedId === round.id}
              onToggle={() => setExpandedId(prev => prev === round.id ? null : round.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RoundCard sub-component ─────────────────────────────────────────────────

interface RoundCardProps {
  round:             ConsensusRound;
  voterName:         string;
  onVoterNameChange: (v: string) => void;
  onVote:            (v: VoteValue) => void;
  voting:            boolean;
  expanded:          boolean;
  onToggle:          () => void;
}

function RoundCard({ round, voterName, onVoterNameChange, onVote, voting, expanded, onToggle }: RoundCardProps) {
  const yesCount = round.votes.filter(v => v.vote === 'yes').length;
  const noCount  = round.votes.filter(v => v.vote === 'no').length;
  const progress = round.memberCount > 0 ? (round.votes.length / round.memberCount) * 100 : 0;

  return (
    <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] overflow-hidden">

      {/* Round header */}
      <button
        onClick={onToggle}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${RESULT_COLOR[round.result]}`}>
              {round.result.toUpperCase()}
            </span>
            <span className="text-xs font-semibold text-[#f2eee4] truncate">{round.topic}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--muted)]">
            <span>{round.votes.length}/{round.memberCount} voted</span>
            <span>quorum {round.quorum}</span>
            <span>{timeAgo(round.createdAt)}</span>
            <span className="text-emerald-400">{yesCount} yes</span>
            <span className="text-red-400">{noCount} no</span>
          </div>
        </div>
        <span className="shrink-0 text-zinc-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Vote progress bar */}
      <div className="h-0.5 bg-zinc-800">
        <div
          className="h-0.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[rgba(176,128,92,0.1)]">

          {/* Consensus hash */}
          <div className="rounded-lg bg-black/30 px-3 py-2 space-y-0.5">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">CONSENSUS HASH</div>
            <div className="font-mono text-[10px] text-[#b0805c] break-all">{round.consensusHash}</div>
          </div>

          {/* Strategy + method */}
          <div className="flex gap-3 text-[10px] text-[var(--muted)]">
            <span>Strategy: <span className="text-violet-300">{round.strategy}</span></span>
            <span>Method: <span className={round.method === 'xmtp' ? 'text-emerald-300' : 'text-sky-300'}>{METHOD_BADGE[round.method]}</span></span>
          </div>

          {/* Vote list */}
          {round.votes.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">VOTES</div>
              {round.votes.map(v => (
                <div key={v.agentName} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-mono text-zinc-400">{v.agentName}</span>
                  <div className="flex items-center gap-2">
                    <span className={
                      v.vote === 'yes'     ? 'text-emerald-300' :
                      v.vote === 'no'      ? 'text-red-400'     : 'text-zinc-500'
                    }>{v.vote}</span>
                    <span className="text-zinc-600">{timeAgo(v.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Vote CTA — only for pending rounds */}
          {round.result === 'pending' && (
            <div className="space-y-2 pt-1">
              <div className="text-[9px] font-semibold tracking-widest text-[var(--muted)]">CAST VOTE AS AGENT</div>
              <input
                value={voterName}
                onChange={e => onVoterNameChange(e.target.value)}
                placeholder="agent-name (picoclaw.gno)"
                className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-2.5 py-1.5 text-xs text-[#f2eee4] placeholder:text-zinc-600 outline-none focus:border-violet-500/40"
              />
              <div className="flex gap-2">
                {(['yes', 'no', 'abstain'] as VoteValue[]).map(v => (
                  <button
                    key={v}
                    disabled={!voterName.trim() || voting}
                    onClick={() => onVote(v)}
                    className={`flex-1 rounded-lg border py-1.5 text-[10px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${VOTE_COLOR[v]}`}
                  >
                    {voting ? '…' : v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resolved info */}
          {round.result !== 'pending' && round.resolvedAt && (
            <p className="text-[9px] text-zinc-600">
              Resolved {timeAgo(round.resolvedAt)} · logged to Glass Box
            </p>
          )}
        </div>
      )}
    </div>
  );
}
