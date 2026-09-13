#!/usr/bin/env bun
/**
 * verify-sqlite-kv.mjs — exercise the deployed SqliteKVNamespaceShim against the
 * live nftmail.db: put (permanent + TTL), get, list(prefix), lazy-expiry, delete
 * (burn). Uses a throwaway key namespace and cleans up after itself.
 */
import { openNftmailDb } from './bun-sqlite-d1';
import { SqliteKVNamespaceShim } from './sqlite-kv';

const kv = new SqliteKVNamespaceShim(openNftmailDb().database);
const P = '__verify__:';
let ok = 0, fail = 0;
const check = (name, cond) => { cond ? (ok++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`)); };

// 1. put + get (permanent)
await kv.put(`${P}a`, JSON.stringify({ hello: 'world' }));
check('put/get permanent', (await kv.get(`${P}a`)) === '{"hello":"world"}');

// 2. put with TTL (1s) still readable now
await kv.put(`${P}b`, 'ttl-value', { expirationTtl: 1 });
check('put/get with TTL (live)', (await kv.get(`${P}b`)) === 'ttl-value');

// 3. list by prefix
const listed = await kv.list({ prefix: P });
check('list prefix finds >=2 keys', listed.keys.length >= 2);

// 4. lazy expiry: wait 1.2s, TTL key should be gone
await new Promise((r) => setTimeout(r, 1200));
check('TTL key expired lazily', (await kv.get(`${P}b`)) === null);

// 5. delete (burn) + confirm gone
await kv.delete(`${P}a`);
check('delete/burn removes key', (await kv.get(`${P}a`)) === null);

// cleanup any stragglers
for (const k of (await kv.list({ prefix: P })).keys) await kv.delete(k.name);

console.log(`\n═══ ${ok} passed, ${fail} failed ═══`);
process.exit(fail ? 1 : 0);
