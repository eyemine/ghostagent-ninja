import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';

/**
 * /api/agent/budget
 *
 * GET  ?agent=<name>         → BudgetState
 * POST { action, agentName, ...params }
 *   action = 'spend'       | amount: number (xDAI)
 *   action = 'configure'   | dailyCap: number, alertThresholdBps?: number, moduleAddress?: string
 *   action = 'reset'       (requires Safe multi-sig — validated server-side via BUDGET_ADMIN_SECRET)
 *   action = 'pause'
 *   action = 'unpause'
 *
 * KV namespace: AGENT_KV (reuses existing binding)
 * KV keys: budget:<agent>:cap | spent | day | paused | alert | module
 */

const BUDGET_ADMIN_SECRET = process.env.BUDGET_ADMIN_SECRET;
const ALERT_THRESHOLD_DEFAULT = 8000; // 80% in bps

function utcDay() { return Math.floor(Date.now() / 86_400_000); }

interface BudgetState {
  agentName: string; dailyCap: number; spentToday: number;
  remaining: number; bps: number; paused: boolean; day: number; moduleAddress?: string;
}

async function readBudget(agent: string): Promise<BudgetState> {
  const res = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getBudget', agentName: agent }),
  });
  if (res.ok) {
    const data = await res.json() as Partial<BudgetState>;
    return hydrate(agent, data);
  }
  return defaultState(agent);
}

function hydrate(agent: string, d: Partial<BudgetState>): BudgetState {
  const cap = d.dailyCap ?? 0.1;
  const day = utcDay();
  const spent = (d.day ?? 0) === day ? (d.spentToday ?? 0) : 0;
  const bps = cap > 0 ? Math.round((spent / cap) * 10000) : 0;
  return {
    agentName: agent, dailyCap: cap, spentToday: spent,
    remaining: Math.max(0, cap - spent), bps,
    paused: (d.day ?? 0) === day ? (d.paused ?? false) : false,
    day, moduleAddress: d.moduleAddress,
  };
}

function defaultState(agent: string): BudgetState {
  return { agentName: agent, dailyCap: 0.1, spentToday: 0, remaining: 0.1, bps: 0, paused: false, day: utcDay() };
}

async function writeBudget(agent: string, state: BudgetState): Promise<void> {
  await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setBudget', agentName: agent, budget: state }),
  }).catch(() => {});
}

async function sendAlert(agent: string, state: BudgetState): Promise<void> {
  const pct = (state.bps / 100).toFixed(0);
  const subject = state.paused
    ? `[${agent}] Agent paused — daily budget exhausted`
    : `[${agent}] Budget alert: ${pct}% of daily cap used`;
  const body = `Agent: ${agent}\nSpent: ${state.spentToday.toFixed(6)} xDAI\nCap: ${state.dailyCap.toFixed(6)} xDAI\nRemaining: ${state.remaining.toFixed(6)} xDAI\nStatus: ${state.paused ? 'PAUSED' : `${pct}%`}`;

  await fetch(`${process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja'}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName: agent, from: 'budget-guardrail@ghostagent.ninja', subject, body, internal: true }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  if (!agent) return NextResponse.json({ error: 'Missing agent' }, { status: 400 });
  try {
    const state = await readBudget(agent.toLowerCase());
    return NextResponse.json(state);
  } catch {
    return NextResponse.json(defaultState(agent.toLowerCase()));
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action: string; agentName?: string; amount?: number;
    dailyCap?: number; alertThresholdBps?: number; moduleAddress?: string;
    adminSecret?: string;
  };

  const agent = body.agentName?.toLowerCase();
  if (!agent) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });

  const state = await readBudget(agent);

  switch (body.action) {
    case 'spend': {
      if (state.paused) return NextResponse.json({ error: 'Agent paused — budget exhausted', paused: true }, { status: 403 });
      const amount = body.amount ?? 0;
      if (amount < 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

      const day = utcDay();
      const spent = state.day === day ? state.spentToday + amount : amount;
      const bps = state.dailyCap > 0 ? Math.round((spent / state.dailyCap) * 10000) : 0;
      const exhausted = spent >= state.dailyCap;

      const updated: BudgetState = {
        ...state, spentToday: spent, remaining: Math.max(0, state.dailyCap - spent),
        bps, day, paused: exhausted,
      };

      await writeBudget(agent, updated);

      const alertBps = body.alertThresholdBps ?? ALERT_THRESHOLD_DEFAULT;
      if (exhausted || bps >= alertBps) await sendAlert(agent, updated);

      return NextResponse.json(updated);
    }

    case 'configure': {
      const updated: BudgetState = {
        ...state,
        dailyCap: body.dailyCap ?? state.dailyCap,
        moduleAddress: body.moduleAddress ?? state.moduleAddress,
        remaining: Math.max(0, (body.dailyCap ?? state.dailyCap) - state.spentToday),
      };
      updated.bps = updated.dailyCap > 0 ? Math.round((updated.spentToday / updated.dailyCap) * 10000) : 0;
      await writeBudget(agent, updated);
      return NextResponse.json(updated);
    }

    case 'reset': {
      if (BUDGET_ADMIN_SECRET && body.adminSecret !== BUDGET_ADMIN_SECRET) {
        return NextResponse.json({ error: 'Unauthorised — requires Safe multi-sig approval' }, { status: 403 });
      }
      const updated: BudgetState = { ...state, spentToday: 0, remaining: state.dailyCap, bps: 0, paused: false, day: utcDay() };
      await writeBudget(agent, updated);
      return NextResponse.json(updated);
    }

    case 'pause': {
      const updated = { ...state, paused: true };
      await writeBudget(agent, updated);
      return NextResponse.json(updated);
    }

    case 'unpause': {
      if (BUDGET_ADMIN_SECRET && body.adminSecret !== BUDGET_ADMIN_SECRET) {
        return NextResponse.json({ error: 'Unauthorised — requires Safe multi-sig approval' }, { status: 403 });
      }
      const updated = { ...state, paused: false };
      await writeBudget(agent, updated);
      return NextResponse.json(updated);
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
