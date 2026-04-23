'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, GNO_REGISTRARS } from '../../utils/chains';
import AgentAuditCard from '../../components/AgentAuditCard';

const NAMESPACE_LABELS = Object.keys(GNO_REGISTRARS) as (keyof typeof GNO_REGISTRARS)[];
const REGISTRAR_ADDRESSES = Object.values(GNO_REGISTRARS);

interface AgentReceipt {
  txHash: string;
  blockNumber: bigint;
  timestamp: number;
  namespace: string;
  registrar: string;
  owner: string;
  tokenId: string;
  tbaAddress?: string;
  // Telemetry from CF worker
  telemetry?: {
    surgeScore: number;
    inbox: { count: number; lastMessage?: { from: string; subject: string; timestamp: number } };
    calendar: { count: number };
    heartbeat: { isActive: boolean; lastBeat?: number };
    tier: string;
  };
}

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(),
});

export default function WorkReceiptsPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [receipts, setReceipts] = useState<AgentReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const walletAddress = wallets[0]?.address?.toLowerCase();

  const fetchReceipts = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);

    try {
      const allReceipts: AgentReceipt[] = [];

      const subnameMintedEvent = parseAbiItem(
        'event SubnameMinted(bytes32 indexed parentNode, bytes32 indexed labelhash, bytes32 indexed subnode, uint256 tokenId, address owner)'
      );
      const tbaCreatedEvent = parseAbiItem(
        'event TokenboundAccountCreated(address indexed account, address indexed tokenContract, uint256 indexed tokenId)'
      );

      for (let i = 0; i < REGISTRAR_ADDRESSES.length; i++) {
        const registrar = REGISTRAR_ADDRESSES[i];
        const namespace = NAMESPACE_LABELS[i];

        try {
          const mintLogs = await publicClient.getLogs({
            address: registrar,
            event: subnameMintedEvent,
            fromBlock: 'earliest',
            toBlock: 'latest',
          });

          const ownerLogs = mintLogs.filter(
            (log) => (log.args.owner as string)?.toLowerCase() === walletAddress
          );

          const tbaLogs = await publicClient.getLogs({
            address: registrar,
            event: tbaCreatedEvent,
            fromBlock: 'earliest',
            toBlock: 'latest',
          });

          const tbaMap = new Map<string, string>();
          for (const tbaLog of tbaLogs) {
            const tokenId = tbaLog.args.tokenId?.toString();
            const account = tbaLog.args.account as string;
            if (tokenId && account) tbaMap.set(tokenId, account);
          }

          for (const log of ownerLogs) {
            const tokenId = log.args.tokenId?.toString() || '0';
            let timestamp = 0;
            try {
              const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
              timestamp = Number(block.timestamp) * 1000;
            } catch {}

            allReceipts.push({
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp,
              namespace,
              registrar,
              owner: (log.args.owner as string) || walletAddress,
              tokenId,
              tbaAddress: tbaMap.get(tokenId),
            });
          }
        } catch {}
      }

      allReceipts.sort((a, b) => b.timestamp - a.timestamp);
      setReceipts(allReceipts);

      // Enrich with telemetry from CF worker (best-effort)
      // We use tokenId as a proxy — the worker needs the agent label
      // For now, fetch status for each unique namespace+tokenId
      for (const receipt of allReceipts) {
        try {
          const res = await fetch('/api/inbox', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agentName: `token${receipt.tokenId}` }),
          });
          if (res.ok) {
            const data = await res.json() as Record<string, any>;
            receipt.telemetry = {
              surgeScore: data.surgeScore || 0,
              inbox: data.inbox || { count: 0 },
              calendar: data.calendar || { count: 0 },
              heartbeat: data.heartbeat || { isActive: false },
              tier: data.tier || 'swarm',
            };
          }
        } catch {}
      }
      setReceipts([...allReceipts]);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch receipts');
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) fetchReceipts();
  }, [walletAddress, fetchReceipts]);

  if (!authenticated || !walletAddress) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-white">Work Receipts</h1>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <p className="text-[var(--muted)]">Connect your wallet to view work receipts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Receipts</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            On-chain activity &amp; agent telemetry for {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </p>
        </div>
        <button
          onClick={fetchReceipts}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] bg-black/30 px-4 py-2 text-xs text-[var(--muted)] transition hover:text-white disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && receipts.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--card)]" />
          ))}
        </div>
      )}

      {!loading && receipts.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <div className="text-4xl">📋</div>
          <p className="mt-3 text-[var(--muted)]">No work receipts found for this wallet.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Mint an agent on the home page to create your first receipt.
          </p>
        </div>
      )}

      {/* AgentAuditCards — one per unique TBA */}
      {receipts.filter(r => r.tbaAddress).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold tracking-wider text-[var(--muted)]">AGENT TELEMETRY</h2>
          {Array.from(new Map(receipts.filter(r => r.tbaAddress).map(r => [r.tbaAddress, r])).values()).map((receipt) => (
            <AgentAuditCard
              key={receipt.tbaAddress}
              tbaAddress={receipt.tbaAddress!}
              namespace={receipt.namespace}
              registrar={receipt.registrar}
              principalAddress={receipt.owner}
            />
          ))}
        </div>
      )}

      {/* Work Receipts — on-chain mint events */}
      {receipts.length > 0 && (
        <h2 className="text-sm font-semibold tracking-wider text-[var(--muted)]">ON-CHAIN RECEIPTS</h2>
      )}
      <div className="space-y-4">
        {receipts.map((receipt, idx) => (
          <div
            key={receipt.txHash + idx}
            className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden transition hover:border-[rgba(0,163,255,0.3)]"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    {receipt.namespace}.gno — Token #{receipt.tokenId}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {receipt.timestamp ? new Date(receipt.timestamp).toLocaleString() : `Block #${receipt.blockNumber}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {receipt.telemetry?.heartbeat.isActive && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    ACTIVE
                  </span>
                )}
                <span className="rounded-full bg-[rgba(0,163,255,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[rgb(160,220,255)]">
                  {receipt.telemetry?.tier?.toUpperCase() || 'MINTED'}
                </span>
              </div>
            </div>

            {/* Telemetry Grid */}
            <div className="grid grid-cols-4 gap-px bg-[var(--border)]">
              {/* SURGE */}
              <div className="bg-[var(--card)] px-4 py-3">
                <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SURGE</div>
                <div className="mt-1 text-lg font-bold text-violet-300">
                  {receipt.telemetry?.surgeScore?.toFixed(1) || '0.0'}
                </div>
              </div>
              {/* Inbox */}
              <div className="bg-[var(--card)] px-4 py-3">
                <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INBOX</div>
                <div className="mt-1 text-lg font-bold text-emerald-300">
                  {receipt.telemetry?.inbox.count ?? 0}
                </div>
                {receipt.telemetry?.inbox.lastMessage && (
                  <div className="mt-0.5 truncate text-[10px] text-[var(--muted)]">
                    {receipt.telemetry.inbox.lastMessage.subject || 'No subject'}
                  </div>
                )}
              </div>
              {/* Calendar */}
              <div className="bg-[var(--card)] px-4 py-3">
                <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">CALENDAR</div>
                <div className="mt-1 text-lg font-bold text-amber-300">
                  {receipt.telemetry?.calendar.count ?? 0}
                </div>
              </div>
              {/* Heartbeat */}
              <div className="bg-[var(--card)] px-4 py-3">
                <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">HEARTBEAT</div>
                <div className="mt-1 text-sm font-medium">
                  {receipt.telemetry?.heartbeat.lastBeat ? (
                    <span className="text-emerald-300">
                      {formatTimeAgo(receipt.telemetry.heartbeat.lastBeat)}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* On-chain details */}
            <div className="space-y-3 px-5 py-4 text-xs">
              {receipt.tbaAddress && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TBA</span>
                  <div className="flex items-center gap-2">
                    <code className="text-[rgb(160,220,255)]">{receipt.tbaAddress}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(receipt.tbaAddress!)}
                      className="text-[var(--muted)] hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                <code className="text-[var(--muted)]">{receipt.registrar.slice(0, 10)}...{receipt.registrar.slice(-6)}</code>
                <a
                  href={`https://gnosisscan.io/tx/${receipt.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[rgb(160,220,255)] hover:underline"
                >
                  {receipt.txHash.slice(0, 10)}...{receipt.txHash.slice(-6)} ↗
                </a>
              </div>
            </div>
          </div>
        ))}
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
