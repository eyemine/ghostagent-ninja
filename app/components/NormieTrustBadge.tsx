'use client';

import { useEffect, useState } from 'react';

/**
 * Independent trust verification panel powered by the notapaperclip.red oracle.
 *
 * Runs three real checks in parallel (proxied via /api/trust):
 *   1. ERC-8004 resolve  — on-chain tokenURI() for the agent's agentId
 *   2. A2A validate      — fetches /.well-known/agent-card.json and scores it
 *   3. MCP probe         — probes well-known agent/MCP endpoints
 *
 * Response shapes mirror the real notapaperclip.red routes — see
 * app/api/{erc8004/resolve,a2a/validate,mcp/probe} in notapaperclip-nextjs.
 */

interface ResolveResult {
  agentId?: number;
  chainName?: string;
  agentURI?: string;
  inlineCard?: Record<string, unknown>;
  explorerUrl?: string;
  error?: string;
}

interface A2AField { field: string; required: boolean; present: boolean; }
interface A2AResult {
  passed?: boolean;
  score?: number;
  resolvedUrl?: string;
  fields?: A2AField[];
  error?: string;
}

interface ProbeEntry { found: boolean; }
interface MCPResult {
  base?: string;
  probed?: Record<string, ProbeEntry>;
  merged?: { skills?: unknown[]; mcpServers?: unknown[] };
  error?: string;
}

export interface TrustTarget {
  agentName: string;
  agentId: number;
  chain: string;
  webUrl: string;
}

type Status = 'loading' | 'done' | 'error';

function Row({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  const icon = ok === null ? '·' : ok ? '✓' : '✗';
  const color = ok === null ? 'text-zinc-500' : ok ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0">
      <span className="text-sm text-zinc-300">{label}</span>
      <span className={`text-xs font-medium ${color}`}>
        <span className="mr-1.5">{icon}</span>{detail}
      </span>
    </div>
  );
}

export function NormieTrustBadge({ target }: { target: TrustTarget }) {
  const [status, setStatus] = useState<Status>('loading');
  const [resolve, setResolve] = useState<ResolveResult | null>(null);
  const [a2a, setA2a] = useState<A2AResult | null>(null);
  const [mcp, setMcp] = useState<MCPResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setResolve(null); setA2a(null); setMcp(null);

    const get = async (qs: string) => {
      const res = await fetch(`/api/trust?${qs}`);
      return (await res.json()) as Record<string, unknown>;
    };

    Promise.allSettled([
      get(`check=resolve&chain=${encodeURIComponent(target.chain)}&agentId=${target.agentId}`),
      get(`check=a2a&url=${encodeURIComponent(target.webUrl)}`),
      get(`check=mcp&url=${encodeURIComponent(target.webUrl)}`),
    ]).then(([r, a, m]) => {
      if (cancelled) return;
      if (r.status === 'fulfilled') setResolve(r.value as ResolveResult);
      if (a.status === 'fulfilled') setA2a(a.value as A2AResult);
      if (m.status === 'fulfilled') setMcp(m.value as MCPResult);
      setStatus('done');
    }).catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; };
  }, [target.agentId, target.chain, target.webUrl]);

  // Derive real signals
  const registryOk = !!resolve?.agentURI && !resolve?.error;
  const a2aOk = a2a?.passed === true;
  const a2aScore = typeof a2a?.score === 'number' ? a2a.score : 0;
  const probedFound = mcp?.probed ? Object.values(mcp.probed).filter((p) => p.found).length : 0;
  const mcpOk = probedFound > 0;
  const toolCount = (mcp?.merged?.skills?.length ?? 0) + (mcp?.merged?.mcpServers?.length ?? 0);

  // Composite trust score (0-100), weighted toward on-chain identity
  const trustScore =
    (registryOk ? 40 : 0) +
    (a2aOk ? Math.round(a2aScore * 0.35) : 0) +
    (mcpOk ? 25 : 0);

  const scoreColor =
    trustScore >= 80 ? 'text-emerald-400' : trustScore >= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <h4 className="text-sm font-semibold text-emerald-300">Verified by notapaperclip.red</h4>
        </div>
        <a
          href="https://notapaperclip.red"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          independent trust oracle ↗
        </a>
      </div>

      {status === 'loading' ? (
        <p className="text-sm text-zinc-400 py-4">Verifying agent #{target.agentId} via trust oracle…</p>
      ) : (
        <>
          <div className="space-y-0">
            <Row
              label="ERC-8004 Registry"
              ok={registryOk}
              detail={registryOk ? `Resolved on ${resolve?.chainName ?? target.chain}` : 'Unregistered'}
            />
            <Row
              label="A2A Agent Card"
              ok={a2aOk}
              detail={a2a?.error ? 'Card unreachable' : a2aOk ? `Valid · ${a2aScore}/100` : `Incomplete · ${a2aScore}/100`}
            />
            <Row
              label="MCP / Endpoints"
              ok={mcpOk}
              detail={mcpOk ? `Online · ${probedFound} endpoint${probedFound === 1 ? '' : 's'}${toolCount ? `, ${toolCount} skills` : ''}` : 'Offline'}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-zinc-500">Trust score</span>
            <span className={`text-lg font-bold ${scoreColor}`}>{trustScore}<span className="text-xs text-zinc-600">/100</span></span>
          </div>

          {resolve?.explorerUrl && (
            <a
              href={resolve.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[11px] text-fuchsia-400 hover:underline"
            >
              View on-chain identity ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}
