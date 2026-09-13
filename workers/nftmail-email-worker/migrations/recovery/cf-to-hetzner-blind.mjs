/**
 * One-time migration: copy blind inbox messages from Cloudflare worker KV
 * to Hetzner SQLite KV, merging into existing blind-index.
 *
 * Usage on Hetzner:
 *   cd /opt/ghostagent/bun-worker
 *   /root/.bun/bin/bun /tmp/cf-to-hetzner-blind.mjs --commit
 *
 * Without --commit, runs in dry-run mode (no writes).
 */
import { Database } from 'bun:sqlite';

const CF_WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';
const CF_WORKER_SECRET = 'bF2Nz7QzDGHh3jefxHUxnXpUzsQD';
const DB_PATH = 'data/nftmail.db';
const DRY_RUN = !process.argv.includes('--commit');

// Inboxes to migrate (add more as needed)
const INBOXES = ['ghostagent', 'ghostagent_', 'eyemine', 'eyemine_', 'victor', 'victor_'];

async function fetchCfInbox(localPart) {
  const res = await fetch(CF_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': CF_WORKER_SECRET },
    body: JSON.stringify({ action: 'getBlindInbox', localPart }),
  });
  if (!res.ok) {
    console.error(`  CF fetch failed for ${localPart}: ${res.status} ${await res.text().catch(() => '')}`);
    return [];
  }
  const data = await res.json();
  return data.messages || [];
}

async function migrate() {
  const db = new Database(DB_PATH);
  
  if (!DRY_RUN) {
    db.exec('BEGIN TRANSACTION');
  }

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const inbox of INBOXES) {
    console.log(`\n=== Migrating ${inbox} ===`);
    const cfMessages = await fetchCfInbox(inbox);
    console.log(`  CF returned ${cfMessages.length} messages`);

    if (cfMessages.length === 0) continue;

    // Read existing blind-index
    const idxRow = db.prepare('SELECT value FROM kv WHERE key = ?').get(`blind-index:${inbox}`);
    const existingIds = idxRow ? JSON.parse(idxRow.value) : [];
    const existingSet = new Set(existingIds);

    // Also check which IDs already have message data
    const newIds = [];
    let alreadyPresent = 0;

    for (const msg of cfMessages) {
      const id = msg.id;
      if (!id) continue;

      const kvKey = `blind:${inbox}:${id}`;
      
      // Check if message data already exists
      const existing = db.prepare('SELECT 1 FROM kv WHERE key = ?').get(kvKey);
      if (existing) {
        alreadyPresent++;
        continue;
      }

      // Store the message data
      if (!DRY_RUN) {
        db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(kvKey, JSON.stringify(msg));
      }
      
      if (!existingSet.has(id)) {
        newIds.push(id);
        existingSet.add(id);
      }
      totalMigrated++;
    }

    // Update blind-index if we added new IDs
    if (newIds.length > 0) {
      const mergedIds = [...existingIds, ...newIds];
      if (!DRY_RUN) {
        db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
          `blind-index:${inbox}`,
          JSON.stringify(mergedIds)
        );
      }
      console.log(`  Migrated: ${newIds.length} new messages, ${alreadyPresent} already present`);
      console.log(`  Index updated: ${existingIds.length} → ${mergedIds.length}`);
    } else {
      console.log(`  No new messages to migrate (${alreadyPresent} already present)`);
    }

    totalSkipped += alreadyPresent;
  }

  if (!DRY_RUN) {
    db.exec('COMMIT');
  }

  console.log(`\n=== Summary ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}`);
  console.log(`Total migrated: ${totalMigrated}`);
  console.log(`Total skipped (already present): ${totalSkipped}`);

  db.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
