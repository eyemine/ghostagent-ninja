/**
 * rate-limit-tracker.ts — client-side rate limit state tracker
 * Reads from /api/agent/rate-limit backed by AGENT_KV
 */

export interface RateLimitState {
  agentName: string;
  count: number;
  limit: number;
  remaining: number;
  bps: number;          // 0-10000
  cooldown: boolean;
  cooldownUntil?: number; // epoch ms
  windowResetAt?: number; // epoch ms
}

const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

export async function getRateLimit(agentName: string): Promise<RateLimitState> {
  const res = await fetch(`${BASE}/api/agent/rate-limit?agent=${encodeURIComponent(agentName)}`);
  if (!res.ok) return defaultState(agentName);
  return res.json() as Promise<RateLimitState>;
}

export async function recordRequest(agentName: string): Promise<RateLimitState> {
  const res = await fetch(`${BASE}/api/agent/rate-limit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentName }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string; cooldown?: boolean };
    if (res.status === 429) throw Object.assign(new Error(err.error ?? 'Rate limited'), { status: 429, cooldown: true });
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<RateLimitState>;
}

export function formatRateLimit(s: RateLimitState): string {
  const pct = (s.bps / 100).toFixed(0);
  const status = s.cooldown ? '⏸ COOLDOWN' : s.bps >= 8000 ? '⚠️' : '✓';
  return `Rate Limit: ${s.count}/${s.limit} requests (${pct}%) ${status}`;
}

function defaultState(agentName: string): RateLimitState {
  return { agentName, count: 0, limit: 100, remaining: 100, bps: 0, cooldown: false };
}
