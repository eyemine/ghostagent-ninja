/**
 * bun-sqlite-d1.ts — Cloudflare D1Database duck-type backed by bun:sqlite.
 *
 * Implements the same .prepare().bind().run() / .all() / .first() / .batch()
 * surface used by D1Store in d1.ts so that index.ts runs unchanged on Hetzner.
 *
 * Schema is created on first open via initSchema().
 * DB file: SQLITE_PATH env var, default /opt/ghostagent/bun-worker/data/nftmail.db
 */

import { Database, type Statement } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';

// ── D1 result shape (matches Cloudflare D1Result) ────────────────────────────

interface D1ResultMeta {
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  duration: number;
  rows_read: number;
  rows_written: number;
}

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: D1ResultMeta;
}

// ── Prepared statement wrapper ────────────────────────────────────────────────

export class BunD1PreparedStatement {
  boundValues: unknown[] = [];

  constructor(
    public readonly db: Database,
    public readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.boundValues = values;
    return this;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt: Statement = this.db.prepare(this.sql);
    const row = stmt.get(...(this.boundValues as []) ) as T | null;
    if (!row) return null;
    if (colName) return ((row as Record<string, unknown>)[colName] ?? null) as T;
    return row;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt: Statement = this.db.prepare(this.sql);
    const r = stmt.run(...(this.boundValues as []));
    return {
      results: [],
      success: true,
      meta: {
        changes: r.changes,
        last_row_id: Number(r.lastInsertRowid),
        changed_db: r.changes > 0,
        duration: 0,
        rows_read: 0,
        rows_written: r.changes,
      },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt: Statement = this.db.prepare(this.sql);
    const rows = stmt.all(...(this.boundValues as [])) as T[];
    return {
      results: rows,
      success: true,
      meta: {
        changes: 0,
        last_row_id: 0,
        changed_db: false,
        duration: 0,
        rows_read: rows.length,
        rows_written: 0,
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt: Statement = this.db.prepare(this.sql);
    return stmt.values(...(this.boundValues as [])) as T[];
  }
}

// ── BunSQLiteD1 — the D1Database duck-type ────────────────────────────────────

export class BunSQLiteD1 {
  private readonly db: Database;

  /**
   * Accepts either a file path (opens/creates the DB) or an already-open
   * bun:sqlite Database (so the KV shim and D1 store can share ONE handle to
   * ONE file — the single-process/single-file sovereign target).
   */
  constructor(dbPathOrDb: string | Database) {
    if (typeof dbPathOrDb === 'string') {
      const dir = path.dirname(dbPathOrDb);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = new Database(dbPathOrDb, { create: true });
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      console.log(`[bun-sqlite-d1] opened ${dbPathOrDb}`);
    } else {
      this.db = dbPathOrDb;
    }
    this.initSchema();
  }

  /** Expose the underlying handle so a shared Database can back the KV shim too. */
  get database(): Database { return this.db; }

  prepare(sql: string): BunD1PreparedStatement {
    return new BunD1PreparedStatement(this.db, sql);
  }

  async batch<T = Record<string, unknown>>(
    statements: BunD1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    const txFn = this.db.transaction(() => {
      for (const s of statements) {
        const stmt: Statement = this.db.prepare(s.sql);
        const r = stmt.run(...(s.boundValues as []));
        results.push({
          results: [],
          success: true,
          meta: {
            changes: r.changes,
            last_row_id: Number(r.lastInsertRowid),
            changed_db: r.changes > 0,
            duration: 0,
            rows_read: 0,
            rows_written: r.changes,
          },
        });
      }
    });
    txFn();
    return results;
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        expires_at  INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv (expires_at);

      CREATE TABLE IF NOT EXISTS agents (
        label           TEXT PRIMARY KEY,
        controller      TEXT NOT NULL DEFAULT '',
        tld             TEXT,
        tier            TEXT NOT NULL DEFAULT 'basic',
        safe            TEXT,
        ecies_pubkey    TEXT,
        retention       TEXT NOT NULL DEFAULT '8-days',
        expires_at      INTEGER,
        story_ip        TEXT,
        origin_nft      TEXT,
        origin_image    TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        upgraded_at     INTEGER,
        zerog_root_hash     TEXT,
        zerog_archived_at   INTEGER
      );

      CREATE TABLE IF NOT EXISTS emails (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_label     TEXT NOT NULL,
        blind_id        TEXT NOT NULL UNIQUE,
        domain_prefix   TEXT NOT NULL DEFAULT '',
        encrypted_blob  TEXT NOT NULL,
        sender_hash     TEXT,
        subject_hash    TEXT,
        received_at     INTEGER NOT NULL,
        read            INTEGER NOT NULL DEFAULT 0,
        frozen          INTEGER NOT NULL DEFAULT 0,
        surge_allocation INTEGER,
        ttl_expires_at  INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_emails_agent ON emails (agent_label, received_at DESC);

      CREATE TABLE IF NOT EXISTS tier_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_label TEXT NOT NULL,
        from_tier   TEXT NOT NULL,
        to_tier     TEXT NOT NULL,
        tx_hash     TEXT,
        safe        TEXT,
        changed_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS identities (
        agent_label     TEXT NOT NULL,
        chain           TEXT NOT NULL,
        erc8004_agent_id INTEGER NOT NULL,
        PRIMARY KEY (agent_label, chain)
      );

      CREATE TABLE IF NOT EXISTS memory (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_label TEXT NOT NULL,
        session_id  TEXT,
        tag         TEXT,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory (agent_label, created_at DESC);

      CREATE TABLE IF NOT EXISTS memory_records (
        id                TEXT PRIMARY KEY,
        agent_label       TEXT NOT NULL,
        source            TEXT NOT NULL,
        instance          TEXT,
        kind              TEXT,
        scope             TEXT NOT NULL DEFAULT 'long-term',
        content_hash      TEXT,
        created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        lineage_parent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_chunks (
        id          TEXT PRIMARY KEY,
        record_id   TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_vectors (
        chunk_id TEXT PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
        vector   BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shared_context (
        namespace  TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        writer     TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `);

    // FTS5 for memory_chunks — non-fatal if unavailable
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts
        USING fts5(content, content=memory_chunks, content_rowid=rowid);
      `);
    } catch (e) {
      console.warn('[bun-sqlite-d1] FTS5 not available — memory search disabled:', e);
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function openNftmailDb(): BunSQLiteD1 {
  const dbPath = process.env.SQLITE_PATH ?? '/opt/ghostagent/bun-worker/data/nftmail.db';
  return new BunSQLiteD1(dbPath);
}
