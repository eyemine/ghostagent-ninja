#!/usr/bin/env bun
/**
 * redis-to-sqlite.mjs — one-time consolidation: copy every Redis key into the
 * SQLite `kv` table (data/nftmail.db), so the worker can drop Redis entirely.
 *
 * - Preserves the exact key names (incl. the `calendar:` prefix), so the
 *   SqliteKVNamespaceShim (same prefixes) reads them unchanged.
 * - Preserves TTLs: Redis TTL seconds -> absolute expires_at (ms epoch).
 * - Normalises the legacy base64 blobs: values that are base64-encoded JSON are
 *   decoded to plain JSON on the way in (same detection as the shim), so the
 *   SQLite store holds clean plain values and the base64 bug can never recur.
 *
 * Run ON Hetzner (needs Redis + write access to the .db file), with bun:
 *   REDIS_PASSWORD=... bun run redis-to-sqlite.mjs            # DRY RUN (counts)
 *   REDIS_PASSWORD=... bun run redis-to-sqlite.mjs --commit   # writes kv rows
 *
 * Env: REDIS_HOST/PORT/PASSWORD, SQLITE_PATH (default the worker's data/nftmail.db)
 */

import Redis from 'ioredis';
import { Database } from 'bun:sqlite';

const COMMIT = process.argv.includes('--commit');
const SQLITE_PATH = process.env.SQLITE_PATH ?? '/opt/ghostagent/bun-worker/data/nftmail.db';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
redis.on('error', (e) => console.error('[redis]', e.message));

/** Same detection the shim uses: only decode genuine base64-encoded JSON. */
function normalise(val) {
  if (val === null) return null;
  if (/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(val) && !/^[\[{"]/.test(val)) {
    try {
      const decoded = Buffer.from(val, 'base64').toString('utf-8');
      JSON.parse(decoded);
      return decoded;
    } catch { /* not base64 JSON */ }
  }
  return val;
}

async function scanAll() {
  const out = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'COUNT', 1000);
    cursor = next;
    out.push(...batch);
  } while (cursor !== '0');
  return out;
}

(async () => {
  console.log(COMMIT ? '★ COMMIT MODE — writing kv rows' : '● DRY RUN — no writes (pass --commit)');
  console.log(`   sqlite: ${SQLITE_PATH}`);

  const keys = await scanAll();
  console.log(`\nFound ${keys.length} Redis keys`);

  const db = new Database(SQLITE_PATH, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv (expires_at);');
  const upsert = db.query(
    'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
  );

  let copied = 0, decoded = 0, withTtl = 0, skipped = 0, nonString = 0;
  const CHUNK = 500;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = keys.slice(i, i + CHUNK);
    // Pipeline GET + TTL for the batch.
    const pipe = redis.pipeline();
    for (const k of batch) { pipe.get(k); pipe.ttl(k); }
    const res = await pipe.exec();

    const rows = [];
    for (let j = 0; j < batch.length; j++) {
      const key = batch[j];
      const [gErr, rawVal] = res[j * 2];
      const [tErr, ttl] = res[j * 2 + 1];
      if (gErr || tErr) { skipped++; continue; }
      if (rawVal === null) { skipped++; continue; }
      if (typeof rawVal !== 'string') { nonString++; continue; } // e.g. non-string types (none expected)
      const norm = normalise(rawVal);
      if (norm !== rawVal) decoded++;
      const expiresAt = typeof ttl === 'number' && ttl > 0 ? Date.now() + ttl * 1000 : null;
      if (expiresAt !== null) withTtl++;
      rows.push([key, norm, expiresAt]);
    }

    if (COMMIT && rows.length) {
      const tx = db.transaction((rs) => { for (const r of rs) upsert.run(r[0], r[1], r[2]); });
      tx(rows);
    }
    copied += rows.length;
    process.stdout.write(`\r   processed ${Math.min(i + CHUNK, keys.length)}/${keys.length}`);
  }

  const total = COMMIT ? db.query('SELECT COUNT(*) AS c FROM kv').get().c : null;
  console.log(`\n\n═══ ${COMMIT ? 'copied' : 'would copy'} ${copied} keys ` +
    `(${decoded} base64→plain, ${withTtl} with TTL, ${skipped} skipped/null, ${nonString} non-string) ═══`);
  if (COMMIT) console.log(`   kv table now holds ${total} rows`);

  db.close();
  await redis.quit();
  process.exit(0);
})().catch((e) => { console.error('\n✗ error:', e); process.exit(1); });
