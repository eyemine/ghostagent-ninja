/**
 * KVStore — portable key-value abstraction layer.
 *
 * Allows the worker to run on Cloudflare Workers today and migrate to
 * Deno Deploy (or any other runtime) with a ~50-line shim swap.
 *
 * Cloudflare: inject CloudflareKVStore wrapping KVNamespace
 * Deno:       inject DenoKVStore wrapping Deno.openKv()
 * Tests:      inject MemoryKVStore (in-process Map)
 *
 * Migration checklist:
 *   1. Replace `new CloudflareKVStore(env.INBOX_KV)` with `new DenoKVStore(kv, ['inbox'])`
 *   2. Remove `/// <reference types="@cloudflare/workers-types" />` from index.ts
 *   3. Replace the Cloudflare `export default { fetch }` handler with a Deno.serve() entry
 *   4. Set DENO_KV_PATH env var (or use hosted Deno KV) — no other changes needed
 */

// ─── Interface ───────────────────────────────────────────────────────────────

export interface KVListResult {
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete: boolean;
  cursor?: string;
}

export interface KVPutOptions {
  expirationTtl?: number;   // seconds from now
  expiration?: number;      // unix timestamp (seconds)
  metadata?: unknown;
}

export interface KVStore {
  get(key: string): Promise<string | null>;
  getJson<T = unknown>(key: string): Promise<T | null>;
  put(key: string, value: string, opts?: KVPutOptions): Promise<void>;
  putJson(key: string, value: unknown, opts?: KVPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<KVListResult>;
}

// ─── Cloudflare adapter (production) ─────────────────────────────────────────

export class CloudflareKVStore implements KVStore {
  constructor(private readonly ns: KVNamespace) {}

  get(key: string): Promise<string | null> {
    return this.ns.get(key);
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.ns.get(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  put(key: string, value: string, opts?: KVPutOptions): Promise<void> {
    return this.ns.put(key, value, opts as KVNamespacePutOptions);
  }

  putJson(key: string, value: unknown, opts?: KVPutOptions): Promise<void> {
    return this.ns.put(key, JSON.stringify(value), opts as KVNamespacePutOptions);
  }

  delete(key: string): Promise<void> {
    return this.ns.delete(key);
  }

  async list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<KVListResult> {
    const result = await this.ns.list(opts);
    return {
      keys: result.keys.map(k => ({ name: k.name, expiration: k.expiration, metadata: k.metadata })),
      list_complete: result.list_complete,
      cursor: (result as unknown as { cursor?: string }).cursor ?? undefined,
    };
  }
}

// ─── Deno KV adapter (migration target) ──────────────────────────────────────
//
// Usage (Deno Deploy entry point — replaces Cloudflare fetch handler):
//
//   import { DenoKVStore } from './kv.ts';
//   const kv = await Deno.openKv();
//   const store = new DenoKVStore(kv, ['inbox']);
//   Deno.serve(req => handler(req, { kv: store, calendarKv: new DenoKVStore(kv, ['calendar']), ... }));
//
// Key layout: Cloudflare key "blind:ghostagent:xyz" → Deno key ["inbox", "blind:ghostagent:xyz"]
// All semantics (get/put/delete/list) are identical.

export class DenoKVStore implements KVStore {
  constructor(
    private readonly kv: { get: Function; set: Function; delete: Function; list: Function },
    private readonly prefix: string[],
  ) {}

  private k(key: string): string[] { return [...this.prefix, key]; }

  async get(key: string): Promise<string | null> {
    const entry = await this.kv.get(this.k(key));
    if (entry?.value === undefined || entry.value === null) return null;
    return typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const entry = await this.kv.get(this.k(key));
    if (entry?.value === undefined || entry.value === null) return null;
    if (typeof entry.value === 'string') {
      try { return JSON.parse(entry.value) as T; } catch { return null; }
    }
    return entry.value as T;
  }

  async put(key: string, value: string, opts?: KVPutOptions): Promise<void> {
    const setOpts: Record<string, unknown> = {};
    if (opts?.expirationTtl) setOpts.expireIn = opts.expirationTtl * 1000;
    else if (opts?.expiration) setOpts.expireIn = (opts.expiration - Math.floor(Date.now() / 1000)) * 1000;
    await this.kv.set(this.k(key), value, setOpts);
  }

  async putJson(key: string, value: unknown, opts?: KVPutOptions): Promise<void> {
    return this.put(key, JSON.stringify(value), opts);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(this.k(key));
  }

  async list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<KVListResult> {
    const prefixKey = [...this.prefix, opts.prefix];
    const iter = await this.kv.list({ prefix: prefixKey, cursor: opts.cursor, limit: opts.limit ?? 1000 });
    const keys: KVListResult['keys'] = [];
    for await (const entry of iter) {
      const rawKey = entry.key.slice(this.prefix.length);
      keys.push({ name: rawKey.join(''), metadata: undefined });
    }
    return { keys, list_complete: true };
  }
}

// ─── In-memory adapter (unit tests / local dev) ──────────────────────────────

export class MemoryKVStore implements KVStore {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  private live(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) { this.store.delete(key); return null; }
    return entry.value;
  }

  async get(key: string): Promise<string | null> { return this.live(key); }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const raw = this.live(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  async put(key: string, value: string, opts?: KVPutOptions): Promise<void> {
    let expiresAt: number | undefined;
    if (opts?.expirationTtl) expiresAt = Date.now() + opts.expirationTtl * 1000;
    else if (opts?.expiration) expiresAt = opts.expiration * 1000;
    this.store.set(key, { value, expiresAt });
  }

  async putJson(key: string, value: unknown, opts?: KVPutOptions): Promise<void> {
    return this.put(key, JSON.stringify(value), opts);
  }

  async delete(key: string): Promise<void> { this.store.delete(key); }

  async list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<KVListResult> {
    const keys = [...this.store.entries()]
      .filter(([k]) => k.startsWith(opts.prefix) && this.live(k) !== null)
      .map(([k]) => ({ name: k }));
    return { keys, list_complete: true };
  }
}
