/**
 * storage-quota-manager.ts
 *
 * Tracks per-agent storage usage across IPFS + KV.
 * KV keys:
 *   storage:<agent>:used   — bytes used (string int)
 *   storage:<agent>:cap    — cap in bytes (default 100MB)
 *   storage:<agent>:files  — JSON array of StoredFile metadata
 */

export interface StoredFile {
  cid: string;           // IPFS CID or KV key
  name: string;
  sizeBytes: number;
  addedAt: number;       // epoch ms
  type: 'ipfs' | 'kv';
  archived?: boolean;    // true if moved to Arweave
  arweaveTxId?: string;
}

export interface StorageState {
  agentName: string;
  usedBytes: number;
  capBytes: number;
  remainingBytes: number;
  bps: number;           // 0-10000
  files: StoredFile[];
}

const MB = 1024 * 1024;
const DEFAULT_CAP = 100 * MB;
const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

export async function getStorageState(agentName: string): Promise<StorageState> {
  const res = await fetch(`${BASE}/api/agent/storage?agent=${encodeURIComponent(agentName)}`);
  if (!res.ok) return defaultState(agentName);
  return res.json() as Promise<StorageState>;
}

export async function recordUpload(agentName: string, file: Omit<StoredFile, 'addedAt'>): Promise<StorageState> {
  const res = await fetch(`${BASE}/api/agent/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add', agentName, file: { ...file, addedAt: Date.now() } }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<StorageState>;
}

export async function removeFile(agentName: string, cid: string): Promise<StorageState> {
  const res = await fetch(`${BASE}/api/agent/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'remove', agentName, cid }),
  });
  if (!res.ok) throw new Error(`removeFile: HTTP ${res.status}`);
  return res.json() as Promise<StorageState>;
}

export async function configureStorageCap(agentName: string, capBytes: number): Promise<StorageState> {
  const res = await fetch(`${BASE}/api/agent/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'configure', agentName, capBytes }),
  });
  if (!res.ok) throw new Error(`configureStorageCap: HTTP ${res.status}`);
  return res.json() as Promise<StorageState>;
}

export function formatStorage(s: StorageState): string {
  const usedMB = (s.usedBytes / MB).toFixed(0);
  const capMB = (s.capBytes / MB).toFixed(0);
  const pct = (s.bps / 100).toFixed(0);
  const status = s.bps >= 10000 ? 'FULL' : s.bps >= 9500 ? '⚠️ 95%' : s.bps >= 8000 ? '⚠️' : '✓';
  return `Storage: ${usedMB}MB/${capMB}MB (${pct}%) ${status}`;
}

export function defaultState(agentName: string): StorageState {
  return { agentName, usedBytes: 0, capBytes: DEFAULT_CAP, remainingBytes: DEFAULT_CAP, bps: 0, files: [] };
}

export { DEFAULT_CAP, MB };
