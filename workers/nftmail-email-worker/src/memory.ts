/// <reference types="@cloudflare/workers-types" />

export type MemorySource = 'email' | 'chat' | 'vote' | 'story-ip' | 'normie' | 'safe-tx' | 'manual';
export type MemoryKind = 'fact' | 'preference' | 'commitment' | 'relationship' | 'event' | 'raw';
export type MemoryScope = 'session' | 'long-term' | 'vault';

export interface MemoryRecordRow {
  id: string;
  agent_label: string;
  source: MemorySource;
  instance: string | null;
  kind: MemoryKind | null;
  scope: MemoryScope;
  content_hash: string | null;
  created_at: number;
  updated_at: number;
  lineage_parent_id: string | null;
}

export interface MemoryChunkRow {
  id: string;
  record_id: string;
  chunk_index: number;
  content: string;
}

export interface MemoryVectorRow {
  chunk_id: string;
  vector: ArrayBuffer;
}

export interface MemorySearchRow extends MemoryChunkRow {
  source: MemorySource;
  scope: MemoryScope;
  kind: MemoryKind | null;
  lineage_parent_id: string | null;
  created_at: number;
}

export class AgentMemoryStore {
  constructor(private readonly db: D1Database) {}

  async insertRecord(row: MemoryRecordRow): Promise<void> {
    await this.db.prepare(
      'INSERT INTO memory_records (id, agent_label, source, instance, kind, scope, content_hash, created_at, updated_at, lineage_parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    ).bind(row.id, row.agent_label, row.source, row.instance, row.kind, row.scope, row.content_hash, row.created_at, row.updated_at, row.lineage_parent_id).run();
  }

  async insertChunks(chunks: MemoryChunkRow[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.db.batch(chunks.map(c => this.db.prepare(
      'INSERT INTO memory_chunks (id, record_id, chunk_index, content) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    ).bind(c.id, c.record_id, c.chunk_index, c.content)));
  }

  async listRecords(agentLabel?: string | null, limit = 50): Promise<MemoryRecordRow[]> {
    if (agentLabel) {
      const r = await this.db.prepare(
        'SELECT * FROM memory_records WHERE agent_label = ? ORDER BY updated_at DESC LIMIT ?',
      ).bind(agentLabel, limit).all<MemoryRecordRow>();
      return r.results ?? [];
    } else {
      const r = await this.db.prepare(
        'SELECT * FROM memory_records ORDER BY updated_at DESC LIMIT ?',
      ).bind(limit).all<MemoryRecordRow>();
      return r.results ?? [];
    }
  }

  async getRecord(id: string): Promise<MemoryRecordRow | null> {
    return await this.db.prepare('SELECT * FROM memory_records WHERE id = ?').bind(id).first<MemoryRecordRow>() ?? null;
  }

  async getChunks(recordId: string): Promise<MemoryChunkRow[]> {
    const r = await this.db.prepare(
      'SELECT * FROM memory_chunks WHERE record_id = ? ORDER BY chunk_index ASC',
    ).bind(recordId).all<MemoryChunkRow>();
    return r.results ?? [];
  }

  async search(agentLabel: string, query: string, limit = 10): Promise<MemorySearchRow[]> {
    const r = await this.db.prepare(
      'SELECT mc.id, mc.record_id, mc.chunk_index, mc.content, mr.source, mr.scope, mr.kind, mr.lineage_parent_id, mr.created_at FROM memory_chunks_fts fts JOIN memory_chunks mc ON mc.rowid = fts.rowid JOIN memory_records mr ON mr.id = mc.record_id WHERE fts.content MATCH ? AND mr.agent_label = ? ORDER BY rank LIMIT ?',
    ).bind(query, agentLabel, limit).all<MemorySearchRow>();
    return r.results ?? [];
  }
}
