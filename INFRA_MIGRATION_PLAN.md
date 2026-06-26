# Migration Plan: Hetzner + Postfix + ERC-8217
## Last updated: 2026-06-18

## 0. Immediate Fixes (Before Migration)

### 0a. KV Data Integrity — controller field audit
The dashboard's `listNftmailByController` scans `nftmailgno:*` KV keys and filters by
`controller` OR `safe` field. If any of the 16 names have a stale controller (e.g. an old
wallet, the Safe address, or lowercase/checksum mismatch) they won't appear in the dashboard.

Fix path: run `backfill-registration` against each name with `controller: 0xf251Ca37a80200f7AfefF398DA0338f4C1f01249`
to ensure all KV records reflect the current owner wallet.

### 0b. Worker Deploy Discipline
Always deploy worker with `npm run deploy` (uses `--keep-vars`) to avoid wiping Cloudflare secrets.
Previous bare `wrangler deploy` calls wiped WORKER_SECRET on each deploy — auth was silently
bypassed because the router skips the check when `env.WORKER_SECRET` is falsy.

## 1. Architecture Hardening (ERC-8217)

Current problem: dot/hyphen KV split because canonical owner model is undefined.

Three distinct roles:
- **Master NFT Owner** -- human EOA owning the governing NFT
- **Principal** -- human operator (may differ from owner via delegation)
- **Agent Safe** -- Gnosis Safe treasury holding ERC-8004

Canonical binding per ERC-8217:
Master NFT -> ownerOf() -> EOA -> deploys -> Agent Safe -> holds -> ERC-8004

agent-lookup must expose: masterNft.owner, principal, safeAddress, erc8004

*Note: Full ERC-8217 smart contract and indexer implementation deferred to Phase 2 (post-migration). Current binding remains in application code (`/api/agent-lookup`) via dot-canonical tolerant resolution. Hetzner migration must ship first.*

## 2. Hetzner Migration

### Phase 2a: VPS Setup (Day 1)
- Order Hetzner CPX21 (4 vCPU / 8GB / 80GB NVMe)
- Ubuntu 24.04, SSH hardening, UFW, fail2ban
- Install Node.js 20, Bun 1.x, PM2, Nginx, SQLite3, Redis

### Phase 2b: Next.js App (Day 1-2)
- git clone + bun install + bun run build
- PM2 for next start on port 3000
- Nginx reverse proxy + SSL (Let's Encrypt)
- DNS: ghostagent.ninja -> Hetzner IP

### Phase 2c: Worker on Node/Bun (Day 2-3)
Worker uses Hono.js (portable). Replace Cloudflare bindings:
  KV (INBOX_KV) -> Redis
  D1 -> SQLite file
  GHOST_CALENDAR KV -> Redis (separate DB)
  ExecutionContext -> Bun.serve() or Node HTTP

### Phase 2d: DNS Cutover (Day 3-4)
- Lower TTL to 60s before cutover
- Point A record to Hetzner
- If Hetzner fails, repoint A record to Cloudflare origin. Estimated recovery time: 5 minutes (eliminating fragile 48h "hot standby").

## 3. Mailgun Replacement & Inbound/Outbound Strategy

### Inbound Decision: Postfix Pipe vs. Haraka vs. Hybrid Inbound
Postfix's pipe delivery agent runs as a separate process with its own user/env, which can block Node/Bun scripting unless carefully configured (`user=`, `chroot=`, `environment=`). 

Options:
1. **Postfix with Built-in HTTP table lookup** or **Haraka (Node.js native SMTP server)**: Much easier debugging and setup via JS/TS hook, avoiding Postfix master.cf/pipe environment pitfalls.
2. **Pragmatic Path (Hybrid Inbound - Day 1)**: Do not block migration on Postfix/Haraka setup. Keep Mailgun MX records and configure Mailgun webhooks to POST to the Hetzner Next.js API. Once Hetzner HTTP is stable, migrate MX and inbound to self-hosted SMTP (Haraka or Postfix).

### Outbound Decision: Anti-Panopticon Compliance vs. AWS SES CLOUD Act
Option B (AWS SES) directly contradicts Section 6's "no email scanning by Google/Microsoft/Mailgun" since Amazon is subject to the US CLOUD Act. 

**Decision**: Commit to self-hosted outbound. To protect IP warmup and deliverability initially:
- Route outbound through a transient SMTP relay (e.g., Mailgun SMTP relay, not API) for the first 30 days to build reputation.
- Once the Hetzner IP is fully warmed up and SPF/DKIM/DMARC are verified, drop the SMTP relay and deliver directly from the Hetzner SMTP agent (Postfix or Haraka).
- Update the Privacy Policy to disclose this transient Mailgun/relay usage during the warmup phase.

### Phase 3c: Webhook Bridge (Day 3)
Postfix (pipe) -> Node script -> HTTP POST localhost:8787/inbound
Same JSON shape as current Mailgun webhook.

## 4. Revised Safe Migration Timeline (Hybrid Inbound Plan)

- **Mon**: Order Hetzner VPS. Deploy tolerant lookup fix. Fix agent-card bug.
- **Tue**: VPS ready. Build KV->Redis + SQLite adapters with WAL mode and `busy_timeout` set to 5000ms.
- **Wed**: Deploy Next.js + Bun worker on Hetzner. Run SQLite live using D1 as fallback. Test lookups.
- **Thu**: Install Postfix/Haraka on VPS. Stop if blocked. Maintain Mailgun inbound MX to forward to Hetzner API (Hybrid Inbound).
- **Fri**: If Postfix/Haraka is working, configure pipe/JS hook. Otherwise, fall back to Mailgun webhook → Hetzner API. Configure SMTP relay outbound.
- **Sat**: DNS A record cutover to Hetzner (HTTP only). Keep Mailgun MX for safety until HTTP/SQLite is verified.
- **Sun**: Verification, monitor SQLite concurrent writes, and draft plan to migrate MX to Postfix/Haraka.

## 5. KV → D1/SQLite Migration Rationale

KV is architecturally wrong for inbox/agent data:
- `listNftmailByController` does a full O(n) key scan — every dashboard load reads ALL nftmailgno:* keys
- No transactions: controller+tier+tld written as 3 separate puts → partial writes on crash
- Eventual consistency: freshly minted names invisible for seconds
- No secondary indexes: "find all names by wallet" requires client-side filter loop
- 1000 key page limit: breaks silently at scale

D1/SQLite target schema (portable, standard SQL):
```sql
CREATE TABLE inboxes (
  name       TEXT PRIMARY KEY,
  controller TEXT NOT NULL,  -- lowercase EOA
  safe       TEXT,           -- lowercase Gnosis Safe
  -- origin_nft: hyphenated GNS beacon, e.g. "chonk-681.agent.gno"
  -- agent label: dot-canonical format, e.g. "chonk.681" is derived
  origin_nft TEXT,
  tld        TEXT NOT NULL DEFAULT 'nftmail.gno',
  token_id   INTEGER,
  tier       TEXT NOT NULL DEFAULT 'basic',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, -- Added for cache invalidation
  -- encrypted fields (libsodium secretbox, per-agent key)
  forwarding_enc BLOB,       -- encrypted forwarding email target
  metadata_enc   BLOB        -- encrypted JSON sidecar
);
CREATE INDEX idx_controller ON inboxes(controller);
CREATE INDEX idx_safe ON inboxes(safe);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  inbox      TEXT NOT NULL REFERENCES inboxes(name),
  direction  TEXT NOT NULL CHECK(direction IN ('in','out')),
  sender_enc BLOB NOT NULL,      -- encrypted
  subject_enc BLOB NOT NULL,     -- encrypted
  body_enc   BLOB NOT NULL,      -- encrypted (ECIES for blind inbox, secretbox otherwise)
  body_size  INTEGER NOT NULL DEFAULT 0, -- Added for quota enforcement without decryption
  ts         INTEGER NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_inbox_ts ON messages(inbox, ts DESC);

-- Agent memory: Anamnesis-compatible SOURCE → RECORD → CHUNK → VECTOR model.
CREATE TABLE memory_records (
  id                TEXT PRIMARY KEY,
  agent_label       TEXT NOT NULL REFERENCES inboxes(name),
  source            TEXT NOT NULL CHECK(source IN ('email','chat','vote','story-ip','normie','safe-tx','manual')),
  instance          TEXT,
  kind              TEXT CHECK(kind IN ('fact','preference','commitment','relationship','event','raw')),
  scope             TEXT NOT NULL DEFAULT 'long-term' CHECK(scope IN ('session','long-term','vault')),
  content_hash      TEXT NOT NULL, -- Deterministic hash of canonical content for Anamnesis deduplication
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  lineage_parent_id TEXT
);
CREATE INDEX idx_memory_agent_updated ON memory_records(agent_label, updated_at DESC);
CREATE INDEX idx_memory_lineage ON memory_records(lineage_parent_id);

CREATE TABLE memory_chunks (
  id          TEXT PRIMARY KEY,
  record_id   TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_memory_chunk_order ON memory_chunks(record_id, chunk_index);
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(content, content='memory_chunks', content_rowid='rowid');

CREATE TABLE memory_vectors (
  chunk_id TEXT PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
  vector   BLOB NOT NULL
);
```

Migration: `kv-to-d1-backfill.ts` script reads all KV keys, decrypts nothing, writes rows to D1.
Go live: flip `BACKEND=D1` env var in wrangler.toml (already supported in index.ts backend switch).

### SQLite Concurrent Writes on Hetzner
To avoid `SQLITE_BUSY` errors when both the Next.js app and the worker process write to SQLite concurrently:
- Enable **WAL (Write-Ahead Logging)** mode: `PRAGMA journal_mode=WAL;`
- Configure `busy_timeout` to at least 5000ms: `PRAGMA busy_timeout=5000;`
- Standardize on a single database lock queue/helper, or switch to Postgres once adding concurrent multi-process writes if lock contention is hit.

## 6. Anti-Panopticon + Encryption Model

### Infrastructure
- **Hetzner CPX21**: German jurisdiction, GDPR, no US CLOUD Act
- **SQLite + Redis**: data on our metal, no third-party visibility
- **Postfix**: no email scanning by Google/Microsoft/Mailgun

### Encryption at rest (no plaintext PII on disk)
All PII stored encrypted. Keys never leave the key service.

| Field | Encryption | Key source |
|---|---|---|
| Forwarding email target | libsodium `secretbox` | Per-agent key = `HMAC(SERVER_MASTER_KEY, agentName)` |
| Message sender/subject/body | libsodium `secretbox` | Same per-agent key |
| Blind inbox body | ECIES (secp256k1) | Recipient's wallet public key (already live) |
| Controller/safe addresses | Plaintext | Public on-chain data — not PII |

Key derivation: `SERVER_MASTER_KEY` is a 32-byte secret stored only in Hetzner env. Never in git, never in Cloudflare.

### Backup
- Daily SQLite dump: `sqlite3 nftmail.db .dump | age -r <recipient-pubkey> > backup-$(date +%Y%m%d).sql.age`
- Redis: `BGSAVE` + `rclone` to Backblaze B2 (EU region)
- Rotation: 30-day retention, 7-day local + 30-day offsite

### Migration safety
kv.ts already has `CloudflareKVStore`, `DenoKVStore`, `RedisKVStore`, `MemoryKVStore` adapters.
Adding `SQLiteStore` is ~50 lines. Flip `BACKEND` env var to cut over with zero downtime.
