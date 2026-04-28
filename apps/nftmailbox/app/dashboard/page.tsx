'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import Image from 'next/image';
import { WarrantCanary } from '../components/WarrantCanary';
import { MoltToPrivate } from '../components/MoltToPrivate';
import { TogglePrivacy } from '../components/TogglePrivacy';

function stripHtml(html: string): string {
  const s = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br[\s\S]*?\/>/gi, ' ')
    .replace(/<br>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, ' ')
    .replace(/<[\s\S]*?>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop CSS/style artifact tokens
  return s.split(' ').filter(t => {
    if (!t) return false;
    if (/[{}]/.test(t)) return false;
    if (/^[.#][a-zA-Z0-9_-]/.test(t)) return false;
    return true;
  }).join(' ').trim();
}

interface NftMailName {
  tokenId: number;
  label: string;
  email: string;
  gnoName: string;
}

interface InboxMessage {
  messageId: string;
  subject: string;
  sender: string;
  fromAddress: string;
  receivedTime: string;
  summary: string;
  body: string;
  bodyHtml?: string;
  encrypted: boolean;
  isRead: boolean;
  hasAttachment: boolean;
  decayPct: number;
  expiresAt: string;
}

type Tab = 'inbox' | 'compose' | 'killswitch';
type ViewMode = 'text' | 'html' | 'headers' | 'source';

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

export default function DashboardPage() {
  const { authenticated, login, logout, ready, user } = usePrivy();
  const [names, setNames] = useState<NftMailName[]>([]);
  const [selectedName, setSelectedName] = useState<NftMailName | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [inboxTier, setInboxTier] = useState<string>('');
  const [inboxNote, setInboxNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');

  // Reading pane state
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // Kill-switch state
  const [burning, setBurning] = useState(false);
  const [burnResult, setBurnResult] = useState<string | null>(null);
  const [burnScope, setBurnScope] = useState<'messages' | 'full'>('messages');

  // Privacy toggle state
  const [privacyEnabled, setPrivacyEnabled] = useState(false);
  const [privacyTier, setPrivacyTier] = useState<string>('exposed');

  const searchParams = useSearchParams();
  const emailParam = searchParams?.get('email') || null;
  const walletParam = searchParams?.get('wallet') || null;

  // Auto-connect wallet if param provided and not authenticated
  useEffect(() => {
    if (ready && !authenticated && walletParam) {
      login();
    }
  }, [ready, authenticated, walletParam, login]);

  // Derive wallet address safely from Privy session (avoids useWallets() crash)
  const walletAddress = user?.wallet?.address ||
    (user?.linkedAccounts as any[])?.find((a: any) => a?.address)?.address || null;
  const preferredWallet = walletAddress ? { address: walletAddress, getEthereumProvider: async () => (window as any).ethereum } : null;

  // Load persisted read IDs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nftmail:readIds');
      if (stored) setReadIds(new Set(JSON.parse(stored) as string[]));
    } catch {}
  }, []);

  const markRead = useCallback((messageId: string) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      try { localStorage.setItem('nftmail:readIds', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (messageId: string) => {
    if (!selectedName?.email) return;
    const label = selectedName.email.replace('@nftmail.box', '');
    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteMessage', localPart: label, messageId }),
      });
      setMessages(prev => prev.filter(m => m.messageId !== messageId));
      if (selectedMessage?.messageId === messageId) setSelectedMessage(null);
    } catch {}
  }, [selectedName, selectedMessage]);

  // Resolve NFTMail names for connected wallet
  const resolveNames = useCallback(async () => {
    if (!preferredWallet?.address) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/resolve-nftmail?address=${preferredWallet.address}`);
      const data = await res.json() as { error?: string; names?: NftMailName[] };
      if (!res.ok) throw new Error(data.error || 'Failed to resolve names');
      const resolved: NftMailName[] = data.names || [];
      setNames(resolved);
      if (resolved.length > 0 && !selectedName) {
        // If ?email= param matches one of the resolved names, pre-select it
        const match = emailParam ? resolved.find(n => n.email === emailParam) : null;
        setSelectedName(match || resolved[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to resolve NFTMail names');
    } finally {
      setLoading(false);
    }
  }, [preferredWallet?.address, selectedName]);

  // Fetch inbox for selected name
  const fetchInbox = useCallback(async () => {
    if (!selectedName) return;
    setLoadingInbox(true);
    try {
      const [inboxRes, resolveRes] = await Promise.all([
        fetch(`/api/inbox?email=${encodeURIComponent(selectedName.email)}`),
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolveAddress', name: selectedName.label }),
        }),
      ]);
      const data = await inboxRes.json() as { error?: string; messages?: any[]; tier?: string; note?: string };
      if (!inboxRes.ok) throw new Error(data.error || 'Failed to fetch inbox');
      setMessages(data.messages || []);
      setInboxNote(data.note || '');
      // Get account tier from resolveAddress — inbox API always returns 'free'
      const resolveData = await resolveRes.json() as { accountTier?: string };
      setInboxTier(resolveData.accountTier || data.tier || '');
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch inbox');
    } finally {
      setLoadingInbox(false);
    }
  }, [selectedName]);

  useEffect(() => {
    if (authenticated && preferredWallet?.address) {
      resolveNames();
    }
  }, [authenticated, preferredWallet?.address, resolveNames]);

  useEffect(() => {
    if (selectedName) {
      fetchInbox();
      setSelectedMessage(null);
    }
  }, [selectedName, fetchInbox]);

  // Send email
  const handleSend = async () => {
    if (!selectedName || !composeTo) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromEmail: selectedName.email,
          toAddress: composeTo,
          subject: composeSubject,
          content: composeBody,
          ownerWallet: walletAddress,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setSendResult(`Sent to ${composeTo}`);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
    } catch (err: any) {
      setSendResult(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  // Sovereign Kill-Switch: burn inbox messages or full agent identity
  const handleBurn = async (scope: 'messages' | 'full' = burnScope) => {
    if (!selectedName || !preferredWallet) return;
    setBurning(true);
    setBurnResult(null);
    try {
      const provider = await preferredWallet.getEthereumProvider();
      const scopeLabel = scope === 'full' ? 'ALL IDENTITY DATA AND' : '';
      const message = `SOVEREIGN BURN: Permanently delete ${scopeLabel} all inbox data for ${selectedName.email} at ${new Date().toISOString()}`;
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, preferredWallet.address],
      });

      const res = await fetch('/api/burn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localPart: selectedName.label,
          signature,
          scope,
        }),
      });
      const data = await res.json() as { error?: string; messagesDeleted?: number; identityKeysDeleted?: string[]; scope?: string };
      if (!res.ok) throw new Error(data.error || 'Burn failed');
      const idCount = data.identityKeysDeleted?.length ?? 0;
      const summary = scope === 'full'
        ? `Purged ${data.messagesDeleted} messages + ${idCount} identity keys. Full sovereign burn complete.`
        : `Purged ${data.messagesDeleted} messages. Sovereign burn complete.`;
      setBurnResult(summary);
      setMessages([]);
      setSelectedMessage(null);
    } catch (err: any) {
      if (err?.code === 4001) {
        setBurnResult('Signature rejected — burn cancelled.');
      } else {
        setBurnResult(err?.message || 'Burn failed');
      }
    } finally {
      setBurning(false);
    }
  };

  const formatTimeAgo = (ts: string) => {
    // Handle both ISO strings and numeric timestamps
    const epoch = Date.parse(ts) || parseInt(ts, 10) || Date.now();
    const ms = Date.now() - epoch;
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const decayBarColor = (pct: number) => {
    if (pct < 50) return 'bg-emerald-500';
    if (pct < 75) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const isAgentAlias = selectedName?.label?.endsWith('_') || false;
  const canSend = inboxTier === 'premium' || inboxTier === 'ghost' || inboxTier === 'lite' || isAgentAlias;
  const isImago = inboxTier === 'premium' || inboxTier === 'ghost';

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8 md:px-6">
        <WarrantCanary />

        {/* Header */}
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
            <Image src="/nftmail-logo.png" alt="NFTMail" width={40} height={40} className="opacity-95" />
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
          </Link>
          <div className="flex items-center gap-3">
            {authenticated && preferredWallet && (
              <span className="text-xs text-[var(--muted)]">{preferredWallet.address.slice(0, 6)}...{preferredWallet.address.slice(-4)}</span>
            )}
            {authenticated ? (
              <button onClick={logout} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-red-500/30 hover:text-red-400">Disconnect</button>
            ) : (
              <button onClick={login} className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-4 py-2 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]">Connect Wallet</button>
            )}
          </div>
        </header>

        {!authenticated && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold">NFTMail Dashboard</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Connect your wallet to access your NFTMail inbox</p>
            </div>
            <button onClick={login} className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-8 py-4 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] hover:shadow-[0_0_32px_rgba(0,163,255,0.12)]">Connect Wallet</button>
            <p className="text-[10px] text-[var(--muted)]">Supports Privy email login, MetaMask, Rabby, or any injected wallet holding NFTMail.gno</p>
          </div>
        )}

        {authenticated && loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
              <span className="text-sm text-[var(--muted)]">Resolving NFTMail names...</span>
            </div>
          </div>
        )}

        {authenticated && !loading && names.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="text-center">
              <h2 className="text-xl font-semibold">No NFTMail names found</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">This wallet doesn&apos;t hold any NFTMail.gno NFTs.</p>
            </div>
            <Link href="/nftmail" className="rounded-xl border border-emerald-500/35 bg-emerald-500/8 px-6 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/16">Mint NFTMail Address</Link>
          </div>
        )}

        {/* ── Dashboard ── */}
        {authenticated && !loading && names.length > 0 && (
          <>
            {/* Account selector + tier badge */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                {names.length === 1 ? (
                  <span className="text-sm font-medium text-emerald-300">{selectedName?.email}</span>
                ) : (
                  <select
                    value={selectedName?.label || ''}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const n = names.find((n: NftMailName) => n.label === e.target.value);
                      if (n) setSelectedName(n);
                    }}
                    className="bg-transparent text-sm font-medium text-emerald-300 outline-none"
                  >
                    {names.map((n: NftMailName) => (
                      <option key={n.tokenId} value={n.label} className="bg-black text-white">{n.email}</option>
                    ))}
                  </select>
                )}
              </div>
              <span className="text-[10px] text-[var(--muted)]">{selectedName?.gnoName}</span>
              {inboxTier && (
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${
                  isImago ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20'
                    : canSend ? 'bg-amber-500/10 text-amber-300 ring-amber-500/20'
                    : 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20'
                }`}>
                  {isImago ? 'IMAGO' : canSend ? 'PUPA' : 'LARVA'}
                </span>
              )}
              {selectedName && (
                <a
                  href={`/inbox/${selectedName.label}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-white hover:border-white/20 transition flex items-center gap-1.5"
                >
                  <span>View Public Inbox</span>
                  <span className="text-[10px] opacity-60">opens in new tab</span>
                </a>
              )}
            </div>

            {/* Privacy toggle — agent accounts and _ aliases only (human emails are always private) */}
            {selectedName && preferredWallet && (selectedName.label.endsWith('.agent') || selectedName.label.endsWith('_') || selectedName.email.includes('.agent@')) && (
              <TogglePrivacy
                name={selectedName.label}
                walletAddress={preferredWallet.address}
                isImago={isImago}
                onPrivacyChange={(enabled: boolean) => { setPrivacyEnabled(enabled); setPrivacyTier(enabled ? 'private' : 'exposed'); }}
              />
            )}
            {selectedName && preferredWallet && (
              <MoltToPrivate name={selectedName.label} walletAddress={preferredWallet.address} onMolted={() => setPrivacyEnabled(true)} />
            )}

            {/* Tabs */}
            <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-black/20 p-1">
              <button
                onClick={() => setTab('inbox')}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${tab === 'inbox' ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]' : 'text-[var(--muted)] hover:text-white/60'}`}
              >
                Inbox{messages.length > 0 ? ` (${messages.length})` : ''}
              </button>
              <button
                onClick={() => canSend && setTab('compose')}
                title={!canSend ? 'Upgrade to PUPA or IMAGO to send' : undefined}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${tab === 'compose' ? 'bg-violet-500/12 text-violet-300' : canSend ? 'text-[var(--muted)] hover:text-white/60' : 'cursor-not-allowed opacity-40 text-[var(--muted)]'}`}
              >
                Compose <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] ring-1 ${isImago ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' : 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20'}`}>{isImago ? 'IMAGO' : 'PUPA+'}</span>
              </button>
              <button
                onClick={() => setTab('killswitch')}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${tab === 'killswitch' ? 'bg-red-500/12 text-red-300' : 'text-[var(--muted)] hover:text-white/60'}`}
              >
                Burn
              </button>
            </div>

            {/* ── INBOX TAB ── */}
            {tab === 'inbox' && (
              <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between border-b border-[var(--border)] bg-black/20 px-4 py-2">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INBOX{messages.length > 0 ? ` (${messages.length})` : ''}</span>
                    {!isImago && messages.length > 0 && (
                      <div className="hidden sm:flex items-center gap-3">
                        {[['bg-emerald-500','Fresh'],['bg-amber-500','Aging'],['bg-red-500','Expiring']].map(([c,l]) => (
                          <div key={l} className="flex items-center gap-1"><div className={`h-1.5 w-1.5 rounded-full ${c}`} /><span className="text-[9px] text-[var(--muted)]">{l}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={fetchInbox}
                    disabled={loadingInbox}
                    className="flex items-center gap-1.5 text-[10px] text-[rgb(160,220,255)] hover:text-white transition disabled:opacity-40"
                    title="Refresh inbox"
                  >
                    <svg className={`h-3 w-3 ${loadingInbox ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                    {loadingInbox ? 'Loading...' : 'Refresh'}
                  </button>
                </div>

                {inboxNote && (
                  <div className="border-b border-[var(--border)] bg-amber-500/5 px-4 py-2">
                    <p className="text-xs text-amber-300">{inboxNote}</p>
                  </div>
                )}

                {/* Split pane */}
                <div className="flex" style={{ minHeight: '460px' }}>
                  {/* Left: message list */}
                  <div className={`flex flex-col border-r border-[var(--border)] ${selectedMessage ? 'hidden md:flex md:w-2/5' : 'flex w-full md:w-2/5'}`}>
                    {loadingInbox && messages.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center py-12">
                        <div className="flex items-center gap-3">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
                          <span className="text-sm text-[var(--muted)]">Loading...</span>
                        </div>
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="flex flex-col flex-1 items-center justify-center py-12 gap-3">
                        <svg className="h-10 w-10 text-[var(--muted)] opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 8l-10 5L2 8" />
                        </svg>
                        <p className="text-sm text-[var(--muted)]">Inbox empty</p>
                        <p className="text-[10px] text-[var(--muted)] text-center">Send a test email to <span className="text-emerald-300">{selectedName?.email}</span></p>
                      </div>
                    ) : (
                      <div className="divide-y divide-[var(--border)] overflow-y-auto" style={{ maxHeight: '560px' }}>
                        {messages.map((msg: InboxMessage) => {
                          const isRead = readIds.has(msg.messageId) || msg.isRead;
                          const isSelected = selectedMessage?.messageId === msg.messageId;
                          return (
                            <button
                              key={msg.messageId}
                              onClick={() => { setSelectedMessage(msg); markRead(msg.messageId); setViewMode('text'); }}
                              className={`w-full text-left px-4 py-3 transition hover:bg-white/5 ${isSelected ? 'bg-[rgba(0,163,255,0.08)] border-l-2 border-[rgb(0,163,255)]' : 'border-l-2 border-transparent'}`}
                            >
                              <div className="flex items-start gap-2">
                                <div className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${!isRead ? 'bg-[rgb(0,163,255)]' : 'bg-transparent'}`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`truncate text-xs ${!isRead ? 'font-semibold text-white' : 'text-zinc-300'}`}>{msg.subject || '(no subject)'}</p>
                                  <p className="truncate text-[10px] text-[var(--muted)] mt-0.5">{msg.sender}</p>
                                  {msg.summary && <p className="truncate text-[10px] text-[var(--muted)] opacity-50 mt-0.5">{stripHtml(msg.summary)}</p>}
                                  <div className="flex items-center justify-between mt-1.5">
                                    <span className="text-[9px] text-[var(--muted)]">{formatTimeAgo(msg.receivedTime)}</span>
                                    {!isImago && (
                                      <div className="h-0.5 w-8 overflow-hidden rounded-full bg-white/5">
                                        <div className={`h-full rounded-full ${decayBarColor(msg.decayPct)}`} style={{ width: `${100 - msg.decayPct}%` }} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right: reading pane */}
                  <div className={`flex-1 flex flex-col ${selectedMessage ? 'flex' : 'hidden md:flex'}`}>
                    {selectedMessage ? (
                      <>
                        {/* Mobile back button */}
                        <button onClick={() => setSelectedMessage(null)} className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-2 text-[10px] text-[var(--muted)] hover:text-white transition md:hidden">
                          ← Back to inbox
                        </button>

                        {/* Message header */}
                        <div className="border-b border-[var(--border)] bg-black/20 px-5 py-4 space-y-1">
                          <p className="text-sm font-semibold text-white">{selectedMessage.subject || '(no subject)'}</p>
                          <p className="text-[11px] text-[var(--muted)]"><span className="text-zinc-500 w-10 inline-block">From</span> {selectedMessage.sender}</p>
                          <p className="text-[11px] text-[var(--muted)]"><span className="text-zinc-500 w-10 inline-block">To</span> {selectedName?.email}</p>
                          <p className="text-[11px] text-[var(--muted)]"><span className="text-zinc-500 w-10 inline-block">Date</span> {formatTimeAgo(selectedMessage.receivedTime)}</p>
                        </div>

                        {/* View mode bar + action buttons */}
                        <div className="flex items-center justify-between border-b border-[var(--border)] bg-black/10 px-3 py-1.5">
                          <div className="flex items-center gap-0.5">
                            {((['text', ...(selectedMessage?.bodyHtml ? ['html'] : []), 'headers','source']) as ViewMode[]).map(m => (
                              <button key={m} onClick={() => setViewMode(m)} className={`rounded px-2.5 py-1 text-[10px] font-medium transition capitalize ${viewMode === m ? 'bg-white/10 text-white' : 'text-[var(--muted)] hover:text-white'}`}>{m}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-0.5">
                            {/* Reply */}
                            <button
                              disabled={!canSend}
                              title={!canSend ? 'PUPA+ required to reply' : 'Reply'}
                              onClick={() => { if (!canSend) return; setComposeTo(selectedMessage.fromAddress || selectedMessage.sender); setComposeSubject(`Re: ${selectedMessage.subject}`); setTab('compose'); }}
                              className="rounded p-1.5 text-[var(--muted)] transition hover:text-white disabled:opacity-30"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 00-4-4H4" /></svg>
                            </button>
                            {/* Forward */}
                            <button
                              disabled={!canSend}
                              title={!canSend ? 'PUPA+ required to forward' : 'Forward'}
                              onClick={() => { if (!canSend) return; setComposeSubject(`Fwd: ${selectedMessage.subject}`); setComposeBody(`\n\n-------- Forwarded Message --------\nFrom: ${selectedMessage.sender}\nSubject: ${selectedMessage.subject}\n\n${selectedMessage.body || selectedMessage.summary}`); setTab('compose'); }}
                              className="rounded p-1.5 text-[var(--muted)] transition hover:text-white disabled:opacity-30"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" /></svg>
                            </button>
                            {/* Download */}
                            <button
                              title="Download as .txt"
                              onClick={() => {
                                const content = `From: ${selectedMessage.sender}\nTo: ${selectedName?.email}\nSubject: ${selectedMessage.subject}\nDate: ${selectedMessage.receivedTime}\n\n${selectedMessage.body || selectedMessage.summary}`;
                                const blob = new Blob([content], { type: 'text/plain' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a'); a.href = url; a.download = `${selectedMessage.messageId}.txt`; a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="rounded p-1.5 text-[var(--muted)] transition hover:text-white"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            </button>
                            {/* Delete */}
                            <button
                              title="Delete message"
                              onClick={() => handleDelete(selectedMessage.messageId)}
                              className="rounded p-1.5 text-red-400/50 transition hover:text-red-400"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
                            </button>
                          </div>
                        </div>

                        {/* Message body */}
                        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: '380px' }}>
                          {selectedMessage.encrypted ? (
                            <div className="flex flex-col items-center gap-3 py-8">
                              <svg className="h-8 w-8 text-violet-400 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                              </svg>
                              <p className="text-sm text-violet-300">End-to-end encrypted</p>
                              <p className="text-[11px] text-[var(--muted)] text-center">This message is encrypted with your ECIES public key.</p>
                            </div>
                          ) : viewMode === 'html' && selectedMessage.bodyHtml ? (
                            <iframe srcDoc={selectedMessage.bodyHtml} sandbox="allow-same-origin" className="w-full min-h-[300px] bg-white rounded" style={{ border: 'none' }} title="Email HTML" />
                          ) : viewMode === 'text' ? (
                            <pre className="whitespace-pre-wrap font-sans text-xs text-zinc-200 leading-relaxed">{selectedMessage.body || selectedMessage.summary || '(empty)'}</pre>
                          ) : viewMode === 'headers' ? (
                            <div className="space-y-1.5 font-mono text-[11px]">
                              {[['Message-ID', selectedMessage.messageId],['From', selectedMessage.sender],['To', selectedName?.email || ''],['Subject', selectedMessage.subject],['Date', selectedMessage.receivedTime],['Decay', `${selectedMessage.decayPct}%`],['Expires', selectedMessage.expiresAt || 'never']].map(([k,v]) => (
                                <div key={k} className="flex gap-2"><span className="text-zinc-500 w-24 flex-shrink-0">{k}</span><span className="text-zinc-300 break-all">{v}</span></div>
                              ))}
                            </div>
                          ) : (
                            <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-400 leading-relaxed">{JSON.stringify(selectedMessage, null, 2)}</pre>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col flex-1 items-center justify-center gap-2 text-center py-12 px-6">
                        <svg className="h-8 w-8 text-[var(--muted)] opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 8l-10 5L2 8" />
                        </svg>
                        <p className="text-sm text-[var(--muted)]">Select a message to read</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── COMPOSE TAB ── */}
            {tab === 'compose' && (
              <div className="space-y-4">
                {!canSend && (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">UPCYCLED</span>
                      <span className="text-sm text-violet-300">Compose &amp; Send requires a PUPA or IMAGO mailbox</span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">Cycle your inbox on the <Link href="/nftmail" className="text-violet-300 hover:underline">mint page</Link> to unlock sending.</p>
                  </div>
                )}
                <div className={`rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4 ${!canSend ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">FROM</label>
                    <div className="mt-1 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm text-emerald-300">{selectedName?.email}</div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TO</label>
                    <input type="email" value={composeTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setComposeTo(e.target.value)} placeholder="recipient@example.com" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SUBJECT</label>
                    <input type="text" value={composeSubject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setComposeSubject(e.target.value)} placeholder="Subject" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">MESSAGE</label>
                    <textarea value={composeBody} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComposeBody(e.target.value)} placeholder="Write your message..." rows={8} className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]" />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[var(--muted)]">Attachments coming soon</p>
                    <button onClick={handleSend} disabled={sending || !composeTo} className="rounded-lg border border-violet-500/35 bg-violet-500/8 px-5 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/16 disabled:cursor-not-allowed disabled:opacity-40">{sending ? 'Sending...' : 'Send'}</button>
                  </div>
                  {sendResult && <p className={`text-xs ${sendResult.startsWith('Sent') ? 'text-emerald-400' : 'text-red-400'}`}>{sendResult}</p>}
                </div>
              </div>
            )}

            {/* ── BURN TAB ── */}
            {tab === 'killswitch' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-5">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
                    </svg>
                    <h3 className="text-sm font-semibold text-red-300">Sovereign Kill-Switch</h3>
                  </div>

                  <div className="flex gap-2 mb-4">
                    <button onClick={() => setBurnScope('messages')} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                      burnScope === 'messages' ? 'border-red-500/50 bg-red-500/15 text-red-300' : 'border-red-500/15 bg-transparent text-red-400/50 hover:bg-red-500/5'
                    }`}>Burn Messages</button>
                    <button onClick={() => setBurnScope('full')} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                      burnScope === 'full' ? 'border-red-500/50 bg-red-500/15 text-red-300' : 'border-red-500/15 bg-transparent text-red-400/50 hover:bg-red-500/5'
                    }`}>Full Identity Burn</button>
                  </div>

                  {burnScope === 'messages' && (
                    <p className="text-xs text-[var(--muted)] mb-4">Permanently burn all encrypted inbox history. All messages for <span className="text-emerald-300">{selectedName?.email}</span> will be deleted. Identity and routing remain active.</p>
                  )}
                  {burnScope === 'full' && (
                    <div className="mb-4 space-y-2">
                      <p className="text-xs text-red-400 font-semibold">This will permanently destroy the entire agent identity:</p>
                      <ul className="text-xs text-[var(--muted)] list-disc ml-4 space-y-0.5">
                        <li>All inbox messages (encrypted + cleartext)</li>
                        <li>Agent profile, beacon CID, and audit log</li>
                        <li>ERC-8004 registration records</li>
                        <li>Principal and TLD mappings</li>
                        <li>HITL approval state</li>
                        <li>Inbox routing (no new mail will be delivered)</li>
                      </ul>
                      <p className="text-xs text-red-400">A burn attestation will be recorded for 90 days (detectable by oracles).</p>
                    </div>
                  )}

                  <button onClick={() => handleBurn(burnScope)} disabled={burning} className="w-full rounded-lg border border-red-500/35 bg-red-500/8 px-5 py-3 text-xs font-semibold text-red-300 transition hover:bg-red-500/16 hover:shadow-[0_0_24px_rgba(239,68,68,0.12)] disabled:cursor-not-allowed disabled:opacity-40">
                    {burning ? 'Signing & Burning...' : burnScope === 'full' ? 'Sign & Burn Entire Identity' : 'Sign & Burn All Messages'}
                  </button>
                  {burnResult && <p className={`mt-3 text-xs ${burnResult.includes('complete') ? 'text-emerald-400' : 'text-red-400'}`}>{burnResult}</p>}
                </div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        <footer className="mt-auto flex items-center justify-center gap-3 text-xs text-[var(--muted)]">
          <span>nftmail.box dashboard — privacy-first email</span>
          <Link href="/nftmail" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/20 transition whitespace-nowrap">
            Upcycle to Imago →
          </Link>
        </footer>
      </div>
    </div>
  );
}
