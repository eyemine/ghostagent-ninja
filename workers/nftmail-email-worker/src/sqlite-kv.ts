/**
 * sqlite-kv.ts — a Cloudflare KVNamespace duck-type backed by bun:sqlite.
 *
 * Replaces the Redis-backed shim so the whole worker runs as a single process
 * against a single file (data/nftmail.db). No daemon, no port, no ACL surface.
 *
 * Burn semantics are a plain DELETE (atomic, durable, no cooperating process
 * required). TTL is stored as an absolute `expires_at` (ms epoch) and enforced
 * lazily on read plus an optional periodic sweep.
 *
 * The `kv` table is created by BunSQLiteD1.initSchema() on the shared handle:
 *   kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NULL)
 */

import type { Database } from 'bun:sqlite';

type PutOptions = { expirationTtl?: number; expiration?: number };

export class SqliteKVNamespaceShim {
  private readonly getStmt;
  private readonly upsertStmt;
  private readonly delStmt;

  constructor(
    private readonly db: Database,
    private readonly keyPrefix = '',
  ) {
    // Prepared statements are reused for every call (bun:sqlite caches the plan).
    this.getStmt = db.query('SELECT value, expires_at AS expiresAt FROM kv WHERE key = ?');
    this.upsertStmt = db.query(
      'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    );
    this.delStmt = db.query('DELETE FROM kv WHERE key = ?');
  }

  private k(key: string): string { return this.keyPrefix + key; }

  async get(key: string): Promise<string | null> {
    const full = this.k(key);
    const row = this.getStmt.get(full) as { value: string; expiresAt: number | null } | null;
    if (!row) return null;
    if (row.expiresAt != null && row.expiresAt <= Date.now()) {
      this.delStmt.run(full); // lazy expiry
      return null;
    }
    return row.value;
  }

  async getWithMetadata<M = unknown>(key: string): Promise<{ value: string | null; metadata: M | null }> {
    return { value: await this.get(key), metadata: null };
  }

  private expiresFrom(options?: PutOptions): number | null {
    if (options?.expirationTtl) return Date.now() + Math.floor(options.expirationTtl) * 1000;
    if (options?.expiration) return Math.floor(options.expiration) * 1000; // CF: seconds epoch
    return null;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: PutOptions,
  ): Promise<void> {
    const str = typeof value === 'string'
      ? value
      : Buffer.from(value as ArrayBuffer).toString('utf8');
    this.upsertStmt.run(this.k(key), str, this.expiresFrom(options));
  }

  async putJson(key: string, value: unknown, options?: PutOptions): Promise<void> {
    return this.put(key, JSON.stringify(value), options);
  }

  async delete(key: string): Promise<void> {
    this.delStmt.run(this.k(key));
  }

  async list<M = unknown>(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: M }>; list_complete: boolean; cursor?: string }> {
    const prefix = this.keyPrefix + (options?.prefix ?? '');
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 1000));
    const offset = options?.cursor ? Number(options.cursor) || 0 : 0;
    const now = Date.now();

    // Fetch limit+1 to determine list_complete. Skip expired rows.
    const rows = this.db.query(
      'SELECT key, expires_at AS expiresAt FROM kv ' +
      'WHERE key LIKE ?1 ESCAPE \'\\\' AND (expires_at IS NULL OR expires_at > ?2) ' +
      'ORDER BY key LIMIT ?3 OFFSET ?4',
    ).all(this.likePrefix(prefix), now, limit + 1, offset) as Array<{ key: string; expiresAt: number | null }>;

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const keys = page.map((r) => ({
      name: this.keyPrefix ? r.key.slice(this.keyPrefix.length) : r.key,
      ...(r.expiresAt != null ? { expiration: Math.floor(r.expiresAt / 1000) } : {}),
    }));

    return {
      keys,
      list_complete: !hasMore,
      cursor: hasMore ? String(offset + limit) : undefined,
    };
  }

  /** Escape LIKE metacharacters in the prefix and append the wildcard. */
  private likePrefix(prefix: string): string {
    return prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  }

  /** Delete all rows whose absolute expiry has passed. Returns rows removed. */
  sweepExpired(): number {
    const res = this.db.query('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now());
    return Number((res as { changes?: number }).changes ?? 0);
  }
}
