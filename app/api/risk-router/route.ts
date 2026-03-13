/**
 * POST /api/risk-router
 *
 * Risk Router — enforce position size, leverage, daily loss limits, market whitelist.
 * Mirrors RiskRouterModule.sol but operates at the API layer for pre-flight checks.
 *
 * Body:
 *   { action: 'check', agentName, market, positionSize, leverage, ownerAddress }
 *   { action: 'reset-breaker', agentName, ownerAddress }
 *   { action: 'get-config', agentName }
 *   { action: 'set-config', agentName, config: { dailyLossCap, maxPositionSize, maxLeverage, whitelist }, ownerAddress }
 */

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// Default risk limits
const DEFAULT_RISK_CONFIG = {
  dailyLossCap:    0.05,    // 5% of portfolio
  maxPositionSize: 0.10,    // 10% per position
  maxLeverage:     3,       // 3x max
  whitelist: ['UNI', 'CURVE', 'AAVE', 'WETH', 'WXDAI', 'USDC', 'GNO', 'COW', 'OLAS'],
};

async function workerPost(body: Record<string, unknown>) {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { action, agentName } = body as { action?: string; agentName?: string };
  if (!action || !agentName) {
    return NextResponse.json({ error: 'Missing action or agentName' }, { status: 400 });
  }

  const configKey = `risk:config:${(agentName as string).toLowerCase()}`;
  const stateKey  = `risk:state:${(agentName as string).toLowerCase()}`;

  // ── get-config ────────────────────────────────────────────────────────────
  if (action === 'get-config') {
    const data = await workerPost({ action: 'kvGet', key: configKey });
    const config = data?.value ? JSON.parse(data.value) : DEFAULT_RISK_CONFIG;
    return NextResponse.json({ agentName, config });
  }

  // ── set-config ────────────────────────────────────────────────────────────
  if (action === 'set-config') {
    const { config, ownerAddress } = body as { config?: Partial<typeof DEFAULT_RISK_CONFIG>; ownerAddress?: string };
    if (!config || !ownerAddress) return NextResponse.json({ error: 'Missing config or ownerAddress' }, { status: 400 });
    const merged = { ...DEFAULT_RISK_CONFIG, ...config };
    await workerPost({ action: 'kvPut', key: configKey, value: JSON.stringify(merged), ownerAddress });
    return NextResponse.json({ ok: true, config: merged });
  }

  // ── reset-breaker ─────────────────────────────────────────────────────────
  if (action === 'reset-breaker') {
    const { ownerAddress } = body as { ownerAddress?: string };
    if (!ownerAddress) return NextResponse.json({ error: 'Missing ownerAddress' }, { status: 400 });
    const stateRaw = await workerPost({ action: 'kvGet', key: stateKey });
    const state = stateRaw?.value ? JSON.parse(stateRaw.value) : {};
    state.circuitOpen = false;
    state.dailyLoss   = 0;
    state.resetAt     = Date.now();
    await workerPost({ action: 'kvPut', key: stateKey, value: JSON.stringify(state), ownerAddress });
    return NextResponse.json({ ok: true, message: 'Circuit breaker reset ✓' });
  }

  // ── check ─────────────────────────────────────────────────────────────────
  if (action === 'check') {
    const { market, positionSize, leverage, ownerAddress } = body as {
      market?: string; positionSize?: number; leverage?: number; ownerAddress?: string;
    };
    if (!market || positionSize === undefined || leverage === undefined || !ownerAddress) {
      return NextResponse.json({ error: 'Missing market, positionSize, leverage, or ownerAddress' }, { status: 400 });
    }

    const [configRaw, stateRaw] = await Promise.all([
      workerPost({ action: 'kvGet', key: configKey }),
      workerPost({ action: 'kvGet', key: stateKey }),
    ]);

    const config = configRaw?.value ? JSON.parse(configRaw.value) : DEFAULT_RISK_CONFIG;
    const state  = stateRaw?.value  ? JSON.parse(stateRaw.value)  : { dailyLoss: 0, circuitOpen: false, day: 0 };

    const today = Math.floor(Date.now() / 86400000);
    if (state.day !== today) { state.dailyLoss = 0; state.day = today; }

    const blocks: string[] = [];

    if (state.circuitOpen) {
      blocks.push('Circuit breaker open — trading paused');
    }
    if (!config.whitelist.map((m: string) => m.toUpperCase()).includes((market as string).toUpperCase())) {
      blocks.push(`Market not whitelisted: ${market}`);
    }
    if ((positionSize as number) > config.maxPositionSize) {
      blocks.push(`Position size ${(positionSize as number * 100).toFixed(1)}% exceeds max ${(config.maxPositionSize * 100).toFixed(1)}%`);
    }
    if ((leverage as number) > config.maxLeverage) {
      blocks.push(`Leverage ${leverage}x exceeds max ${config.maxLeverage}x`);
    }
    if (state.dailyLoss >= config.dailyLossCap) {
      blocks.push(`Risk Limit Enforced: Daily Loss Cap Hit (${(state.dailyLoss * 100).toFixed(1)}% / ${(config.dailyLossCap * 100).toFixed(1)}%)`);
    }

    if (blocks.length > 0) {
      // Log TradeBlocked event to Glass Box
      const auditKey = `audit:risk:${(agentName as string).toLowerCase()}`;
      const auditRaw = await workerPost({ action: 'kvGet', key: auditKey });
      const auditLog: unknown[] = auditRaw?.value ? JSON.parse(auditRaw.value) : [];
      auditLog.push({
        type: 'TradeBlocked',
        agentName,
        market,
        positionSize,
        leverage,
        reasons: blocks,
        timestamp: Date.now(),
      });
      await workerPost({ action: 'kvPut', key: auditKey, value: JSON.stringify(auditLog), ownerAddress });

      return NextResponse.json({ ok: false, blocked: true, reasons: blocks }, { status: 403 });
    }

    return NextResponse.json({ ok: true, blocked: false, config, state });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
