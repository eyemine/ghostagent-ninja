/**
 * task-timeout-handler.ts
 *
 * Wraps agent task execution with:
 * - Configurable timeout (default 5 min)
 * - Auto-terminate on timeout
 * - GlassBox audit log on failure/timeout
 * - NFTmail alert to owner
 */

export interface TaskMeta {
  taskId: string;
  agentName: string;
  description: string;
  startedAt: number; // epoch ms
  timeoutMs?: number; // default 300_000 (5 min)
}

export interface TaskResult {
  taskId: string;
  agentName: string;
  status: 'completed' | 'timeout' | 'failed';
  durationMs: number;
  retries: number;
  error?: string;
}

const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

export async function runWithTimeout<T>(
  meta: TaskMeta,
  fn: () => Promise<T>
): Promise<T> {
  const timeoutMs = meta.timeoutMs ?? 300_000;
  const start = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  );

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    const durationMs = Date.now() - start;
    await reportTaskResult({ ...meta, status: 'completed', durationMs, retries: 0 });
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const isTimeout = err?.message?.includes('timed out');
    await reportTaskResult({
      ...meta,
      status: isTimeout ? 'timeout' : 'failed',
      durationMs,
      retries: 0,
      error: err?.message,
    });
    throw err;
  }
}

export async function reportTaskResult(result: TaskResult & Pick<TaskMeta, 'description'>): Promise<void> {
  await fetch(`${BASE}/api/agent/task/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  }).catch(() => {});
}

export async function sendTaskAlert(result: TaskResult, description: string): Promise<void> {
  const mins = (result.durationMs / 60000).toFixed(1);
  const subject = result.status === 'timeout'
    ? `[${result.agentName}] Task timed out after ${mins} min`
    : `[${result.agentName}] Task failed: ${result.error?.slice(0, 80)}`;
  await fetch(`${BASE}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: result.agentName,
      from: 'task-guardrail@ghostagent.ninja',
      subject,
      body: `Task: ${description}\nID: ${result.taskId}\nStatus: ${result.status}\nDuration: ${mins} min\nRetries: ${result.retries}\nError: ${result.error ?? 'none'}`,
      internal: true,
    }),
  }).catch(() => {});
}
