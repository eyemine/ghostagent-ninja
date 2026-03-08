'use client';
import { useState, useEffect, useCallback } from 'react';

interface AgentInfo {
  agentName: string;
  moduleAddress: string;
  active: boolean;
  activeTasks: number;
  completedTasks: number;
  addedAt: number;
}

interface TaskRecord {
  taskId: string;
  assignedAgent: string;
  topic: string;
  payloadHash: string;
  assignedAt: number;
  completed: boolean;
  completedAt: number;
}

interface CoordinatorState {
  vaultName: string;
  inboxEmail: string;
  agents: AgentInfo[];
  tasks: TaskRecord[];
}

interface Props {
  vaultName: string;
  walletAddress: string;
}

function timeAgo(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export default function SwarmCoordinatorDashboard({ vaultName, walletAddress }: Props) {
  const [state, setState] = useState<CoordinatorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentName, setAgentName] = useState('');
  const [moduleAddr, setModuleAddr] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/swarm/coordinator?vault=${encodeURIComponent(vaultName)}`);
      const data = await res.json() as CoordinatorState & { exists?: boolean };
      if (data.exists === false) {
        setState({ vaultName, inboxEmail: `swarm.${vaultName}_@nftmail.box`, agents: [], tasks: [] });
      } else {
        setState(data);
      }
    } catch { setState(null); } finally { setLoading(false); }
  }, [vaultName]);

  useEffect(() => { load(); }, [load]);

  async function addAgent() {
    if (!agentName || !moduleAddr || adding) return;
    setAdding(true); setError(null);
    try {
      const res = await fetch('/api/swarm/coordinator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-agent', vaultName, ownerAddress: walletAddress, agentName, moduleAddress: moduleAddr }),
      });
      const d = await res.json() as { error?: string };
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setAgentName(''); setModuleAddr('');
      await load();
    } catch (e: any) { setError(e?.message ?? 'Error'); }
    finally { setAdding(false); }
  }
  const activeAgents = state?.agents.filter(a => a.active) ?? [];
  const pendingTasks = state?.tasks.filter(t => !t.completed) ?? [];
  const completedTasks = state?.tasks.filter(t => t.completed) ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold tracking-[0.16em] text-[var(--muted)]">SWARM COORDINATOR</span>
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
              {state?.inboxEmail ?? `swarm.${vaultName}_@nftmail.box`}
            </span>
          </div>
          {!loading && state && (
            <p className="text-[11px] text-[var(--muted)]">
              {activeAgents.length} Agent{activeAgents.length !== 1 ? 's' : ''} Active
              {pendingTasks.length > 0 ? ` · ${pendingTasks.length} pending task${pendingTasks.length !== 1 ? 's' : ''}` : ''}
            </p>
          )}
        </div>
        <button onClick={() => load()} className="text-[10px] text-[var(--muted)] hover:text-white transition">↻ Refresh</button>
      </div>

      {/* Stats row */}
      {!loading && state && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'AGENTS ACTIVE', value: activeAgents.length, color: 'text-violet-300' },
            { label: 'PENDING',       value: pendingTasks.length,  color: 'text-amber-300' },
            { label: 'COMPLETED',     value: completedTasks.length, color: 'text-emerald-300' },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{s.label}</div>
              <div className={`mt-0.5 text-sm font-semibold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Agents list */}
      {!loading && activeAgents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">PICOCLAW AGENTS</p>
          {activeAgents.map(a => (
            <div key={a.agentName} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
                </span>
                <span className="text-xs font-medium text-[#f2eee4]">{a.agentName}</span>
                <span className="rounded px-1.5 py-0.5 text-[9px] font-medium text-amber-300 bg-amber-500/10">picoclaw.gno</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-[var(--muted)]">
                <span>{a.activeTasks} active</span>
                <span className="text-emerald-300">{a.completedTasks} done</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add agent form */}
      <div className="space-y-2 rounded-xl border border-[var(--border)] bg-black/20 p-3">
        <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">ADD PICOCLAW AGENT</p>
        <div className="flex gap-2 flex-wrap">
          <input value={agentName} onChange={e => setAgentName(e.target.value)}
            placeholder="agent-name (picoclaw.gno)"
            className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-black/30 px-2.5 py-1.5 text-xs text-[#f2eee4] placeholder:text-[var(--muted)] outline-none focus:border-violet-500/40" />
          <input value={moduleAddr} onChange={e => setModuleAddr(e.target.value)}
            placeholder="0x module address"
            className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-black/30 px-2.5 py-1.5 text-xs text-[#f2eee4] placeholder:text-[var(--muted)] outline-none focus:border-violet-500/40" />
          <button onClick={addAgent} disabled={adding || !agentName || !moduleAddr}
            className="rounded-lg bg-violet-600/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:opacity-40">
            {adding ? '…' : 'Add'}
          </button>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>

      {/* Recent tasks */}
      {!loading && state && state.tasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">RECENT TASKS</p>
          {state.tasks.slice(-5).reverse().map(t => (
            <div key={t.taskId} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${t.completed ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20' : 'text-amber-300 bg-amber-500/10 ring-amber-500/20'}`}>
                  {t.completed ? 'done' : 'pending'}
                </span>
                <span className="text-xs text-[#f2eee4]">{t.topic}</span>
                <span className="text-[10px] text-[var(--muted)]">→ {t.assignedAgent}</span>
              </div>
              <span className="text-[10px] text-[var(--muted)]">{timeAgo(t.assignedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-white/5" />)}</div>
      )}
    </div>
  );
}
