'use client';
import { useEffect, useState, useCallback } from 'react';
import { decryptMail } from '../services/mail-ingest-crypto';
import type { EncryptedMail } from '../services/mail-ingest-crypto';

interface StoredMail {
  id: string; from: string; subject: string; receivedAt: number;
  body?: string; encrypted?: EncryptedMail; glassbox: boolean; contentHash: string;
}
interface DisplayMail {
  id: string; from: string; subject: string; receivedAt: number;
  body: string; glassbox: boolean; contentHash: string; decrypted: boolean;
}
interface Props { agentName: string; privateKey: CryptoKey | null; isGlassBox?: boolean; }
const fmt = (ts: number) => new Date(ts).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

export function AgentInbox({ agentName, privateKey, isGlassBox = false }: Props) {
  const [mails, setMails] = useState<DisplayMail[]>([]);
  const [raws, setRaws] = useState<StoredMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/mail/inbox?agent=${encodeURIComponent(agentName)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { mails?: StoredMail[]; unread?: number };
      const s = data.mails ?? [];
      setRaws(s);
      setMails(s.map(m => ({ id: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt, body: m.body ?? '', glassbox: m.glassbox, contentHash: m.contentHash, decrypted: m.glassbox || !m.encrypted })));
      setUnread(data.unread ?? 0);
    } catch (e: any) { setError(e?.message ?? 'Failed'); }
    finally { setLoading(false); }
  }, [agentName]);

  useEffect(() => { load(); }, [load]);

  async function handleDecrypt(id: string) {
    const raw = raws.find(m => m.id === id);
    if (!raw?.encrypted || !privateKey) return;
    try {
      const plain = await decryptMail(raw.encrypted, privateKey);
      setMails(prev => prev.map(m => m.id === id ? { ...m, body: plain.body, decrypted: true } : m));
    } catch { setError('Decryption failed'); }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/mail/inbox?agent=${encodeURIComponent(agentName)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setMails(prev => prev.filter(m => m.id !== id));
    if (sel === id) setSel(null);
  }

  const selMail = mails.find(m => m.id === sel);
  if (loading) return <div className="py-12 text-center text-sm text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-900/40 px-4 py-3 text-sm text-red-400">{error}</div>;
  if (mails.length === 0) return <div className="py-8 text-center text-sm text-[var(--muted)]">No messages</div>;

  return <AgentInboxView mails={mails} selMail={selMail} sel={sel} setSel={setSel} unread={unread} isGlassBox={isGlassBox} agentName={agentName} onDecrypt={handleDecrypt} onDelete={handleDelete} onRefresh={load} privateKey={privateKey} />;
}

interface ViewProps {
  mails: DisplayMail[]; selMail: DisplayMail | undefined; sel: string | null;
  setSel: (id: string) => void; unread: number; isGlassBox: boolean;
  agentName: string; privateKey: CryptoKey | null;
  onDecrypt: (id: string) => void; onDelete: (id: string) => void; onRefresh: () => void;
}

function AgentInboxView({ mails, selMail, sel, setSel, unread, isGlassBox, agentName, privateKey, onDecrypt, onDelete, onRefresh }: ViewProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#f2eee4]">{agentName}_@nftmail.box</span>
          {isGlassBox && <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] text-amber-400">GlassBox</span>}
          {unread > 0 && <span className="rounded-full bg-[#b0805c] px-2 py-0.5 text-[10px] text-white">{unread} new</span>}
        </div>
        <button onClick={onRefresh} className="text-[11px] text-[var(--muted)] underline hover:text-white">Refresh</button>
      </div>
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto">
          {mails.map(m => (
            <button key={m.id} onClick={() => setSel(m.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-[11px] transition ${sel === m.id ? 'border-[#b0805c] bg-[#b0805c]/10' : 'border-[var(--border)] hover:border-white/20'}`}>
              <div className="truncate font-medium text-[#f2eee4]">{m.subject || '(no subject)'}</div>
              <div className="truncate text-[var(--muted)]">{m.from}</div>
              <div className="text-[var(--muted)]">{fmt(m.receivedAt)}</div>
              {!m.decrypted && <div className="text-[10px] text-amber-400">locked</div>}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[#0d0a07]">
          {selMail ? (
            <>
              <div className="border-b border-[var(--border)] px-4 py-3">
                <div className="text-sm font-semibold text-[#f2eee4]">{selMail.subject || '(no subject)'}</div>
                <div className="text-[11px] text-[var(--muted)]">From: {selMail.from} · {fmt(selMail.receivedAt)}</div>
                {selMail.glassbox && <div className="text-[10px] text-amber-400">GlassBox · {selMail.contentHash.slice(0,16)}…</div>}
                <button onClick={() => onDelete(selMail.id)} className="mt-1 text-[10px] text-red-400 underline">Delete</button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {selMail.decrypted
                  ? <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#c8bfb0]">{selMail.body || '(empty)'}</pre>
                  : <div className="flex flex-col items-center gap-3 py-8">
                      <div className="text-sm text-[var(--muted)]">Encrypted — decrypts client-side only</div>
                      <button onClick={() => onDecrypt(selMail.id)} disabled={!privateKey}
                        className="rounded-lg bg-[#b0805c] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
                        {privateKey ? 'Decrypt' : 'No key loaded'}
                      </button>
                    </div>}
              </div>
            </>
          ) : <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">Select a message</div>}
        </div>
      </div>
    </div>
  );
}
