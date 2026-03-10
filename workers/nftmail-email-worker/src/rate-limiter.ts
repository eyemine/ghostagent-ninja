/**
 * rate-limiter.ts — Cloudflare Worker rate limiter
 *
 * KV keys:
 *   rate:<agent>:count   — requests this window (TTL = 3600s)
 *   rate:<agent>:cooldown — set when limit hit (TTL = 900s = 15 min)
 */

export interface RateLimitConfig {
  maxPerHour?: number;    // default 100
  cooldownSec?: number;   // default 900 (15 min)
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  cooldown: boolean;
  cooldownUntil?: number; // epoch ms
}

export interface RateLimitEnv {
  AGENT_KV: KVNamespace;
  NEXTJS_BASE_URL?: string;
}

export async function checkRateLimit(
  agentName: string,
  env: RateLimitEnv,
  config: RateLimitConfig = {}
): Promise<RateLimitResult> {
  const limit = config.maxPerHour ?? 100;
  const cooldownSec = config.cooldownSec ?? 900;
  const key = `rate:${agentName}`;

  // Check cooldown
  const cooldownVal = await env.AGENT_KV.get(`${key}:cooldown`);
  if (cooldownVal) {
    const cooldownUntil = parseInt(cooldownVal, 10);
    return { allowed: false, count: limit, limit, remaining: 0, cooldown: true, cooldownUntil };
  }

  // Get current count
  const countVal = await env.AGENT_KV.get(`${key}:count`);
  const count = countVal ? parseInt(countVal, 10) : 0;

  if (count >= limit) {
    // Set cooldown
    const cooldownUntil = Date.now() + cooldownSec * 1000;
    await env.AGENT_KV.put(`${key}:cooldown`, String(cooldownUntil), { expirationTtl: cooldownSec });
    await sendRateLimitAlert(agentName, count, limit, env).catch(() => {});
    return { allowed: false, count, limit, remaining: 0, cooldown: true, cooldownUntil };
  }

  // Increment — TTL resets to 1hr on each write so use put with expiration only on first write
  const newCount = count + 1;
  const ttl = countVal ? undefined : 3600;
  await env.AGENT_KV.put(`${key}:count`, String(newCount), ttl ? { expirationTtl: ttl } : undefined);

  return { allowed: true, count: newCount, limit, remaining: limit - newCount, cooldown: false };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': result.cooldownUntil ? String(Math.ceil(result.cooldownUntil / 1000)) : '',
    'Retry-After': result.cooldown ? '900' : '',
  };
}

async function sendRateLimitAlert(agentName: string, count: number, limit: number, env: RateLimitEnv) {
  const base = env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja';
  await fetch(`${base}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      from: 'rate-limiter@ghostagent.ninja',
      subject: `[${agentName}] Rate limit hit — agent in cooldown (15 min)`,
      body: `Agent: ${agentName}\nRequests this hour: ${count}/${limit}\nCooldown: 15 minutes\nTime: ${new Date().toISOString()}`,
      internal: true,
    }),
  });
}
