#!/usr/bin/env node
/**
 * migrate-kv-wrangler.mjs — Cloudflare KV -> Hetzner Redis, via `wrangler` (OAuth).
 *
 * Use this variant when you authenticated with `wrangler login` (no API token).
 * It shells out to wrangler for list+get and writes STRAIGHT into Redis — no
 * intermediate files, so there are zero cleartext artifacts left on disk.
 *
 * Namespace mapping (must match bun-entry.ts RedisKVNamespaceShim):
 *   INBOX_KV       -> Redis key as-is
 *   GHOST_CALENDAR -> Redis key with 'calendar:' prefix
 *
 * TTL policy (locked Q2=B): keys that HAD an expiration in CF get a fresh 8-day
 * TTL; keys without expiration stay permanent.
 *
 * Run from the worker root (needs wrangler + wrangler.toml + an active login):
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=xxx \
 *   node migrations/cf-to-hetzner/migrate-kv-wrangler.mjs            # DRY RUN
 *   node migrations/cf-to-hetzner/migrate-kv-wrangler.mjs --commit   # writes Redis
 *
 * If your wrangler is older and rejects `kv key`, set WRANGLER_COLON=1 to use the
 * legacy `kv:key` syntax.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Redis from 'ioredis';

const execFileP = promisify(execFile);

const NAMESPACES = [
  { binding: 'INBOX_KV',       id: 'd2177071c3fb4c48a1a22b36ee1a1baf', prefix: '' },
  { binding: 'GHOST_CALENDAR', id: '124768a09cbb48d08bb0a1893f3d2003', prefix: 'calendar:' },
];

const FRESH_TTL_SECONDS = 8 * 24 * 60 * 60;
const COMMIT = process.argv.includes('--commit');
const COLON = process.env.WRANGLER_COLON === '1';
const CONCURRENCY = 8;

// Only connect to Redis when committing — dry-run talks to Cloudflare only.
const redis = COMMIT
  ? new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    })
  : null;
if (redis) redis.on('error', (e) => console.error('[redis]', e.message));

function wrangler(args) {
  // npx ensures we use the repo-local wrangler; large maxBuffer for big values.
  return execFileP('npx', ['wrangler', ...args], { maxBuffer: 64 * 1024 * 1024 });
}

async function listKeys(nsId) {
  const args = COLON
    ? ['kv:key', 'list', `--namespace-id=${nsId}`]
    : ['kv', 'key', 'list', '--namespace-id', nsId];
  const { stdout } = await wrangler(args);
  return JSON.parse(stdout); // [{ name, expiration? }]
}

async function getValue(nsId, key) {
  const args = COLON
    ? ['kv:key', 'get', key, `--namespace-id=${nsId}`]
    : ['kv', 'key', 'get', key, '--namespace-id', nsId];
  try {
    const { stdout } = await wrangler(args);
    return stdout;
  } catch (e) {
    if (/not found|404/i.test(String(e?.stderr || e?.message))) return null;
    throw e;
  }
}

async function migrateNamespace(ns) {
  console.log(`\n── ${ns.binding} (${ns.id}) → Redis prefix "${ns.prefix}" ──`);
  const keys = await listKeys(ns.id);
  console.log(`   ${keys.length} keys found`);
  let migrated = 0, ttlApplied = 0, permanent = 0, skipped = 0;

  // DRY RUN: no value fetch (each `wrangler kv key get` spawns a process ~1-2s).
  // We only need counts + TTL flags from the key list.
  if (!COMMIT) {
    for (const k of keys) {
      if (typeof k.expiration === 'number') ttlApplied++; else permanent++;
    }
    migrated = ttlApplied + permanent;
    console.log(`   (dry-run: values not fetched) ${migrated} keys (${ttlApplied} would get fresh 8-day TTL, ${permanent} permanent)`);
    return { migrated, ttlApplied, permanent, skipped };
  }

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (k) => {
      const value = await getValue(ns.id, k.name);
      if (value === null) { skipped++; return; }
      const redisKey = ns.prefix + k.name;
      const hadExpiration = typeof k.expiration === 'number';
      if (hadExpiration) await redis.set(redisKey, value, 'EX', FRESH_TTL_SECONDS);
      else await redis.set(redisKey, value);
      migrated++;
      if (hadExpiration) ttlApplied++; else permanent++;
    }));
    process.stdout.write(`\r   processed ${Math.min(i + CONCURRENCY, keys.length)}/${keys.length}`);
  }
  console.log(`\n   ✓ ${migrated} migrated (${ttlApplied} fresh-TTL, ${permanent} permanent, ${skipped} empty)`);
  return { migrated, ttlApplied, permanent, skipped };
}

(async () => {
  console.log(COMMIT ? '★ COMMIT MODE — writing to Redis' : '● DRY RUN — no writes (pass --commit)');
  const totals = { migrated: 0, ttlApplied: 0, permanent: 0, skipped: 0 };
  for (const ns of NAMESPACES) {
    const r = await migrateNamespace(ns);
    for (const key of Object.keys(totals)) totals[key] += r[key];
  }
  console.log(`\n═══ TOTAL: ${totals.migrated} keys (${totals.ttlApplied} TTL'd, ${totals.permanent} permanent, ${totals.skipped} empty) ═══`);
  if (redis) await redis.quit();
  process.exit(0);
})().catch((e) => { console.error('\n✗ migration error:', e?.stderr || e); process.exit(1); });
