-- D1 migration 0001: initial schema
-- LARVA (basic) tier stays in KV (8-day TTL, no relational needs).
-- PUPA (lite) and above live here.

-- ── agents ────────────────────────────────────────────────────────────────────
-- One row per registered label (human or agent).
-- label is the canonical local-part, e.g. "atom.158", "atom.158_", "zherring"
CREATE TABLE IF NOT EXISTS agents (
  label           TEXT    PRIMARY KEY,          -- e.g. 'atom.158'
  controller      TEXT    NOT NULL,             -- owner EOA (lowercase 0x…)
  tld             TEXT,                         -- 'molt.gno' | 'agent.gno' | 'nftmail.gno' …
  tier            TEXT    NOT NULL DEFAULT 'basic', -- 'basic'|'lite'|'premium'|'ghost'
  safe            TEXT,                         -- Gnosis Safe address
  ecies_pubkey    TEXT,                         -- hex-encoded ECIES public key
  retention       TEXT    NOT NULL DEFAULT '8-day', -- '8-day'|'30-day'|'infinite'
  expires_at      INTEGER,                      -- unix ms, NULL = no expiry
  story_ip        TEXT,                         -- Story Protocol IP asset address
  origin_nft      TEXT,                         -- beacon NFT label, e.g. 'atom-158.agent.gno'
  origin_image    TEXT,                         -- IPFS URL for NFT avatar
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  upgraded_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agents_controller ON agents(controller);
CREATE INDEX IF NOT EXISTS idx_agents_tier        ON agents(tier);
CREATE INDEX IF NOT EXISTS idx_agents_tld         ON agents(tld);

-- ── emails ────────────────────────────────────────────────────────────────────
-- PUPA+ encrypted envelopes. LARVA stays in KV.
-- blind_id matches the KV key suffix: blind:{label}:{blind_id}
CREATE TABLE IF NOT EXISTS emails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_label     TEXT    NOT NULL REFERENCES agents(label) ON DELETE CASCADE,
  blind_id        TEXT    NOT NULL UNIQUE,      -- e.g. 'blind-1714000000-abc12345'
  domain_prefix   TEXT    NOT NULL DEFAULT '',  -- '' = nftmail.box, 'ghostmail' = ghostmail.box
  encrypted_blob  TEXT    NOT NULL,             -- full JSON envelope (ECIES or glassbox)
  sender_hash     TEXT,                         -- sha256(from) for analytics without PII
  subject_hash    TEXT,                         -- sha256(subject)
  received_at     INTEGER NOT NULL,             -- unix ms
  read            INTEGER NOT NULL DEFAULT 0,   -- 0|1
  frozen          INTEGER NOT NULL DEFAULT 0,   -- 1 = owner stake-to-preserve (no TTL); set only by the account holder, never by external oracles
  surge_allocation INTEGER,                     -- $SURGE staked by owner to preserve this envelope
  ttl_expires_at  INTEGER                       -- NULL = infinite (premium/ghost/frozen)
);

CREATE INDEX IF NOT EXISTS idx_emails_agent       ON emails(agent_label, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_unread      ON emails(agent_label, read) WHERE read = 0;
CREATE INDEX IF NOT EXISTS idx_emails_blind_id    ON emails(blind_id);

-- ── reputation_flags ────────────────────────────────────────────────────────
-- Read-only reputation signals sourced from on-chain data (ERC-8004, $SURGE balance, GhostRegistry).
-- notapaperclip.red and other reputation oracles write HERE only — never to agents or emails.
-- The email system never reads this table for routing decisions.
CREATE TABLE IF NOT EXISTS reputation_flags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_label     TEXT    NOT NULL,
  source          TEXT    NOT NULL,             -- 'notapaperclip' | 'surge-oracle' | 'community'
  flag            TEXT    NOT NULL,             -- 'low-reputation' | 'burn-detected' | 'spam'
  evidence_url    TEXT,                         -- link to on-chain tx or public report
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolved_at     INTEGER                       -- NULL = active flag
);

CREATE INDEX IF NOT EXISTS idx_rep_flags_label ON reputation_flags(agent_label);

-- ── tier_history ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tier_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_label     TEXT    NOT NULL,
  from_tier       TEXT    NOT NULL,
  to_tier         TEXT    NOT NULL,
  tx_hash         TEXT,                         -- payment tx on Gnosis
  safe            TEXT,
  changed_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_tier_history_label ON tier_history(agent_label);

-- ── identities ────────────────────────────────────────────────────────────────
-- ERC-8004 on-chain registrations (one row per chain per agent)
CREATE TABLE IF NOT EXISTS identities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_label     TEXT    NOT NULL,
  chain           TEXT    NOT NULL,             -- 'gnosis' | 'base'
  erc8004_agent_id INTEGER,
  registered_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(agent_label, chain)
);

-- ── memory ────────────────────────────────────────────────────────────────────
-- Episodic memory rolling buffer (replaces memory:{name} KV JSON array)
-- Cap at 200 per agent enforced in application layer (DELETE oldest on overflow).
CREATE TABLE IF NOT EXISTS memory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_label     TEXT    NOT NULL,
  session_id      TEXT,
  tag             TEXT,
  content         TEXT    NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_memory_agent       ON memory(agent_label, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tag         ON memory(agent_label, tag);

-- ── shared_context ────────────────────────────────────────────────────────────
-- Cross-agent coordination (replaces shared-ctx:{namespace} KV)
CREATE TABLE IF NOT EXISTS shared_context (
  namespace       TEXT    PRIMARY KEY,
  data            TEXT    NOT NULL,             -- JSON blob
  writer          TEXT,                         -- agent label that last wrote
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
