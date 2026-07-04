/**
 * bun-entry.ts — Hetzner/Bun runtime entry point for the nftmail worker.
 *
 * Replaces Cloudflare bindings with Redis-backed shims so index.ts runs
 * unchanged on Bun. All env.INBOX_KV / env.GHOST_CALENDAR calls are
 * transparently routed to ioredis.
 *
 * Usage on Hetzner:
 *   bun run src/bun-entry.ts
 *
 * Required env vars:
 *   WEBHOOK_SECRET, WORKER_SECRET
 *   MAILGUN_API_KEY, MG_MAILGUN_API_KEY, MAILGUN_SIGNING_KEY
 *   REDIS_HOST (default 127.0.0.1), REDIS_PORT (default 6379)
 *   PORT (default 8787)
 *
 * Optional:
 *   REDIS_PASSWORD, LIGHTHOUSE_API_KEY, SURGE_TOKEN, ZEROG_ARCHIVER_URL
 */

import Redis from 'ioredis';
import worker from './index';
import { openNftmailDb } from './bun-sqlite-d1';

// ── Redis-backed KVNamespace shim ────────────────────────────────────────────
// Satisfies the CF KVNamespace duck-type used throughout index.ts.
// keyPrefix isolates GHOST_CALENDAR keys (calendar:) from INBOX_KV keys.
class RedisKVNamespaceShim {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = '',
  ) {}

  private k(key: string): string { return this.keyPrefix + key; }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.k(key));
  }

  async getWithMetadata<M = unknown>(key: string): Promise<{ value: string | null; metadata: M | null }> {
    const value = await this.redis.get(this.k(key));
    return { value, metadata: null };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    const str = typeof value === 'string'
      ? value
      : Buffer.from(value as ArrayBuffer).toString('utf8');
    const k = this.k(key);
    if (options?.expirationTtl) {
      await this.redis.set(k, str, 'EX', Math.floor(options.expirationTtl));
    } else if (options?.expiration) {
      const ttl = Math.floor(options.expiration - Date.now() / 1000);
      if (ttl > 0) await this.redis.set(k, str, 'EX', ttl);
      else await this.redis.set(k, str);
    } else {
      await this.redis.set(k, str);
    }
  }

  async putJson(key: string, value: unknown, options?: { expirationTtl?: number; expiration?: number }): Promise<void> {
    return this.put(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  async list<M = unknown>(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: M }>; list_complete: boolean; cursor?: string }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const keys: Array<{ name: string }> = [];
    let cursor = options?.cursor ?? '0';
    let scanned = 0;

    while (scanned < limit) {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH', `${this.keyPrefix}${prefix}*`,
        'COUNT', String(Math.min(100, limit - scanned)),
      );
      cursor = nextCursor;
      for (const k of batch) {
        keys.push({ name: this.keyPrefix ? k.slice(this.keyPrefix.length) : k });
      }
      scanned += batch.length;
      if (cursor === '0') break;
      if (keys.length >= limit) break;
    }

    return { keys, list_complete: cursor === '0', cursor: cursor === '0' ? undefined : cursor };
  }
}

// ── ExecutionContext stub ─────────────────────────────────────────────────────
// CF's ctx.waitUntil() queues background tasks after response is sent.
// In Bun we fire-and-forget (response already sent by the time the promise runs).
function makeCtx() {
  return {
    waitUntil(p: Promise<unknown>): void { p.catch(e => console.error('[waitUntil]', e)); },
    passThroughOnException(): void {},
  };
}

// ── Redis connection ─────────────────────────────────────────────────────────
const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: false,
});
redis.on('error', (err) => console.error('[redis]', err));
redis.on('connect', () => console.log('[redis] connected'));

// ── Env object ───────────────────────────────────────────────────────────────
// Matches the Env interface in index.ts. NFTMAIL_DB is a local SQLite
// database via BunSQLiteD1, replacing Cloudflare D1 on Hetzner.
const env = {
  BACKEND: 'KV' as const,
  SURGE_TOKEN:              process.env.SURGE_TOKEN ?? '',
  GHOST_REGISTRY:           process.env.GHOST_REGISTRY ?? '',
  INBOX_KV:                 new RedisKVNamespaceShim(redis) as unknown as KVNamespace,
  GHOST_CALENDAR:           new RedisKVNamespaceShim(redis, 'calendar:') as unknown as KVNamespace,
  WEBHOOK_SECRET:           process.env.WEBHOOK_SECRET ?? '',
  WORKER_SECRET:            process.env.WORKER_SECRET ?? process.env.WEBHOOK_SECRET ?? '',
  MAILGUN_API_KEY:          process.env.MAILGUN_API_KEY ?? '',
  GM_MAILGUN_API_KEY:       process.env.GM_MAILGUN_API_KEY ?? '',
  MG_MAILGUN_API_KEY:       process.env.MG_MAILGUN_API_KEY ?? '',
  SEND_MAILGUN_API_KEY:     process.env.SEND_MAILGUN_API_KEY ?? '',
  MG_SENDING_MAILGUN_API_KEY: process.env.MG_SENDING_MAILGUN_API_KEY ?? '',
  IPFS_GATEWAY:             process.env.IPFS_GATEWAY ?? '',
  MASTER_SAFE_PUBKEY:       process.env.MASTER_SAFE_PUBKEY ?? '',
  ZEROG_ARCHIVER_URL:       process.env.ZEROG_ARCHIVER_URL ?? '',
  NFTMAIL_DB:               openNftmailDb() as unknown as D1Database,
};

// ── Bun HTTP server ───────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8787);

Bun.serve({
  port,
  async fetch(req: Request): Promise<Response> {
    const ctx = makeCtx();
    return worker.fetch(req, env as unknown as Parameters<typeof worker.fetch>[1], ctx as unknown as ExecutionContext);
  },
});

console.log(`[nftmail-worker] Bun ${Bun.version} listening on :${port}`);
console.log(`[nftmail-worker] Redis ${process.env.REDIS_HOST ?? '127.0.0.1'}:${process.env.REDIS_PORT ?? 6379}`);
