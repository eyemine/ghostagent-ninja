import { NextRequest, NextResponse } from 'next/server';
import type { StoredFile, StorageState } from '../../../services/storage-quota-manager';
import { defaultState, MB } from '../../../services/storage-quota-manager';
import { WORKER_URL } from '../../../utils/config';

const BASE_URL = process.env.NEXTJS_BASE_URL ?? 'https://ghostagent.ninja';

async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kvGet', key }) }).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { value?: string }).value ?? null;
}
async function kvPut(key: string, value: string): Promise<void> {
  await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kvPut', key, value }) }).catch(() => {});
}

async function readState(agent: string): Promise<StorageState> {
  const [usedRaw, capRaw, filesRaw] = await Promise.all([
    kvGet(`storage:${agent}:used`), kvGet(`storage:${agent}:cap`), kvGet(`storage:${agent}:files`),
  ]);
  const usedBytes = parseInt(usedRaw ?? '0', 10);
  const capBytes = parseInt(capRaw ?? String(100 * MB), 10);
  const files: StoredFile[] = filesRaw ? JSON.parse(filesRaw) : [];
  const bps = capBytes > 0 ? Math.round((usedBytes / capBytes) * 10000) : 0;
  return { agentName: agent, usedBytes, capBytes, remainingBytes: Math.max(0, capBytes - usedBytes), bps, files };
}

async function writeState(agent: string, s: StorageState): Promise<void> {
  await Promise.all([
    kvPut(`storage:${agent}:used`, String(s.usedBytes)),
    kvPut(`storage:${agent}:cap`, String(s.capBytes)),
    kvPut(`storage:${agent}:files`, JSON.stringify(s.files)),
  ]);
}

async function sendStorageAlert(agentName: string, s: StorageState, level: '80' | '95' | '100'): Promise<void> {
  const usedMB = (s.usedBytes / MB).toFixed(0);
  const capMB = (s.capBytes / MB).toFixed(0);
  await fetch(`${BASE_URL}/api/mail/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName, from: 'storage-guardrail@ghostagent.ninja',
      subject: `[${agentName}] Storage ${level}% — ${usedMB}MB/${capMB}MB used`,
      body: `Agent storage at ${level}%.\nUsed: ${usedMB}MB / ${capMB}MB\nFiles: ${s.files.length}`,
      internal: true,
    }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  if (!agent) return NextResponse.json({ error: 'Missing agent' }, { status: 400 });
  try { return NextResponse.json(await readState(agent.toLowerCase())); }
  catch { return NextResponse.json(defaultState(agent.toLowerCase())); }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: string; agentName?: string; file?: StoredFile; cid?: string; capBytes?: number; arweaveTxId?: string; };
  const agent = body.agentName?.toLowerCase();
  if (!agent) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
  const s = await readState(agent);

  switch (body.action) {
    case 'add': {
      const file = body.file;
      if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
      const newUsed = s.usedBytes + file.sizeBytes;
      if (newUsed > s.capBytes) return NextResponse.json({ error: 'Storage quota exceeded — upload blocked' }, { status: 507 });
      const updated: StorageState = { ...s, usedBytes: newUsed, remainingBytes: s.capBytes - newUsed, bps: Math.round((newUsed / s.capBytes) * 10000), files: [...s.files, file] };
      await writeState(agent, updated);
      if (updated.bps >= 9500) await sendStorageAlert(agent, updated, '95');
      else if (updated.bps >= 8000) await sendStorageAlert(agent, updated, '80');
      if (updated.bps >= 8000) { const { autoArchive } = await import('../../../services/arweave-auto-archive'); autoArchive(agent, updated).catch(() => {}); }
      return NextResponse.json(updated);
    }
    case 'remove': {
      const file = s.files.find(f => f.cid === body.cid);
      if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
      const newUsed = Math.max(0, s.usedBytes - file.sizeBytes);
      const updated: StorageState = { ...s, usedBytes: newUsed, remainingBytes: s.capBytes - newUsed, bps: Math.round((newUsed / s.capBytes) * 10000), files: s.files.filter(f => f.cid !== body.cid) };
      await writeState(agent, updated);
      return NextResponse.json(updated);
    }
    case 'configure': {
      const capBytes = body.capBytes ?? s.capBytes;
      const updated: StorageState = { ...s, capBytes, remainingBytes: Math.max(0, capBytes - s.usedBytes), bps: capBytes > 0 ? Math.round((s.usedBytes / capBytes) * 10000) : 0 };
      await writeState(agent, updated);
      return NextResponse.json(updated);
    }
    case 'mark-archived': {
      const updated: StorageState = { ...s, files: s.files.map(f => f.cid === body.cid ? { ...f, archived: true, arweaveTxId: body.arweaveTxId } : f) };
      await writeState(agent, updated);
      return NextResponse.json(updated);
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
