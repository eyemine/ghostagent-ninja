/**
 * budget-tracker.ts
 *
 * Off-chain daily spend tracker backed by Cloudflare KV (via /api/agent/budget).
 * Mirrors on-chain DailyBudgetModule state for UI display and alerting.
 *
 * KV keys:
 *   budget:<agentName>:cap       — daily cap in xDAI (string float)
 *   budget:<agentName>:spent     — spent today in xDAI (string float)
 *   budget:<agentName>:day       — UTC day index (string int)
 *   budget:<agentName>:paused    — "1" | "0"
 *   budget:<agentName>:module    — DailyBudgetModule contract address
 */

export interface BudgetState {
  agentName: string;
  dailyCap: number;      // xDAI
  spentToday: number;    // xDAI
  remaining: number;     // xDAI
  bps: number;           // 0–10000
  paused: boolean;
  day: number;           // UTC day index
  moduleAddress?: string;
}

export interface BudgetConfig {
  dailyCap: number;
  alertThresholdBps?: number;   // default 8000 (80%)
  moduleAddress?: string;
}

const BASE_URL = typeof window !== 'undefined'
  ? ''
  : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

function utcDay(): number {
  return Math.floor(Date.now() / 86_400_000);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getBudget(agentName: string): Promise<BudgetState> {
  const res = await fetch(`${BASE_URL}/api/agent/budget?agent=${encodeURIComponent(agentName)}`);
  if (!res.ok) throw new Error(`getBudget: HTTP ${res.status}`);
  return res.json() as Promise<BudgetState>;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function recordSpend(agentName: string, amountXdai: number): Promise<BudgetState> {
  const res = await fetch(`${BASE_URL}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'spend', agentName, amount: amountXdai }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `recordSpend: HTTP ${res.status}`);
  }
  return res.json() as Promise<BudgetState>;
}

export async function configureBudget(agentName: string, config: BudgetConfig): Promise<BudgetState> {
  const res = await fetch(`${BASE_URL}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'configure', agentName, ...config }),
  });
  if (!res.ok) throw new Error(`configureBudget: HTTP ${res.status}`);
  return res.json() as Promise<BudgetState>;
}

export async function resetBudget(agentName: string): Promise<BudgetState> {
  const res = await fetch(`${BASE_URL}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset', agentName }),
  });
  if (!res.ok) throw new Error(`resetBudget: HTTP ${res.status}`);
  return res.json() as Promise<BudgetState>;
}

export async function pauseAgent(agentName: string): Promise<void> {
  await fetch(`${BASE_URL}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pause', agentName }),
  });
}

export async function unpauseAgent(agentName: string): Promise<void> {
  await fetch(`${BASE_URL}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'unpause', agentName }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatBudget(state: BudgetState): string {
  const pct = ((state.bps / 100)).toFixed(0);
  const status = state.paused ? '⏸ PAUSED' : state.bps >= 8000 ? '⚠️' : '✓';
  return `Daily Budget: ${state.spentToday.toFixed(4)}/${state.dailyCap.toFixed(4)} xDAI (${pct}%) ${status}`;
}

export { utcDay };
