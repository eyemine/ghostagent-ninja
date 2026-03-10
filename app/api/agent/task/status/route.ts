import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/agent/task/status
 * GET  ?agent=<name>&limit=20   → recent task log entries
 * POST { action, agentName, ...taskResult }
 *   action = 'log'               — write task result to KV + GlassBox
 *   action = 'reset-failures'    — clear consecutive failure counter
 *   action = 'increment-failures'— bump counter, return new value
 */

const WORKER_URL = process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';
const GLASSBOX_URL = process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja';

interface TaskLog {
  taskId: string; agentName: string; status: string;
  durationMs: number; retries: number; error?: string;
  description?: string; timestamp: number;
}

async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(`${WORKER_URL}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'kvGet', key }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const d = await res.json() as { value?: string };
  return d.value ?? null;
}

async function kvPut(key: string, value: string, ttl?: number): Promise<void> {
  await fetch(`${WORKER_URL}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'kvPut', key, value, ttl }),
  }).catch(() => {});
}

async function logToGlassBox(entry: TaskLog): Promise<void> {
  if (entry.status === 'completed') return;
  await fetch(`${GLASSBOX_URL}/api/glassbox/log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: entry.agentName,
      eventType: entry.status === 'timeout' ? 'task-timeout' : 'task-failed',
      data: { taskId: entry.taskId, durationMs: entry.durationMs, retries: entry.retries, error: entry.error },
    }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);
  if (!agent) return NextResponse.json({ error: 'Missing agent' }, { status: 400 });

  const raw = await kvGet(`task:log:${agent.toLowerCase()}`);
  const logs: TaskLog[] = raw ? JSON.parse(raw) : [];
  const consecutiveRaw = await kvGet(`task:failures:${agent.toLowerCase()}`);
  return NextResponse.json({ logs: logs.slice(-limit), consecutiveFailures: parseInt(consecutiveRaw ?? '0', 10) });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action?: string; agentName?: string; taskId?: string;
    status?: string; durationMs?: number; retries?: number; error?: string; description?: string;
  };
  const agent = body.agentName?.toLowerCase();
  if (!agent) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });

  const action = body.action ?? 'log';

  if (action === 'reset-failures') {
    await kvPut(`task:failures:${agent}`, '0');
    return NextResponse.json({ consecutiveFailures: 0 });
  }

  if (action === 'increment-failures') {
    const raw = await kvGet(`task:failures:${agent}`);
    const next = (parseInt(raw ?? '0', 10)) + 1;
    await kvPut(`task:failures:${agent}`, String(next));
    return NextResponse.json({ consecutiveFailures: next });
  }

  if (action === 'log') {
    const entry: TaskLog = {
      taskId: body.taskId ?? crypto.randomUUID(),
      agentName: agent, status: body.status ?? 'unknown',
      durationMs: body.durationMs ?? 0, retries: body.retries ?? 0,
      error: body.error, description: body.description, timestamp: Date.now(),
    };
    const raw = await kvGet(`task:log:${agent}`);
    const logs: TaskLog[] = raw ? JSON.parse(raw) : [];
    logs.push(entry);
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    await kvPut(`task:log:${agent}`, JSON.stringify(logs));
    await logToGlassBox(entry);
    if (body.status !== 'completed') {
      const { sendTaskAlert } = await import('../../../../services/task-timeout-handler');
      await sendTaskAlert(entry as any, entry.description ?? '').catch(() => {});
    }
    return NextResponse.json(entry);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
