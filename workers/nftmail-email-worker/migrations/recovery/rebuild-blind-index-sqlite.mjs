#!/usr/bin/env bun
/**
 * rebuild-blind-index-sqlite.mjs — repair desynced inbox indexes on the SQLite backend.
 *
 * SQLite twin of rebuild-blind-index.mjs (which targets Redis). After the
 * Redis → Bun-SQLite consolidation, the live KV lives in the `kv` table of
 * data/nftmail.db (SqliteKVNamespaceShim). Some `blind-index:{inbox}` values were
 * truncated during migration, so `blind:{inbox}:{blindId}` messages are present but
 * invisible in the UI ("lost history", e.g. ghostagent showing 1 of 91).
 *
 * FIX: For every blind:{inbox}:{blindId} row, group by {inbox} and rebuild
 * blind-index:{inbox} as the UNION of (existing index ∪ discovered ids), sorted
 * chronologically by the ms embedded in the blindId. Purely ADDITIVE — nothing is
 * removed. The rebuilt index inherits the longest remaining expiry among its member
 * messages (permanent if any member is permanent) so it never outlives / under-lives
 * its messages.
 *
 * Key shapes handled:
 *   blind:{inbox}:{blindId}            -> blind-index:{inbox}
 *   blind:ghostmail:{name}:{blindId}   -> blind-index:ghostmail:{name}
 *   blind:{name}_:{blindId}            -> blind-index:{name}_   (agent alias)
 * blindId always looks like `blind-<ms>-<hex>` (the last ':' segment).
 *
 * Usage (run on Hetzner):
 *   SQLITE_PATH=/opt/ghostagent/bun-worker/data/nftmail.db \
 *     bun run rebuild-blind-index-sqlite.mjs            # DRY RUN
 *   SQLITE_PATH=/opt/ghostagent/bun-worker/data/nftmail.db \
 *     bun run rebuild-blind-index-sqlite.mjs --commit   # writes indexes
 *
 * Optional: FILTER=ghostagent  limits to inbox keys containing the substring.
 */

import { Database } from 'bun:sqlite';

const COMMIT = process.argv.includes('--commit');
const FILTER = process.env.FILTER || '';
const DB_PATH = process.env.SQLITE_PATH || '/opt/ghostagent/bun-worker/data/nftmail.db';

const db = new Database(DB_PATH, { readwrite: true });

/** Extract embedded ms timestamp from a blindId like `blind-1783512886400-ed0db543`. */
function tsOf(blindId) {
  const m = /^blind-(\d+)-/.exec(blindId);
  return m ? Number(m[1]) : 0;
}

const now = Date.now();

// Only consider live (non-expired) blind rows — expired ones are conceptually gone and
// the shim would lazily delete them on read anyway. expires_at is ms epoch, NULL = permanent.
const blindRows = db
  .query("SELECT key, expires_at AS expiresAt FROM kv WHERE key LIKE 'blind:%' AND (expires_at IS NULL OR expires_at > ?)")
  .all(now);

console.log(COMMIT ? '★ COMMIT MODE — will write blind-index:* keys' : '● DRY RUN — no writes (pass --commit)');
if (FILTER) console.log(`   filter: inbox contains "${FILTER}"`);
console.log(`   db: ${DB_PATH}`);
console.log(`\nFound ${blindRows.length} live blind:* message rows`);

// Group discovered blindIds by inbox, tracking each message's expiry for TTL inheritance.
const byInbox = new Map(); // inbox -> Map<blindId, expiresAt|null>
for (const { key, expiresAt } of blindRows) {
  const rest = key.slice('blind:'.length);
  const idx = rest.lastIndexOf(':');
  if (idx < 0) continue;
  const inbox = rest.slice(0, idx);
  const blindId = rest.slice(idx + 1);
  if (!blindId.startsWith('blind-')) continue;
  if (FILTER && !inbox.includes(FILTER)) continue;
  if (!byInbox.has(inbox)) byInbox.set(inbox, new Map());
  byInbox.get(inbox).set(blindId, expiresAt ?? null);
}

console.log(`Grouped into ${byInbox.size} inbox(es)\n`);

const getStmt = db.query('SELECT value FROM kv WHERE key = ?');
const upsertStmt = db.query(
  'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ' +
  'ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
);

let repaired = 0, unchanged = 0, totalAdded = 0;
for (const [inbox, idMap] of [...byInbox.entries()].sort()) {
  const indexKey = `blind-index:${inbox}`;
  let existing = [];
  try {
    const row = getStmt.get(indexKey);
    if (row?.value) existing = JSON.parse(row.value);
  } catch { /* corrupt/absent index -> rebuild from scratch */ }

  const union = new Set(existing);
  let added = 0;
  for (const id of idMap.keys()) if (!union.has(id)) { union.add(id); added++; }

  const merged = [...union].sort((a, b) => tsOf(a) - tsOf(b));

  if (added === 0 && merged.length === existing.length) {
    unchanged++;
    continue;
  }

  // Index expiry = max member expiry (NULL/permanent wins).
  let anyPermanent = false;
  let maxExpiresAt = 0;
  for (const id of merged) {
    const e = idMap.has(id) ? idMap.get(id) : null;
    if (e == null) { anyPermanent = true; break; }
    if (e > maxExpiresAt) maxExpiresAt = e;
  }
  const indexExpiresAt = anyPermanent ? null : (maxExpiresAt > 0 ? maxExpiresAt : null);

  console.log(`  ${indexKey}: existing=${existing.length} discovered=${idMap.size} → merged=${merged.length} (+${added})  expiry=${indexExpiresAt == null ? 'persist' : new Date(indexExpiresAt).toISOString()}`);

  if (COMMIT) {
    upsertStmt.run(indexKey, JSON.stringify(merged), indexExpiresAt);
  }
  repaired++;
  totalAdded += added;
}

console.log(`\n═══ ${repaired} index(es) ${COMMIT ? 'repaired' : 'would be repaired'}, ${unchanged} already in sync, ${totalAdded} message ids recovered ═══`);
db.close();
