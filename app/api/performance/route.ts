/**
 * POST /api/performance
 *   { action: 'record-trade', agentName, trade: TradeRecord, ownerAddress }
 *   { action: 'get-metrics',  agentName }
 *   { action: 'submit-lablab', agentName, ownerAddress }  — posts to LabLab leaderboard
 *
 * GET /api/performance?agentName=xxx
 *   Returns latest computed metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  computeMetrics,
  formatMetricsSummary,
  type TradeRecord,
} from '../../services/performance-tracker';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// LabLab leaderboard endpoint (placeholder — update when API is published)
const LABLAB_LEADERBOARD_URL =
  process.env.LABLAB_LEADERBOARD_URL ?? 'https://lablab.ai/api/leaderboard/erc8004';

async function workerPost(body: Record<string, unknown>) {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

async function loadTrades(agentName: string): Promise<TradeRecord[]> {
  const data = await workerPost({ action: 'kvGet', key: `perf:trades:${agentName.toLowerCase()}` });
  return data?.value ? JSON.parse(data.value) : [];
}

export async function GET(req: NextRequest) {
  const agentName = req.nextUrl.searchParams.get('agentName');
  if (!agentName) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });

  const trades  = await loadTrades(agentName);
  const metrics = computeMetrics(agentName, trades);

  return NextResponse.json({
    ...metrics,
    summary: formatMetricsSummary(metrics),
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { action, agentName } = body as { action?: string; agentName?: string };
  if (!action || !agentName) {
    return NextResponse.json({ error: 'Missing action or agentName' }, { status: 400 });
  }

  // ── record-trade ──────────────────────────────────────────────────────────
  if (action === 'record-trade') {
    const { trade, ownerAddress } = body as { trade?: TradeRecord; ownerAddress?: string };
    if (!trade || !ownerAddress) {
      return NextResponse.json({ error: 'Missing trade or ownerAddress' }, { status: 400 });
    }

    const trades = await loadTrades(agentName);
    trades.push({ ...trade, agentName });

    await workerPost({
      action: 'kvPut',
      key:    `perf:trades:${agentName.toLowerCase()}`,
      value:  JSON.stringify(trades),
      ownerAddress,
    });

    const metrics = computeMetrics(agentName, trades);
    return NextResponse.json({
      ok: true,
      tradeId: trade.id,
      metrics,
      summary: formatMetricsSummary(metrics),
    });
  }

  // ── get-metrics ───────────────────────────────────────────────────────────
  if (action === 'get-metrics') {
    const trades  = await loadTrades(agentName);
    const metrics = computeMetrics(agentName, trades);
    return NextResponse.json({ ...metrics, summary: formatMetricsSummary(metrics) });
  }

  // ── submit-lablab ─────────────────────────────────────────────────────────
  if (action === 'submit-lablab') {
    const { ownerAddress } = body as { ownerAddress?: string };
    if (!ownerAddress) return NextResponse.json({ error: 'Missing ownerAddress' }, { status: 400 });

    const trades  = await loadTrades(agentName);
    const metrics = computeMetrics(agentName, trades);

    const payload = {
      agentName,
      ownerAddress,
      sharpeRatio:  metrics.sharpeRatio,
      maxDrawdown:  metrics.maxDrawdown,
      totalPnLPct:  metrics.totalPnLPct,
      tradeCount:   metrics.tradeCount,
      winRate:      metrics.winRate,
      summary:      formatMetricsSummary(metrics),
      timestamp:    Date.now(),
    };

    let lablabResult: { ok?: boolean; error?: string } = { ok: true };
    try {
      const r = await fetch(LABLAB_LEADERBOARD_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      lablabResult = await r.json();
    } catch {
      // LabLab endpoint not yet live — cache submission locally
      lablabResult = { ok: false, error: 'LabLab endpoint not reachable (cached locally)' };
    }

    // Always cache locally regardless
    await workerPost({
      action: 'kvPut',
      key:    `perf:lablab-submission:${agentName.toLowerCase()}`,
      value:  JSON.stringify({ ...payload, lablabResult }),
      ownerAddress,
    });

    return NextResponse.json({
      ok:       true,
      metrics,
      summary:  formatMetricsSummary(metrics),
      lablab:   lablabResult,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
