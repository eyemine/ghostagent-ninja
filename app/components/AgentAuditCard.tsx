'use client';

import { useEffect, useState, useMemo } from 'react';
import { formatEther, createPublicClient, http, parseAbiItem } from 'viem';
import { gnosis } from '../utils/chains';

interface AuditData {
  xdaiBalance: bigint | null;
  storyIpCount: number;
  lastTxTimestamp: number | null;
  lastTxHash: string | null;
}

interface AgentAuditCardProps {
  tbaAddress: string;
  agentName?: string;
  namespace?: string;
  registrar?: string;
  principalAddress?: string | null;
}

export default function AgentAuditCard({ tbaAddress, agentName, namespace, registrar, principalAddress }: AgentAuditCardProps) {
  const publicClient = useMemo(() => createPublicClient({
    chain: gnosis,
    transport: http(),
  }), []);

  const [audit, setAudit] = useState<AuditData>({
    xdaiBalance: null,
    storyIpCount: 0,
    lastTxTimestamp: null,
    lastTxHash: null,
  });
  const [loading, setLoading] = useState(true);
  const [telemetry, setTelemetry] = useState<{
    activityScore: number;
    inbox: { count: number };
    heartbeat: { isActive: boolean; lastBeat?: number };
  } | null>(null);

  // Determine alive status
  const isAlive = !loading && (
    (audit.xdaiBalance !== null && audit.xdaiBalance > BigInt(0)) ||
    (audit.lastTxTimestamp !== null && (Date.now() - audit.lastTxTimestamp) < 7 * 24 * 60 * 60 * 1000) ||
    telemetry?.heartbeat.isActive === true
  );

  useEffect(() => {
    if (!tbaAddress || tbaAddress === '0x0000000000000000000000000000000000000000') return;

    async function fetchAudit() {
      setLoading(true);
      const data: AuditData = {
        xdaiBalance: null,
        storyIpCount: 0,
        lastTxTimestamp: null,
        lastTxHash: null,
      };

      // 1. xDAI balance
      try {
        data.xdaiBalance = await publicClient.getBalance({
          address: tbaAddress as `0x${string}`,
        });
      } catch {}

      // 2. Story IP count — query SubnameMinted events where this TBA was created
      //    (counts how many IPA registrations this agent has)
      if (registrar) {
        try {
          const tbaEvent = parseAbiItem(
            'event TokenboundAccountCreated(address indexed account, address indexed tokenContract, uint256 indexed tokenId)'
          );
          const logs = await publicClient.getLogs({
            address: registrar as `0x${string}`,
            event: tbaEvent,
            args: { account: tbaAddress as `0x${string}` },
            fromBlock: 'earliest',
            toBlock: 'latest',
          });
          data.storyIpCount = logs.length;
        } catch {}
      }

      // 3. Last tx timestamp — get latest block's tx count for this address
      try {
        const txCount = await publicClient.getTransactionCount({
          address: tbaAddress as `0x${string}`,
        });
        if (txCount > 0) {
          // Get the latest block to approximate last activity
          const block = await publicClient.getBlock({ blockTag: 'latest' });
          // Check recent blocks for transactions from this address
          const currentBlock = Number(block.number);
          for (let i = 0; i < 1000 && i < currentBlock; i += 100) {
            try {
              const logs = await publicClient.getLogs({
                address: tbaAddress as `0x${string}`,
                fromBlock: BigInt(currentBlock - i - 100),
                toBlock: BigInt(currentBlock - i),
              });
              if (logs.length > 0) {
                const lastLog = logs[logs.length - 1];
                const logBlock = await publicClient.getBlock({ blockNumber: lastLog.blockNumber });
                data.lastTxTimestamp = Number(logBlock.timestamp) * 1000;
                data.lastTxHash = lastLog.transactionHash;
                break;
              }
            } catch {}
          }
        }
      } catch {}

      setAudit(data);
      setLoading(false);
    }

    fetchAudit();
  }, [tbaAddress, registrar, publicClient]);

  // Fetch telemetry from CF worker
  useEffect(() => {
    if (!agentName) return;
    async function fetchTelemetry() {
      try {
        const res = await fetch('/api/inbox', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentName }),
        });
        if (res.ok) {
          const data = await res.json() as Record<string, any>;
          setTelemetry({
            activityScore: data.activityScore || 0,
            inbox: data.inbox || { count: 0 },
            heartbeat: data.heartbeat || { isActive: false },
          });
        }
      } catch {}
    }
    fetchTelemetry();
  }, [agentName]);

  const truncAddr = `${tbaAddress.slice(0, 6)}...${tbaAddress.slice(-4)}`;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Header — alive signal */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.18em] text-[var(--muted)]">AGENT AUDIT</span>
          {agentName && namespace && (
            <span className="text-xs text-[rgb(160,220,255)]">
              {agentName}.{namespace}.gno
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-[10px] text-[var(--muted)]">scanning...</span>
          ) : isAlive ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/25">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              ALIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2.5 py-1 text-[10px] font-bold text-zinc-500 ring-1 ring-zinc-500/20">
              <span className="h-2 w-2 rounded-full bg-zinc-600" />
              DORMANT
            </span>
          )}
        </div>
      </div>

      {/* Telemetry grid */}
      <div className="grid grid-cols-4 gap-px bg-[var(--border)]">
        {/* xDAI Balance */}
        <div className="bg-[var(--card)] px-4 py-4">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">xDAI BALANCE</div>
          <div className="mt-1.5 text-xl font-bold text-white">
            {loading ? (
              <span className="inline-block h-6 w-16 animate-pulse rounded bg-white/5" />
            ) : audit.xdaiBalance !== null ? (
              Number(formatEther(audit.xdaiBalance)).toFixed(4)
            ) : (
              '—'
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">Gnosis Chain</div>
        </div>

        {/* Story IP Count */}
        <div className="bg-[var(--card)] px-4 py-4">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">STORY IPs</div>
          <div className="mt-1.5 text-xl font-bold text-violet-300">
            {loading ? (
              <span className="inline-block h-6 w-8 animate-pulse rounded bg-white/5" />
            ) : (
              audit.storyIpCount
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">IP Assets</div>
        </div>

        {/* Last Tx */}
        <div className="bg-[var(--card)] px-4 py-4">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">LAST TX</div>
          <div className="mt-1.5 text-sm font-bold">
            {loading ? (
              <span className="inline-block h-6 w-12 animate-pulse rounded bg-white/5" />
            ) : audit.lastTxTimestamp ? (
              <span className="text-emerald-300">{formatTimeAgo(audit.lastTxTimestamp)}</span>
            ) : (
              <span className="text-[var(--muted)]">none</span>
            )}
          </div>
          {audit.lastTxHash && (
            <a
              href={`https://gnosisscan.io/tx/${audit.lastTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block text-[10px] text-[rgb(160,220,255)] hover:underline"
            >
              view ↗
            </a>
          )}
        </div>

        {/* ACTIVITY / Heartbeat */}
        <div className="bg-[var(--card)] px-4 py-4">
          <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INBOX</div>
          <div className="mt-1.5 text-xl font-bold text-violet-300">
            {telemetry ? (telemetry.inbox.count ?? 0) : '—'}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">
            {telemetry?.heartbeat.isActive ? '● live' : 'msgs'}
          </div>
        </div>
      </div>

      {/* ERC-8226 Principal */}
      {principalAddress && (
        <div className="flex items-center justify-between border-t border-[var(--border)] bg-amber-500/5 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.14em] text-amber-400/80">LIABLE OWNER</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20">ERC-8226</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-[11px] text-amber-200/90">
              {principalAddress.slice(0, 6)}…{principalAddress.slice(-4)}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(principalAddress)}
              className="text-[var(--muted)] hover:text-amber-300 text-[10px]"
            >
              Copy
            </button>
            <a
              href={`https://gnosisscan.io/address/${principalAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-amber-300/70 hover:underline"
            >
              ↗
            </a>
          </div>
        </div>
      )}

      {/* Footer — TBA address */}
      <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-2.5">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span>TBA:</span>
          <code className="text-[rgb(160,220,255)]">{truncAddr}</code>
          <button
            onClick={() => navigator.clipboard.writeText(tbaAddress)}
            className="text-[var(--muted)] hover:text-white"
          >
            Copy
          </button>
        </div>
        <a
          href={`https://gnosisscan.io/address/${tbaAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[rgb(160,220,255)] hover:underline"
        >
          Gnosisscan ↗
        </a>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
