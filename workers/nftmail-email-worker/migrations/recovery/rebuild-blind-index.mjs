#!/usr/bin/env node
/**
 * rebuild-blind-index.mjs — repair desynced Redis inbox indexes.
 *
 * PROBLEM: `blind-index:{inbox}` holds the list of message ids the inbox read
 * path walks. Some indexes were truncated/overwritten (e.g. blind-index:ghostagent
 * listed 1 id while 91 blind:ghostagent:* messages exist), so messages are present
 * in Redis but invisible in the UI ("lost history").
 *
 * FIX: For every blind:{inbox}:{blindId} key, group by {inbox} and rebuild
 * blind-index:{inbox} as the UNION of (existing index ∪ discovered ids), sorted
 * chronologically by the timestamp embedded in the blindId. Purely ADDITIVE — no
 * message or index entry is ever removed. The index TTL is set to the longest
 * remaining TTL among its member messages (permanent if any member is permanent),
 * so the index never outlives / under-lives its messages.
 *
 * Key shapes handled:
 *   blind:{inbox}:{blindId}            -> index blind-index:{inbox}
 *   blind:ghostmail:{name}:{blindId}   -> index blind-index:ghostmail:{name}
 *   blind:{name}_:{blindId}            -> index blind-index:{name}_   (agent alias)
 * blindId always looks like `blind-<ms>-<hex>` (the last ':' segment).
 *
 * Usage (run on Hetzner; Redis is local):
 *   REDIS_PASSWORD=... bun run rebuild-blind-index.mjs            # DRY RUN
 *   REDIS_PASSWORD=... bun run rebuild-blind-index.mjs --commit   # writes indexes
 *
 * Optional: FILTER=ghostagent  limits to inbox keys containing the substring.
 */

import Redis from 'ioredis';

const COMMIT = process.argv.includes('--commit');
const FILTER = process.env.FILTER || '';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
redis.on('error', (e) => console.error('[redis]', e.message));

/** Extract embedded ms timestamp from a blindId like `blind-1783512886400-ed0db543`. */
function tsOf(blindId) {
  const m = /^blind-(\d+)-/.exec(blindId);
  return m ? Number(m[1]) : 0;
}

/** Scan all keys matching a pattern (non-blocking, cursor-based). */
async function scanAll(pattern) {
  const out = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = next;
    out.push(...batch);
  } while (cursor !== '0');
  return out;
}

(async () => {
  console.log(COMMIT ? '★ COMMIT MODE — will write blind-index:* keys' : '● DRY RUN — no writes (pass --commit)');
  if (FILTER) console.log(`   filter: inbox contains "${FILTER}"`);

  const keys = await scanAll('blind:*');
  console.log(`\nFound ${keys.length} blind:* message keys`);

  // Group discovered blindIds by inbox key.
  const byInbox = new Map(); // inbox -> Set<blindId>
  for (const key of keys) {
    // strip leading "blind:" then split; last segment is the blindId.
    const rest = key.slice('blind:'.length);
    const idx = rest.lastIndexOf(':');
    if (idx < 0) continue;
    const inbox = rest.slice(0, idx);
    const blindId = rest.slice(idx + 1);
    if (!blindId.startsWith('blind-')) continue;
    if (FILTER && !inbox.includes(FILTER)) continue;
    if (!byInbox.has(inbox)) byInbox.set(inbox, new Set());
    byInbox.get(inbox).add(blindId);
  }

  console.log(`Grouped into ${byInbox.size} inbox(es)\n`);

  let repaired = 0, unchanged = 0, totalAdded = 0;
  for (const [inbox, idSet] of [...byInbox.entries()].sort()) {
    const indexKey = `blind-index:${inbox}`;
    let existing = [];
    try {
      const raw = await redis.get(indexKey);
      if (raw) existing = JSON.parse(raw);
    } catch { /* corrupt/absent index -> rebuild from scratch */ }

    const union = new Set(existing);
    let added = 0;
    for (const id of idSet) if (!union.has(id)) { union.add(id); added++; }

    // Chronological order (oldest first) — matches how the worker appends.
    const merged = [...union].sort((a, b) => tsOf(a) - tsOf(b));

    if (added === 0 && merged.length === existing.length) {
      unchanged++;
      continue;
    }

    // Compute index TTL = max remaining TTL across member messages (-1 = permanent).
    let maxTtl = 0, anyPermanent = false;
    for (const id of merged) {
      const t = await redis.ttl(`blind:${inbox}:${id}`);
      if (t === -1) { anyPermanent = true; break; }
      if (t > maxTtl) maxTtl = t;
    }

    console.log(`  ${indexKey}: existing=${existing.length} discovered=${idSet.size} → merged=${merged.length} (+${added})  ttl=${anyPermanent ? 'persist' : maxTtl + 's'}`);

    if (COMMIT) {
      const payload = JSON.stringify(merged);
      if (anyPermanent || maxTtl <= 0) await redis.set(indexKey, payload);
      else await redis.set(indexKey, payload, 'EX', maxTtl);
    }
    repaired++;
    totalAdded += added;
  }

  console.log(`\n═══ ${repaired} index(es) ${COMMIT ? 'repaired' : 'would be repaired'}, ${unchanged} already in sync, ${totalAdded} message ids recovered ═══`);
  await redis.quit();
  process.exit(0);
})().catch((e) => { console.error('\n✗ recovery error:', e); process.exit(1); });
