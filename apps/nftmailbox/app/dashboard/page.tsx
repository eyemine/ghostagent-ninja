'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { WarrantCanary } from '../components/WarrantCanary';
import { TogglePrivacy } from '../components/TogglePrivacy';
import { MoltToPrivate } from '../components/MoltToPrivate';

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
  isRead: boolean;
  hasAttachment: boolean;
  decayPct: number;
  expiresAt: string;
}

type Tab = 'inbox' | 'compose' | 'killswitch';

export default function DashboardPage() {
  const { authenticated, login, logout, ready } = usePrivy();
  const { wallets } = useWallets();

  const [names, setNames] = useState<NftMailName[]>([]);
  const [selectedName, setSelectedName] = useState<NftMailName | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [inboxTier, setInboxTier] = useState<string>('');
  const [inboxNote, setInboxNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');

  // Compose state
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  // Kill-switch state
  const [burning, setBurning] = useState(false);
  const [burnResult, setBurnResult] = useState<string | null>(null);

  // Privacy toggle state
  const [privacyEnabled, setPrivacyEnabled] = useState(false);

  const searchParams = useSearchParams();
  const emailParam = searchParams?.get('email') || null;

  const preferredWallet = wallets.find((w: any) => w?.walletClientType === 'injected') || wallets[0];

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
      const res = await fetch(`/api/inbox?email=${encodeURIComponent(selectedName.email)}`);
      const data = await res.json() as { error?: string; messages?: any[]; tier?: string; note?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to fetch inbox');
      setMessages(data.messages || []);
      setInboxTier(data.tier || '');
      setInboxNote(data.note || '');
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

  // Sovereign Kill-Switch: burn all encrypted history
  const handleBurn = async () => {
    if (!selectedName || !preferredWallet) return;
    setBurning(true);
    setBurnResult(null);
    try {
      // Request signature from wallet to authorise the burn
      const provider = await preferredWallet.getEthereumProvider();
      const message = `SOVEREIGN BURN: Permanently delete all inbox data for ${selectedName.email} at ${new Date().toISOString()}`;
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, preferredWallet.address],
      });

      // Call Worker purgeInbox
      const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'purgeInbox',
          localPart: selectedName.label,
          signature,
        }),
      });
      const data = await res.json() as { error?: string; messagesDeleted?: number };
      if (!res.ok) throw new Error(data.error || 'Burn failed');
      setBurnResult(`Purged ${data.messagesDeleted} messages. Sovereign burn complete.`);
      setMessages([]);
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
    const ms = Date.now() - (parseInt(ts, 10) || Date.parse(ts) || Date.now());
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const decayColor = (pct: number) => {
    if (pct < 50) return 'text-emerald-400';
    if (pct < 75) return 'text-amber-400';
    return 'text-red-400';
  };

  const decayBarColor = (pct: number) => {
    if (pct < 50) return 'bg-emerald-500';
    if (pct < 75) return 'bg-amber-500';
    return 'bg-red-500';
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-8 md:px-6">
        {/* Warrant Canary */}
        <WarrantCanary />

        {/* Header */}
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
            <Image src="/nftmail-logo.png" alt="NFTMail" width={40} height={40} className="opacity-95" />
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
          </Link>
          <div className="flex items-center gap-3">
            {authenticated && preferredWallet && (
              <span className="text-xs text-[var(--muted)]">
                {preferredWallet.address.slice(0, 6)}...{preferredWallet.address.slice(-4)}
              </span>
            )}
            {authenticated ? (
              <button
                onClick={logout}
                className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-red-500/30 hover:text-red-400"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={login}
                className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-4 py-2 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        {/* Not authenticated */}
        {!authenticated && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold">NFTMail Dashboard</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Connect your wallet to access your NFTMail inbox</p>
            </div>
            <button
              onClick={login}
              className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-8 py-4 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] hover:shadow-[0_0_32px_rgba(0,163,255,0.12)]"
            >
              Connect Wallet
            </button>
            <p className="text-[10px] text-[var(--muted)]">
              Supports Privy email login, MetaMask, Rabby, or any injected wallet holding NFTMail.gno
            </p>
          </div>
        )}

        {/* Authenticated but loading */}
        {authenticated && loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
              <span className="text-sm text-[var(--muted)]">Resolving NFTMail names...</span>
            </div>
          </div>
        )}

        {/* No names found */}
        {authenticated && !loading && names.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="text-center">
              <h2 className="text-xl font-semibold">No NFTMail names found</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                This wallet doesn't hold any NFTMail.gno NFTs.
              </p>
            </div>
            <Link
              href="/nftmail"
              className="rounded-xl border border-emerald-500/35 bg-emerald-500/8 px-6 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/16"
            >
              Mint NFTMail Address
            </Link>
          </div>
        )}

        {/* Dashboard with names */}
        {authenticated && !loading && names.length > 0 && (
          <>
            {/* Name selector */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                {names.length === 1 ? (
                  <span className="text-sm font-medium text-emerald-300">{selectedName?.email}</span>
                ) : (
                  <select
                    value={selectedName?.label || ''}
                    onChange={(e) => {
                      const n = names.find((n) => n.label === e.target.value);
                      if (n) setSelectedName(n);
                    }}
                    className="bg-transparent text-sm font-medium text-emerald-300 outline-none"
                  >
                    {names.map((n) => (
                      <option key={n.tokenId} value={n.label} className="bg-black text-white">
                        {n.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <span className="text-[10px] text-[var(--muted)]">{selectedName?.gnoName}</span>
            </div>

            {/* Privacy Toggle */}
            {selectedName && preferredWallet && (
              <TogglePrivacy
                name={selectedName.label}
                walletAddress={preferredWallet.address}
                onPrivacyChange={setPrivacyEnabled}
              />
            )}

            {/* Open Agency: Molt to Private (only for molt.gno agents) */}
            {selectedName && preferredWallet && (
              <MoltToPrivate
                name={selectedName.label}
                walletAddress={preferredWallet.address}
                onMolted={() => setPrivacyEnabled(true)}
              />
            )}

            {/* Tabs */}
            <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-black/20 p-1">
              <button
                onClick={() => setTab('inbox')}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${
                  tab === 'inbox'
                    ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                    : 'text-[var(--muted)] hover:text-white/60'
                }`}
              >
                Inbox {messages.length > 0 && `(${messages.length})`}
              </button>
              <button
                onClick={() => setTab('compose')}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${
                  tab === 'compose'
                    ? 'bg-violet-500/12 text-violet-300'
                    : 'text-[var(--muted)] hover:text-white/60'
                }`}
              >
                Compose
                <span className="ml-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-300 ring-1 ring-violet-500/20">
                  EVOLVED
                </span>
              </button>
              <button
                onClick={() => setTab('killswitch')}
                className={`flex-1 rounded-md px-4 py-2 text-xs font-semibold transition ${
                  tab === 'killswitch'
                    ? 'bg-red-500/12 text-red-300'
                    : 'text-[var(--muted)] hover:text-white/60'
                }`}
              >
                Burn
              </button>
            </div>

            {/* Inbox tab */}
            {tab === 'inbox' && (
              <div className="space-y-3">
                {/* 8-day decay legend */}
                <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">8-DAY DECAY INBOX</span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[9px] text-[var(--muted)]">Fresh</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        <span className="text-[9px] text-[var(--muted)]">Aging</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        <span className="text-[9px] text-[var(--muted)]">Expiring</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={fetchInbox}
                    disabled={loadingInbox}
                    className="text-[10px] text-[rgb(160,220,255)] hover:text-white transition disabled:opacity-40"
                  >
                    {loadingInbox ? 'Loading...' : 'Refresh'}
                  </button>
                </div>

                {inboxNote && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <p className="text-xs text-amber-300">{inboxNote}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      Free tier: receive-only via Cloudflare Worker email routing. Evolve to Pupa or Imago to enable sending.
                    </p>
                  </div>
                )}

                {loadingInbox && messages.length === 0 && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
                      <span className="text-sm text-[var(--muted)]">Loading inbox...</span>
                    </div>
                  </div>
                )}

                {!loadingInbox && messages.length === 0 && !inboxNote && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <svg className="h-12 w-12 text-[var(--muted)] opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <path d="M22 8l-10 5L2 8" />
                    </svg>
                    <p className="text-sm text-[var(--muted)]">Inbox empty</p>
                    <p className="text-[10px] text-[var(--muted)]">
                      Send a test email to <span className="text-emerald-300">{selectedName?.email}</span>
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {messages.map((msg, i) => (
                    <motion.div
                      key={msg.messageId}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: i * 0.03 }}
                      className={`group rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition hover:border-[rgba(0,163,255,0.25)] ${privacyEnabled ? '' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {!msg.isRead && (
                              <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[rgb(0,163,255)]" />
                            )}
                            <span className="truncate text-sm font-medium text-white">
                              {msg.subject}
                            </span>
                            {msg.hasAttachment && (
                              <svg className="h-3 w-3 flex-shrink-0 text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                              </svg>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">{msg.sender}</p>
                          {msg.summary && (
                            <p className="mt-1 truncate text-xs text-[var(--muted)] opacity-60">{msg.summary}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className="text-[10px] text-[var(--muted)]">{formatTimeAgo(msg.receivedTime)}</span>
                          {/* Decay bar */}
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-mono ${decayColor(msg.decayPct)}`}>
                              {8 - Math.floor(msg.decayPct / 12.5)}d left
                            </span>
                            <div className="h-1 w-12 overflow-hidden rounded-full bg-white/5">
                              <div
                                className={`h-full rounded-full transition-all ${decayBarColor(msg.decayPct)}`}
                                style={{ width: `${100 - msg.decayPct}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/inbox/${encodeURIComponent(selectedName?.email?.replace('@nftmail.box', '') || '')}`}
                              className="text-[9px] text-[rgba(0,163,255,0.6)] hover:text-[rgb(160,220,255)] transition"
                            >
                              Open inbox →
                            </Link>
                            <button
                              onClick={async () => {
                                if (!selectedName?.email) return;
                                const label = selectedName.email.replace('@nftmail.box', '');
                                try {
                                  await fetch('https://nftmail-email-worker.richard-159.workers.dev', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: 'deleteMessage', localPart: label, messageId: msg.messageId }),
                                  });
                                  fetchInbox();
                                } catch {}
                              }}
                              className="text-[9px] text-red-400/60 hover:text-red-400 transition"
                              title="Delete message"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Compose tab */}
            {tab === 'compose' && (
              <div className="space-y-4">
                {inboxTier !== 'premium' && (
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                        EVOLVED
                      </span>
                      <span className="text-sm text-violet-300">Compose & Send requires a PUPA or IMAGO mailbox</span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Evolve your inbox on the{' '}
                      <Link href="/nftmail" className="text-violet-300 hover:underline">
                        mint page
                      </Link>{' '}
                      to unlock sending, compose, and your Mirror Body Safe.
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">FROM</label>
                    <div className="mt-1 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm text-emerald-300">
                      {selectedName?.email}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TO</label>
                    <input
                      type="email"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="recipient@example.com"
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SUBJECT</label>
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      placeholder="Subject"
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">MESSAGE</label>
                    <textarea
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      placeholder="Write your message..."
                      rows={6}
                      className="mt-1 w-full resize-none rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[var(--muted)]">Attachments coming soon (size-limited)</p>
                    <button
                      onClick={handleSend}
                      disabled={sending || !composeTo || inboxTier !== 'premium'}
                      className="rounded-lg border border-violet-500/35 bg-violet-500/8 px-5 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/16 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                  {sendResult && (
                    <p className={`text-xs ${sendResult.startsWith('Sent') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sendResult}
                    </p>
                  )}
                </div>
              </div>
            )}
            {/* Kill-Switch tab */}
            {tab === 'killswitch' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-5">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                    </svg>
                    <h3 className="text-sm font-semibold text-red-300">Sovereign Kill-Switch</h3>
                  </div>
                  <p className="text-xs text-[var(--muted)] mb-4">
                    Permanently burn all encrypted inbox history from relay servers with a single Gnosis Safe signature.
                    This action is <strong className="text-red-400">irreversible</strong>. All messages for{' '}
                    <span className="text-emerald-300">{selectedName?.email}</span> will be deleted from KV storage.
                  </p>
                  <div className="rounded-lg border border-red-500/15 bg-black/20 px-4 py-3 mb-4">
                    <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-2">ARCHITECTURE</div>
                    <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                      Zero-Knowledge Architecture + Waku Metadata Privacy + 7-Day Governance Timelocks
                      <br />
                      <span className="text-red-300">If you don't hold the keys, you can't open the door.</span>
                    </p>
                  </div>
                  <button
                    onClick={handleBurn}
                    disabled={burning}
                    className="w-full rounded-lg border border-red-500/35 bg-red-500/8 px-5 py-3 text-xs font-semibold text-red-300 transition hover:bg-red-500/16 hover:shadow-[0_0_24px_rgba(239,68,68,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {burning ? 'Signing & Burning...' : 'Sign & Burn All Messages'}
                  </button>
                  {burnResult && (
                    <p className={`mt-3 text-xs ${
                      burnResult.includes('complete') ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {burnResult}
                    </p>
                  )}
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
          <span>nftmail.box dashboard — 8-day decay inbox — self-contained identity</span>
          <Link
            href="/nftmail"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/20 transition whitespace-nowrap"
          >
            Evolve to Imago →
          </Link>
        </footer>
      </div>
    </div>
  );
}
