/**
 * arweave-auto-archive.ts
 *
 * Auto-archives oldest IPFS files to Arweave when storage hits 80%.
 * Uses Arweave HTTP API (bundlr/irys or direct ar.io gateway).
 * After archival, marks file as archived and updates storage state.
 *
 * Requires: ARWEAVE_KEY_JWK env var (Arweave wallet JSON)
 */

import type { StoredFile, StorageState } from './storage-quota-manager';

export interface ArchiveResult {
  cid: string;
  arweaveTxId: string;
  sizeBytes: number;
  archivedAt: number;
}

const IRYS_URL = 'https://uploader.irys.xyz';
const BASE = typeof window !== 'undefined' ? '' : (process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja');

/**
 * Archive oldest non-archived IPFS files until usage drops below targetBps (default 7000 = 70%).
 * Returns list of archived files.
 */
export async function autoArchive(
  agentName: string,
  state: StorageState,
  targetBps = 7000
): Promise<ArchiveResult[]> {
  if (state.bps < 8000) return []; // only trigger at 80%

  const arweaveKey = process.env.ARWEAVE_KEY_JWK;
  if (!arweaveKey) {
    console.warn('[arweave-archive] ARWEAVE_KEY_JWK not set — skipping archival');
    return [];
  }

  const candidates = state.files
    .filter(f => f.type === 'ipfs' && !f.archived)
    .sort((a, b) => a.addedAt - b.addedAt); // oldest first

  const results: ArchiveResult[] = [];
  let currentBps = state.bps;

  for (const file of candidates) {
    if (currentBps <= targetBps) break;

    try {
      const txId = await archiveToArweave(file, arweaveKey);
      results.push({ cid: file.cid, arweaveTxId: txId, sizeBytes: file.sizeBytes, archivedAt: Date.now() });

      // Mark archived in storage state via API
      await fetch(`${BASE}/api/agent/storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-archived', agentName, cid: file.cid, arweaveTxId: txId }),
      }).catch(() => {});

      currentBps -= Math.round((file.sizeBytes / state.capBytes) * 10000);
    } catch (err: any) {
      console.error(`[arweave-archive] Failed to archive ${file.cid}:`, err?.message);
    }
  }

  if (results.length > 0) {
    await sendArchiveNotification(agentName, results).catch(() => {});
  }

  return results;
}

async function archiveToArweave(file: StoredFile, keyJwk: string): Promise<string> {
  // Fetch content from IPFS
  const ipfsRes = await fetch(`https://ipfs.io/ipfs/${file.cid}`);
  if (!ipfsRes.ok) throw new Error(`IPFS fetch failed: ${ipfsRes.status}`);
  const content = await ipfsRes.arrayBuffer();

  // Upload to Irys (Arweave bundler)
  const keyObj = JSON.parse(keyJwk);
  const uploadRes = await fetch(`${IRYS_URL}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-arweave-key': JSON.stringify(keyObj),
    },
    body: content,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Irys upload failed: ${err}`);
  }

  const data = await uploadRes.json() as { id?: string };
  if (!data.id) throw new Error('No txId in Irys response');
  return data.id;
}

async function sendArchiveNotification(agentName: string, results: ArchiveResult[]): Promise<void> {
  const totalMB = (results.reduce((s, r) => s + r.sizeBytes, 0) / (1024 * 1024)).toFixed(1);
  await fetch(`${BASE}/api/mail/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName,
      from: 'storage-guardrail@ghostagent.ninja',
      subject: `[${agentName}] Auto-archived ${results.length} files (${totalMB}MB) to Arweave`,
      body: results.map(r => `${r.cid} -> ar://${r.arweaveTxId} (${(r.sizeBytes / 1024).toFixed(0)}KB)`).join('\n'),
      internal: true,
    }),
  });
}
