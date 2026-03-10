/**
 * retry-queue.ts
 *
 * Retry manager for agent tasks:
 * - Max 3 attempts with exponential backoff (2s, 4s, 8s)
 * - Tracks consecutive failures in KV
 * - Pauses agent after 3 consecutive failures
 * - Logs every attempt to GlassBox via /api/agent/task/status
 */

import { runWithTimeout } from './task-timeout-handler';
import type { TaskMeta, TaskResult } from './task-timeout-handler';

export interface RetryConfig {
  maxAttempts?: number;     // default 3
  baseDelayMs?: number;     // default 2000
  timeoutMs?: number;       // default 300_000 (5 min)
  pauseAfterConsecutive?: number; // default 3
}

const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

export async function runWithRetry<T>(
  meta: Omit<TaskMeta, 'startedAt'>,
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 2000;
  const timeoutMs = config.timeoutMs ?? 300_000;
  const pauseAfter = config.pauseAfterConsecutive ?? 3;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const taskMeta: TaskMeta = { ...meta, startedAt: Date.now(), timeoutMs };
    try {
      const result = await runWithTimeout(taskMeta, fn);
      await recordSuccess(meta.agentName);
      await reportFinalResult({ taskId: meta.taskId, agentName: meta.agentName, status: 'completed', durationMs: Date.now() - taskMeta.startedAt, retries: attempt - 1 });
      return result;
    } catch (err: any) {
      lastError = err;
      const durationMs = Date.now() - taskMeta.startedAt;
      const isLastAttempt = attempt === maxAttempts;

      await reportFinalResult({
        taskId: meta.taskId, agentName: meta.agentName,
        status: isLastAttempt ? 'failed' : 'failed',
        durationMs, retries: attempt - 1, error: err?.message,
      });

      if (isLastAttempt) {
        const consecutive = await incrementFailures(meta.agentName);
        if (consecutive >= pauseAfter) {
          await pauseAgentDueToFailures(meta.agentName, consecutive);
        }
        break;
      }

      // Exponential backoff before retry
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }

  throw lastError ?? new Error('Task failed after max retries');
}

async function recordSuccess(agentName: string): Promise<void> {
  await fetch(`${BASE}/api/agent/task/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset-failures', agentName }),
  }).catch(() => {});
}

async function incrementFailures(agentName: string): Promise<number> {
  const res = await fetch(`${BASE}/api/agent/task/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'increment-failures', agentName }),
  }).catch(() => null);
  if (!res?.ok) return 0;
  const data = await res.json() as { consecutiveFailures?: number };
  return data.consecutiveFailures ?? 0;
}

async function pauseAgentDueToFailures(agentName: string, count: number): Promise<void> {
  await fetch(`${BASE}/api/agent/budget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pause', agentName }),
  }).catch(() => {});

  await fetch(`${BASE}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      from: 'retry-guardrail@ghostagent.ninja',
      subject: `[${agentName}] Agent paused — ${count} consecutive task failures`,
      body: `Agent ${agentName} has been paused after ${count} consecutive task failures.\n\nUnpause via Safe multi-sig at: https://ghostagent.ninja/dashboard`,
      internal: true,
    }),
  }).catch(() => {});
}

async function reportFinalResult(result: TaskResult): Promise<void> {
  await fetch(`${BASE}/api/agent/task/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'log', ...result }),
  }).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
