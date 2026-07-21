/**
 * bun-entry.ts — Hetzner/Bun runtime entry point for the nftmail worker.
 *
 * Single process, single file: ONE bun:sqlite Database backs both the D1 store
 * (agents/emails/…) and the KV shims (INBOX_KV / GHOST_CALENDAR). No Redis
 * daemon, no network port, no ACL surface. index.ts runs unchanged.
 *
 * Usage on Hetzner:
 *   bun run src/bun-entry.ts
 *
 * Required env vars:
 *   WEBHOOK_SECRET, WORKER_SECRET
 *   MAILGUN_API_KEY, MG_MAILGUN_API_KEY, MAILGUN_SIGNING_KEY
 *   PORT (default 8787)
 *
 * Optional:
 *   SQLITE_PATH (default /opt/ghostagent/bun-worker/data/nftmail.db)
 *   LIGHTHOUSE_API_KEY, SURGE_TOKEN, ZEROG_ARCHIVER_URL
 */

import worker from './index';
import { openNftmailDb } from './bun-sqlite-d1';
import { SqliteKVNamespaceShim } from './sqlite-kv';

// ── ExecutionContext stub ─────────────────────────────────────────────────────
// CF's ctx.waitUntil() queues background tasks after response is sent.
// In Bun we fire-and-forget (response already sent by the time the promise runs).
function makeCtx() {
  return {
    waitUntil(p: Promise<unknown>): void { p.catch(e => console.error('[waitUntil]', e)); },
    passThroughOnException(): void {},
  };
}

// ── SQLite: one file backs both the D1 store and the KV shims ─────────────────
const nftmailDb = openNftmailDb();
const sharedDb = nftmailDb.database;
const inboxKv = new SqliteKVNamespaceShim(sharedDb);
const calendarKv = new SqliteKVNamespaceShim(sharedDb, 'calendar:');

// Periodic TTL sweep (lazy expiry also runs on every read). One sweep clears
// all expired rows regardless of prefix, so calling it on one shim is enough.
const sweep = setInterval(() => {
  try {
    const n = inboxKv.sweepExpired();
    if (n > 0) console.log(`[kv] swept ${n} expired keys`);
  } catch (e) { console.error('[kv] sweep error', e); }
}, 5 * 60 * 1000);
(sweep as unknown as { unref?: () => void }).unref?.();

// ── Env object ───────────────────────────────────────────────────────────────
// Matches the Env interface in index.ts. NFTMAIL_DB is a local SQLite
// database via BunSQLiteD1, replacing Cloudflare D1 on Hetzner.
const env = {
  BACKEND: 'KV' as const,
  SURGE_TOKEN:              process.env.SURGE_TOKEN ?? '',
  GHOST_REGISTRY:           process.env.GHOST_REGISTRY ?? '',
  INBOX_KV:                 inboxKv as unknown as KVNamespace,
  GHOST_CALENDAR:           calendarKv as unknown as KVNamespace,
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
  NFTMAIL_DB:               nftmailDb as unknown as D1Database,
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
console.log(`[nftmail-worker] SQLite ${process.env.SQLITE_PATH ?? '/opt/ghostagent/bun-worker/data/nftmail.db'} (single file, no Redis)`);
