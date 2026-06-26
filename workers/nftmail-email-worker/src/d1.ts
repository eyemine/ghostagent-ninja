/// <reference types="@cloudflare/workers-types" />
/**
 * @module d1
 * D1Store — typed access layer for the nftmail D1 database.
 *
 * Phase 1 (shadow mode): all writes go to both KV and D1.
 *                         reads still come from KV.
 * Phase 3: reads switch to D1 for LITE+ paths.
 * Phase 4: KV writes removed for LITE+.
 *
 * Keeping this as a plain class (not a generic KVStore adapter) because
 * D1 enables JOIN / WHERE / pagination that KV never could — we want to
 * expose those directly rather than hide them behind a get/put interface.
 */

// ── Row types ─────────────────────────────────────────────────────────────────

export interface AgentRow {
  label: string;
  controller: string;
  tld: string | null;
  tier: string;
  safe: string | null;
  ecies_pubkey: string | null;
  retention: string;
  expires_at: number | null;
  story_ip: string | null;
  origin_nft: string | null;
  origin_image: string | null;
  created_at: number;
  upgraded_at: number | null;
  zerog_root_hash: string | null;
  zerog_archived_at: number | null;
}

export interface EmailRow {
  id: number;
  agent_label: string;
  blind_id: string;
  domain_prefix: string;
  encrypted_blob: string;
  sender_hash: string | null;
  subject_hash: string | null;
  received_at: number;
  read: number;
  frozen: number;
  surge_allocation: number | null;
  ttl_expires_at: number | null;
}

export interface TierHistoryRow {
  id: number;
  agent_label: string;
  from_tier: string;
  to_tier: string;
  tx_hash: string | null;
  safe: string | null;
  changed_at: number;
}

export interface MemoryRow {
  id: number;
  agent_label: string;
  session_id: string | null;
  tag: string | null;
  content: string;
  created_at: number;
}

// ── Anamnesis-compatible memory model (RECORD → CHUNK → VECTOR) ──────────────

export type MemorySource = 'email' | 'chat' | 'vote' | 'story-ip' | 'normie' | 'safe-tx' | 'manual';
export type MemoryKind   = 'fact' | 'preference' | 'commitment' | 'relationship' | 'event' | 'raw';
export type MemoryScope  = 'session' | 'long-term' | 'vault';

export interface MemoryRecordRow {
  id: string;               // ulid
  agent_label: string;      // dot-canonical: chonk.681
  source: MemorySource;
  instance: string | null;  // 'from:0x1234' | 'dao:gnosis' | 'block:19234567'
  kind: MemoryKind | null;
  scope: MemoryScope;
  content_hash: string | null;
  created_at: number;
  updated_at: number;
  lineage_parent_id: string | null; // blind_id of email | safe tx_hash
}

export interface MemoryChunkRow {
  id: string;           // `${record_id}:${chunk_index}`
  record_id: string;
  chunk_index: number;
  content: string;
}

export interface MemoryVectorRow {
  chunk_id: string;
  vector: ArrayBuffer;  // 384-dim float32 little-endian
}

export interface SharedContextRow {
  namespace: string;
  data: string;
  writer: string | null;
  updated_at: number;
}

// ── D1Store ───────────────────────────────────────────────────────────────────

export class D1Store {
  constructor(private readonly db: D1Database) {}

  // ── agents ──────────────────────────────────────────────────────────────────

  async getAgent(label: string): Promise<AgentRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM agents WHERE label = ?')
      .bind(label)
      .first<AgentRow>();
    return result ?? null;
  }

  async getAgentsByController(controller: string): Promise<AgentRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM agents WHERE controller = ? ORDER BY created_at DESC')
      .bind(controller.toLowerCase())
      .all<AgentRow>();
    return result.results ?? [];
  }

  async getAgentsByTld(tld: string, limit = 100, offset = 0): Promise<AgentRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM agents WHERE tld = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(tld, limit, offset)
      .all<AgentRow>();
    return result.results ?? [];
  }

  /**
   * Upsert an agent row. Safe to call on every upgradeTier / registerSovereign.
   * In shadow mode (Phase 1-2), this runs alongside the existing KV write.
   */
  async upsertAgent(row: Omit<AgentRow, 'created_at'>): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO agents
          (label, controller, tld, tier, safe, ecies_pubkey, retention,
           expires_at, story_ip, origin_nft, origin_image, upgraded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(label) DO UPDATE SET
          controller   = excluded.controller,
          tld          = COALESCE(excluded.tld, agents.tld),
          tier         = excluded.tier,
          safe         = COALESCE(excluded.safe, agents.safe),
          ecies_pubkey = COALESCE(excluded.ecies_pubkey, agents.ecies_pubkey),
          retention    = excluded.retention,
          expires_at   = excluded.expires_at,
          story_ip     = COALESCE(excluded.story_ip, agents.story_ip),
          origin_nft   = COALESCE(excluded.origin_nft, agents.origin_nft),
          origin_image = COALESCE(excluded.origin_image, agents.origin_image),
          upgraded_at  = excluded.upgraded_at
      `)
      .bind(
        row.label,
        row.controller.toLowerCase(),
        row.tld ?? null,
        row.tier,
        row.safe ?? null,
        row.ecies_pubkey ?? null,
        row.retention,
        row.expires_at ?? null,
        row.story_ip ?? null,
        row.origin_nft ?? null,
        row.origin_image ?? null,
        row.upgraded_at ?? null,
      )
      .run();
  }

  async updateZeroGHash(label: string, rootHash: string): Promise<void> {
    await this.db
      .prepare('UPDATE agents SET zerog_root_hash = ?, zerog_archived_at = ? WHERE label = ?')
      .bind(rootHash, Date.now(), label)
      .run();
  }

  async burnAgent(label: string): Promise<void> {
    await this.db
      .prepare("UPDATE agents SET tier = 'burned', zerog_root_hash = NULL, zerog_archived_at = NULL WHERE label = ?")
      .bind(label)
      .run();
  }

  async deleteAgentEmails(label: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM emails WHERE agent_label = ?')
      .bind(label)
      .run();
    return result.meta?.changes ?? 0;
  }

  async deleteAgentMemory(label: string): Promise<number> {
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM memory_vectors WHERE chunk_id IN (SELECT mc.id FROM memory_chunks mc JOIN memory_records mr ON mc.record_id = mr.id WHERE mr.agent_label = ?)').bind(label),
      this.db.prepare('DELETE FROM memory_chunks WHERE record_id IN (SELECT id FROM memory_records WHERE agent_label = ?)').bind(label),
      this.db.prepare('DELETE FROM memory_records WHERE agent_label = ?').bind(label),
      this.db.prepare('DELETE FROM memory WHERE agent_label = ?').bind(label)
    ]);
    const lastResult = results[results.length - 1];
    return lastResult.meta?.changes ?? 0;
  }

  async getAllLiteAgents(): Promise<AgentRow[]> {
    const result = await this.db
      .prepare("SELECT * FROM agents WHERE tier != 'basic' ORDER BY created_at ASC")
      .all<AgentRow>();
    return result.results ?? [];
  }

  async updateEciesKey(label: string, ecies_pubkey: string): Promise<void> {
    await this.db
      .prepare('UPDATE agents SET ecies_pubkey = ? WHERE label = ?')
      .bind(ecies_pubkey, label)
      .run();
  }

  // ── emails ──────────────────────────────────────────────────────────────────

  async insertEmail(row: Omit<EmailRow, 'id'>): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO emails
          (agent_label, blind_id, domain_prefix, encrypted_blob,
           sender_hash, subject_hash, received_at, read, frozen,
           surge_allocation, ttl_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)
        ON CONFLICT(blind_id) DO NOTHING
      `)
      .bind(
        row.agent_label,
        row.blind_id,
        row.domain_prefix,
        row.encrypted_blob,
        row.sender_hash ?? null,
        row.subject_hash ?? null,
        row.received_at,
        row.ttl_expires_at ?? null,
      )
      .run();
  }

  async getInbox(
    agentLabel: string,
    opts: { limit?: number; offset?: number; domainPrefix?: string; unreadOnly?: boolean } = {},
  ): Promise<EmailRow[]> {
    const { limit = 50, offset = 0, domainPrefix = '', unreadOnly = false } = opts;
    let sql = 'SELECT * FROM emails WHERE agent_label = ? AND domain_prefix = ?';
    const binds: unknown[] = [agentLabel, domainPrefix];
    if (unreadOnly) { sql += ' AND read = 0'; }
    sql += ' ORDER BY received_at DESC LIMIT ? OFFSET ?';
    binds.push(limit, offset);
    const result = await this.db.prepare(sql).bind(...binds).all<EmailRow>();
    return result.results ?? [];
  }

  async getUnreadCount(agentLabel: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS cnt FROM emails WHERE agent_label = ? AND read = 0')
      .bind(agentLabel)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }

  async markRead(agentLabel: string, blindId: string): Promise<void> {
    await this.db
      .prepare('UPDATE emails SET read = 1 WHERE agent_label = ? AND blind_id = ?')
      .bind(agentLabel, blindId)
      .run();
  }

  async freezeEmail(agentLabel: string, blindId: string, surgeAllocation: number): Promise<void> {
    await this.db
      .prepare(`
        UPDATE emails
        SET frozen = 1, surge_allocation = ?, ttl_expires_at = NULL
        WHERE agent_label = ? AND blind_id = ?
      `)
      .bind(surgeAllocation, agentLabel, blindId)
      .run();
  }

  /** Purge expired non-frozen emails (run from cron). */
  async purgeExpired(): Promise<number> {
    const now = Date.now();
    const result = await this.db
      .prepare('DELETE FROM emails WHERE frozen = 0 AND ttl_expires_at IS NOT NULL AND ttl_expires_at < ?')
      .bind(now)
      .run();
    return result.meta?.changes ?? 0;
  }

  // ── tier_history ─────────────────────────────────────────────────────────────

  async recordTierChange(
    agentLabel: string,
    fromTier: string,
    toTier: string,
    txHash: string | null,
    safe: string | null,
  ): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO tier_history (agent_label, from_tier, to_tier, tx_hash, safe)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(agentLabel, fromTier, toTier, txHash ?? null, safe ?? null)
      .run();
  }

  // ── identities ───────────────────────────────────────────────────────────────

  async upsertIdentity(agentLabel: string, chain: string, erc8004AgentId: number): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO identities (agent_label, chain, erc8004_agent_id)
        VALUES (?, ?, ?)
        ON CONFLICT(agent_label, chain) DO UPDATE SET erc8004_agent_id = excluded.erc8004_agent_id
      `)
      .bind(agentLabel, chain, erc8004AgentId)
      .run();
  }

  // ── memory ───────────────────────────────────────────────────────────────────

  async appendMemory(
    agentLabel: string,
    content: string,
    opts: { sessionId?: string; tag?: string; cap?: number } = {},
  ): Promise<void> {
    const { sessionId = null, tag = null, cap = 200 } = opts;
    await this.db.batch([
      this.db
        .prepare('INSERT INTO memory (agent_label, session_id, tag, content) VALUES (?, ?, ?, ?)')
        .bind(agentLabel, sessionId, tag, content),
      // Trim oldest rows beyond cap in the same batch
      this.db
        .prepare(`
          DELETE FROM memory WHERE id IN (
            SELECT id FROM memory WHERE agent_label = ?
            ORDER BY created_at DESC LIMIT -1 OFFSET ?
          )
        `)
        .bind(agentLabel, cap),
    ]);
  }

  async getRecentMemory(
    agentLabel: string,
    opts: { limit?: number; tag?: string; sessionId?: string } = {},
  ): Promise<MemoryRow[]> {
    const { limit = 20, tag, sessionId } = opts;
    let sql = 'SELECT * FROM memory WHERE agent_label = ?';
    const binds: unknown[] = [agentLabel];
    if (tag) { sql += ' AND tag = ?'; binds.push(tag); }
    if (sessionId) { sql += ' AND session_id = ?'; binds.push(sessionId); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    binds.push(limit);
    const result = await this.db.prepare(sql).bind(...binds).all<MemoryRow>();
    return result.results ?? [];
  }

  // ── structured memory (Anamnesis model) ──────────────────────────────────────

  async insertMemoryRecord(row: MemoryRecordRow): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO memory_records (id, agent_label, source, instance, kind, scope, content_hash, created_at, updated_at, lineage_parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          instance = excluded.instance,
          kind = excluded.kind,
          scope = excluded.scope,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at,
          lineage_parent_id = excluded.lineage_parent_id
      `)
      .bind(
        row.id,
        row.agent_label,
        row.source,
        row.instance ?? null,
        row.kind ?? null,
        row.scope,
        row.content_hash ?? null,
        row.created_at,
        row.updated_at,
        row.lineage_parent_id ?? null
      )
      .run();
  }

  async insertMemoryChunk(row: MemoryChunkRow): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO memory_chunks (id, record_id, chunk_index, content)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content
      `)
      .bind(row.id, row.record_id, row.chunk_index, row.content)
      .run();
  }

  async insertMemoryVector(row: MemoryVectorRow): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO memory_vectors (chunk_id, vector)
        VALUES (?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          vector = excluded.vector
      `)
      .bind(row.chunk_id, row.vector)
      .run();
  }

  async getMemoryRecord(id: string): Promise<MemoryRecordRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM memory_records WHERE id = ?')
      .bind(id)
      .first<MemoryRecordRow>();
    return result ?? null;
  }

  async getMemoryRecordWithChunks(recordId: string): Promise<{ record: MemoryRecordRow; chunks: MemoryChunkRow[] } | null> {
    const record = await this.getMemoryRecord(recordId);
    if (!record) return null;
    const chunksResult = await this.db
      .prepare('SELECT * FROM memory_chunks WHERE record_id = ? ORDER BY chunk_index ASC')
      .bind(recordId)
      .all<MemoryChunkRow>();
    return { record, chunks: chunksResult.results ?? [] };
  }

  async getAgentMemoryRecords(
    agentLabel: string,
    opts: { limit?: number; offset?: number; source?: MemorySource; kind?: MemoryKind; scope?: MemoryScope } = {}
  ): Promise<MemoryRecordRow[]> {
    const { limit = 50, offset = 0, source, kind, scope } = opts;
    let sql = 'SELECT * FROM memory_records WHERE agent_label = ?';
    const binds: unknown[] = [agentLabel];
    if (source) { sql += ' AND source = ?'; binds.push(source); }
    if (kind) { sql += ' AND kind = ?'; binds.push(kind); }
    if (scope) { sql += ' AND scope = ?'; binds.push(scope); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    binds.push(limit, offset);
    const result = await this.db.prepare(sql).bind(...binds).all<MemoryRecordRow>();
    return result.results ?? [];
  }

  async searchMemoryChunksFTS(agentLabel: string, query: string, limit = 10): Promise<{ chunk: MemoryChunkRow; record: MemoryRecordRow }[]> {
    const result = await this.db
      .prepare(`
        SELECT c.*, r.id as r_id, r.agent_label, r.source, r.instance, r.kind, r.scope, r.content_hash, r.created_at, r.updated_at, r.lineage_parent_id
        FROM memory_chunks_fts f
        JOIN memory_chunks c ON c.rowid = f.rowid
        JOIN memory_records r ON r.id = c.record_id
        WHERE r.agent_label = ? AND f.content MATCH ?
        LIMIT ?
      `)
      .bind(agentLabel, query, limit)
      .all<any>();
    
    if (!result.results) return [];
    return result.results.map(row => ({
      chunk: {
        id: row.id,
        record_id: row.record_id,
        chunk_index: row.chunk_index,
        content: row.content
      },
      record: {
        id: row.r_id,
        agent_label: row.agent_label,
        source: row.source,
        instance: row.instance,
        kind: row.kind,
        scope: row.scope,
        content_hash: row.content_hash,
        created_at: row.created_at,
        updated_at: row.updated_at,
        lineage_parent_id: row.lineage_parent_id
      }
    }));
  }

  async deleteMemoryRecord(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM memory_vectors WHERE chunk_id IN (SELECT id FROM memory_chunks WHERE record_id = ?)').bind(id),
      this.db.prepare('DELETE FROM memory_chunks WHERE record_id = ?').bind(id),
      this.db.prepare('DELETE FROM memory_records WHERE id = ?').bind(id)
    ]);
  }

  // ── shared_context ────────────────────────────────────────────────────────────

  async setSharedContext(namespace: string, data: unknown, writer?: string): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO shared_context (namespace, data, writer, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace) DO UPDATE SET
          data       = excluded.data,
          writer     = excluded.writer,
          updated_at = excluded.updated_at
      `)
      .bind(namespace, JSON.stringify(data), writer ?? null, Date.now())
      .run();
  }

  async getSharedContext(namespace: string): Promise<SharedContextRow | null> {
    const result = await this.db
      .prepare('SELECT * FROM shared_context WHERE namespace = ?')
      .bind(namespace)
      .first<SharedContextRow>();
    return result ?? null;
  }

  async listSharedContext(prefix = ''): Promise<SharedContextRow[]> {
    const result = await this.db
      .prepare('SELECT * FROM shared_context WHERE namespace LIKE ? ORDER BY updated_at DESC')
      .bind(prefix + '%')
      .all<SharedContextRow>();
    return result.results ?? [];
  }
}
