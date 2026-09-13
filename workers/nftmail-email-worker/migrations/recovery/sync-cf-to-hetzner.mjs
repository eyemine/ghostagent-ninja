/**
 * Periodic sync: copy new blind inbox messages from Cloudflare worker
 * to Hetzner SQLite KV. Run via cron every 5 minutes.
 *
 * Usage: /root/.bun/bin/bun /opt/ghostagent/bun-worker/sync-cf-to-hetzner.mjs
 */
import { Database } from 'bun:sqlite';

const CF_WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';
const CF_WORKER_SECRET = 'bF2Nz7QzDGHh3jefxHUxnXpUzsQD';
const DB_PATH = '/opt/ghostagent/bun-worker/data/nftmail.db';

const INBOXES = ['ghostagent', 'ghostagent_', 'eyemine', 'eyemine_', 'victor', 'victor_'];

async function fetchCfInbox(localPart) {
  const res = await fetch(CF_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': CF_WORKER_SECRET },
    body: JSON.stringify({ action: 'getBlindInbox', localPart }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

async function sync() {
  const db = new Database(DB_PATH);
  db.exec('BEGIN TRANSACTION');

  let totalNew = 0;

  for (const inbox of INBOXES) {
    const cfMessages = await fetchCfInbox(inbox);
    if (cfMessages.length === 0) continue;

    const idxRow = db.prepare('SELECT value FROM kv WHERE key = ?').get(`blind-index:${inbox}`);
    const existingIds = idxRow ? JSON.parse(idxRow.value) : [];
    const existingSet = new Set(existingIds);

    const newIds = [];
    for (const msg of cfMessages) {
      const id = msg.id;
      if (!id) continue;
      const kvKey = `blind:${inbox}:${id}`;
      const existing = db.prepare('SELECT 1 FROM kv WHERE key = ?').get(kvKey);
      if (existing) continue;

      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(kvKey, JSON.stringify(msg));
      if (!existingSet.has(id)) {
        newIds.push(id);
        existingSet.add(id);
      }
      totalNew++;
    }

    if (newIds.length > 0) {
      const mergedIds = [...existingIds, ...newIds];
      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
        `blind-index:${inbox}`,
        JSON.stringify(mergedIds)
      );
    }
  }

  db.exec('COMMIT');
  db.close();

  if (totalNew > 0) {
    console.log(`[${new Date().toISOString()}] Synced ${totalNew} new messages from CF to Hetzner`);
  }
}

sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
