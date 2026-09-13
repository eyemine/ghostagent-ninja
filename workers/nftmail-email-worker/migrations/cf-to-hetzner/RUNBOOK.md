# Cloudflare → Hetzner Migration Runbook

Full sovereign cutover of the nftmail backend. Move all data + inbound mail off
Cloudflare onto Hetzner (Redis + Bun SQLite), then retire the CF worker for mail.

**Locked model** (see also the "migration model (LOCKED)" memory):

| Tier | Store (CF) | Store (Hetzner) | Retention |
|---|---|---|---|
| Free / Basic (incl. `*.picoclaw.gno`, SDK-created) | KV | **Redis** | 8-day decay (fresh TTL on migration) |
| LITE / PUPA / IMAGO / PRO / ghost | D1 | **Bun SQLite** | infinite |

Three data copies: KV `INBOX_KV` → Redis, KV `GHOST_CALENDAR` → Redis (`calendar:`),
D1 `nftmail-db` → SQLite `/opt/ghostagent/bun-worker/data/nftmail.db`.

---

## 0. Prerequisites

- **Auth:** `wrangler login` on your laptop (OAuth). *(Alternative: a scoped API token
  with Workers KV Storage:Read + D1:Read — then use `migrate-kv.mjs` instead of the
  `-wrangler` variant.)*
- SSH to Hetzner (`root@46.225.158.75`), Redis password (in worker `.env`).
- Bun worker running from `/opt/ghostagent/bun-worker` (its SQLite schema must exist).
- `sqlite3` + `node` (>=18) on Hetzner; `ioredis` where you run the KV script (worker root).

> Do the whole thing in a low-traffic window. There are few users, but treat it as prod.
> Cleartext during migration is fine; the rule is **no cleartext artifacts left behind** —
> the KV script streams straight to Redis (no files); the D1 dump is shredded after import.

---

## 1. Freeze writes (optional but safest)

Temporarily stop the CF worker from accepting new inbound so the snapshot is stable.
Simplest: proceed fast; new inbound during the window will be picked up because we
re-run the KV copy right before flipping Mailgun (step 6).

## 2. Migrate KV → Redis  (Layer 1) — OAuth path

Run on your **laptop** (wrangler OAuth lives here). Open an SSH tunnel so the script
reaches Hetzner Redis as `127.0.0.1:6379`:

```bash
# Terminal A — keep open: tunnel local 6379 -> Hetzner Redis
ssh -N -L 6379:127.0.0.1:6379 root@46.225.158.75

# Terminal B — from the worker root
cd workers/nftmail-email-worker
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=...   # Hetzner Redis pw

node migrations/cf-to-hetzner/migrate-kv-wrangler.mjs            # DRY RUN
node migrations/cf-to-hetzner/migrate-kv-wrangler.mjs --commit   # writes to Redis
```

Expect: `INBOX_KV` count >> `GHOST_CALENDAR`; keys that had TTL get a fresh 8-day TTL,
profiles/resolver keys stay permanent. (If wrangler is old and rejects `kv key`, set
`WRANGLER_COLON=1`.)

## 3. Export D1 → import into SQLite  (Layer 2)

On your laptop (needs wrangler auth):

```bash
cd workers/nftmail-email-worker
./migrations/cf-to-hetzner/export-d1.sh          # → nftmail-d1-data.sql (contains mail!)
scp migrations/cf-to-hetzner/nftmail-d1-data.sql root@46.225.158.75:/tmp/
shred -u migrations/cf-to-hetzner/nftmail-d1-data.sql   # remove local cleartext
```

On Hetzner:

```bash
SQLITE_PATH=/opt/ghostagent/bun-worker/data/nftmail.db \
  ./import-d1-to-sqlite.sh /tmp/nftmail-d1-data.sql
shred -u /tmp/nftmail-d1-data.sql
```

## 4. Verify

```bash
# Redis (Layer 1)
REDIS_PASSWORD=... node verify.mjs

# SQLite (Layer 2) — confirm paid inboxes present, e.g. ghostagent.molt.gno
sqlite3 /opt/ghostagent/bun-worker/data/nftmail.db \
  "SELECT agent_label, COUNT(*) FROM emails GROUP BY agent_label ORDER BY 2 DESC LIMIT 20;"
sqlite3 /opt/ghostagent/bun-worker/data/nftmail.db \
  "SELECT label, tier FROM agents WHERE tier != 'basic' ORDER BY label;"
```

Gate: do NOT proceed unless `molt.gno`/paid inboxes show expected email counts and
`verify.mjs` shows profiles + tiers for the spot-check agents.

## 5. Point the app at Hetzner

On Hetzner `/opt/nftmail/.env` (the Next.js app):

```
NFTMAIL_WORKER_URL=https://worker.nftmail.box
```

Revert the temporary CF hardcode in the proxy so it uses the env again:
`app/app/api/mini-worker/route.ts` → `const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://worker.nftmail.box';`

Rebuild + restart:

```bash
cd /opt/nftmail && docker compose build --no-cache && docker compose up -d
```

Smoke test through the proxy:

```bash
curl -s -X POST https://nftmail.box/api/mini-worker \
  -H 'Content-Type: application/json' \
  -d '{"action":"getAgentProfile","agentName":"ghostagent-og.cast"}'
```

## 6. Re-sync + flip Mailgun inbound (the real cutover)

1. Re-run `node migrate-kv.mjs --commit` to catch any KV writes since step 2.
2. In Mailgun, repoint inbound Routes/webhooks from the CF worker URL to
   **`https://worker.nftmail.box/mailgun`** (the worker's inbound handler; it also
   accepts multipart `POST /`). Auth is bypassed for this path by design. Send a
   test email to a basic and a paid inbox; confirm they land in Redis / SQLite
   respectively (`source: 'kv'` vs `source: 'd1'` in the inbox response).

## 7. Decommission

- Leave the CF worker deployed but idle for a few days as a rollback safety net.
- After confidence, remove CF Mailgun routes and (optionally) the KV namespaces / D1.

---

## Rollback

- App: set `NFTMAIL_WORKER_URL` back to the CF worker URL, rebuild, restart.
- Mailgun: repoint inbound routes back to the CF worker.
- SQLite: restore `${DB}.bak.*` created by `import-d1-to-sqlite.sh`.
