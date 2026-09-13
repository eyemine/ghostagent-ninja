#!/usr/bin/env node
/**
 * migrate-kv.mjs — Cloudflare KV -> Hetzner Redis migration (Layer 1 / Basic tier).
 *
 * Streams both KV namespaces straight from the Cloudflare REST API into Redis.
 * No intermediate cleartext file is written to disk (panopticon-proof).
 *
 * Namespace mapping (must match bun-entry.ts RedisKVNamespaceShim):
 *   INBOX_KV       -> Redis key as-is (no prefix)
 *   GHOST_CALENDAR -> Redis key with 'calendar:' prefix
 *
 * TTL policy (locked decision Q2=B):
 *   Keys that HAD an expiration in CF KV (i.e. decaying Basic inbox data) get a
 *   FRESH 8-day TTL from the migration moment. Keys without expiration stay
 *   permanent (profiles, resolver, tld, erc8004, beacons, payment burns).
 *
 * Usage (run ON the Hetzner box, or anywhere that can reach Redis + CF API):
 *   CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=xxx \
 *   node migrate-kv.mjs            # DRY RUN — reports counts, writes nothing
 *   node migrate-kv.mjs --commit   # actually writes to Redis
 *
 * Required env:
 *   CF_ACCOUNT_ID   Cloudflare account id
 *   CF_API_TOKEN    API token with "Workers KV Storage:Read" permission
 *   REDIS_HOST/REDIS_PORT/REDIS_PASSWORD  (defaults 127.0.0.1:6379, no password)
 *
 * Safe to re-run: it overwrites keys idempotently.
 */

import Redis from 'ioredis';

// ── namespace ids (from wrangler.toml) ───────────────────────────────────────
const NAMESPACES = [
  { binding: 'INBOX_KV',       id: 'd2177071c3fb4c48a1a22b36ee1a1baf', prefix: '' },
  { binding: 'GHOST_CALENDAR', id: '124768a09cbb48d08bb0a1893f3d2003', prefix: 'calendar:' },
];

const FRESH_TTL_SECONDS = 8 * 24 * 60 * 60; // 8-day decay window

const COMMIT = process.argv.includes('--commit');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('✗ Missing CF_ACCOUNT_ID or CF_API_TOKEN env vars.');
  process.exit(1);
}

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces`;
const cfHeaders = { Authorization: `Bearer ${CF_API_TOKEN}` };

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: false,
});
redis.on('error', (e) => console.error('[redis]', e.message));

async function cfJson(url) {
  const res = await fetch(url, { headers: cfHeaders });
  if (!res.ok) throw new Error(`CF API ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** List all keys in a namespace (paginated via cursor). Returns [{name, expiration?}]. */
async function listKeys(nsId) {
  const keys = [];
  let cursor = '';
  do {
    const url = `${CF_BASE}/${nsId}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await cfJson(url);
    if (!body.success) throw new Error(`listKeys failed: ${JSON.stringify(body.errors)}`);
    keys.push(...body.result);
    cursor = body.result_info?.cursor || '';
  } while (cursor);
  return keys;
}

/** Fetch a single key's raw value (string). Returns null on 404. */
async function getValue(nsId, key) {
  const url = `${CF_BASE}/${nsId}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: cfHeaders });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getValue ${res.status} for ${key}`);
  return res.text();
}

async function migrateNamespace(ns) {
  console.log(`\n── ${ns.binding} (${ns.id}) → Redis prefix "${ns.prefix}" ──`);
  const keys = await listKeys(ns.id);
  console.log(`   ${keys.length} keys found`);

  let migrated = 0, ttlApplied = 0, permanent = 0, skipped = 0;
  const CONCURRENCY = 16;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (k) => {
      const value = await getValue(ns.id, k.name);
      if (value === null) { skipped++; return; }
      const redisKey = ns.prefix + k.name;
      const hadExpiration = typeof k.expiration === 'number';
      if (COMMIT) {
        if (hadExpiration) {
          await redis.set(redisKey, value, 'EX', FRESH_TTL_SECONDS);
        } else {
          await redis.set(redisKey, value);
        }
      }
      migrated++;
      if (hadExpiration) ttlApplied++; else permanent++;
    }));
    process.stdout.write(`\r   processed ${Math.min(i + CONCURRENCY, keys.length)}/${keys.length}`);
  }
  console.log(`\n   ✓ ${migrated} migrated (${ttlApplied} with fresh 8-day TTL, ${permanent} permanent, ${skipped} skipped-empty)`);
  return { migrated, ttlApplied, permanent, skipped };
}

(async () => {
  console.log(COMMIT ? '★ COMMIT MODE — writing to Redis' : '● DRY RUN — no writes (pass --commit to write)');
  const totals = { migrated: 0, ttlApplied: 0, permanent: 0, skipped: 0 };
  for (const ns of NAMESPACES) {
    const r = await migrateNamespace(ns);
    for (const key of Object.keys(totals)) totals[key] += r[key];
  }
  console.log(`\n═══ TOTAL: ${totals.migrated} keys (${totals.ttlApplied} TTL'd, ${totals.permanent} permanent, ${totals.skipped} empty) ═══`);
  await redis.quit();
  process.exit(0);
})().catch((e) => { console.error('\n✗ migration error:', e); process.exit(1); });
