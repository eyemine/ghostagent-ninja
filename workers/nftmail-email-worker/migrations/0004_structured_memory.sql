-- D1 migration 0004: structured memory tables (Anamnesis model)

CREATE TABLE IF NOT EXISTS memory_records (
  id                TEXT    PRIMARY KEY,          -- ULID or UUID
  agent_label       TEXT    NOT NULL REFERENCES agents(label) ON DELETE CASCADE, -- dot-canonical: chonk.681
  source            TEXT    NOT NULL,             -- 'email'|'chat'|'vote'|'story-ip'|'normie'|'safe-tx'|'manual'
  instance          TEXT,                         -- 'from:0x1234' | 'dao:gnosis' | 'block:19234567'
  kind              TEXT,                         -- 'fact'|'preference'|'commitment'|'relationship'|'event'|'raw'
  scope             TEXT    NOT NULL DEFAULT 'long-term', -- 'session'|'long-term'|'vault'
  content_hash      TEXT,                         -- SHA-256 hash of content
  created_at        INTEGER NOT NULL,             -- unix ms
  updated_at        INTEGER NOT NULL,             -- unix ms
  lineage_parent_id TEXT                          -- blind_id of email, safe tx_hash, etc.
);

CREATE INDEX IF NOT EXISTS idx_mem_records_agent ON memory_records(agent_label, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mem_records_source ON memory_records(source);
CREATE INDEX IF NOT EXISTS idx_mem_records_kind ON memory_records(kind);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id          TEXT    PRIMARY KEY,                -- e.g. `${record_id}:${chunk_index}`
  record_id   TEXT    NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mem_chunks_record ON memory_chunks(record_id);

-- FTS5 virtual table for searching chunk content
CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
  content,
  content='memory_chunks',
  content_rowid='rowid'
);

-- Triggers to keep memory_chunks_fts updated automatically when memory_chunks is mutated
CREATE TRIGGER IF NOT EXISTS fts_ai AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_ad AFTER DELETE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS fts_au AFTER UPDATE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO memory_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS memory_vectors (
  chunk_id    TEXT    PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
  vector      BLOB    NOT NULL                    -- float32 vector BLOB (384-dim little-endian)
);
