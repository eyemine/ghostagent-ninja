'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import Image from 'next/image';
import { useEciesDecrypt } from '../../hooks/useEciesDecrypt';
import { ComposeEmail } from '../../components/ComposeEmail';
import ForwardingSetup from '../../components/ForwardingSetup';

function isAgentAddress(addr: string): boolean {
  if (!addr) return false;
  const local = addr.includes('@') ? addr.split('@')[0] : addr;
  return local.endsWith('_');
}

function BlurFrom({ from }: { from: string }) {
  if (!from || from === 'unknown') return <span className="text-white/70">unknown</span>;
  if (isAgentAddress(from)) return <span className="text-white/70">{from}</span>;
  return (
    <span className="relative inline-block select-none" title="Sender identity protected">
      <span className="blur-sm text-white/70 pointer-events-none">{from}</span>
    </span>
  );
}

function stripHtml(html: unknown): string {
  if (html === null || html === undefined) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/\u202f/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function MsgBodyView({ body, bodyHtml }: { body: string; bodyHtml: string }) {
  const [tab, setTab] = useState<'text' | 'html'>('text');
  const hasHtml = bodyHtml && bodyHtml.includes('<');
  const plainText = stripHtml(body || bodyHtml || '');
  return (
    <div className="rounded-lg border border-[var(--border)] bg-black/20 overflow-hidden">
      {hasHtml && (
        <div className="flex border-b border-[var(--border)]">
          {(['text', 'html'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-[10px] font-semibold tracking-wider transition ${tab === t ? 'bg-white/5 text-white' : 'text-[var(--muted)] hover:text-white'}`}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {tab === 'html' && hasHtml ? (
        <iframe
          srcDoc={bodyHtml}
          sandbox="allow-same-origin"
          className="w-full min-h-[200px] bg-white"
          style={{ border: 'none' }}
          title="Email HTML"
        />
      ) : (
        <p className="px-4 py-3 text-xs text-[var(--muted)] leading-relaxed whitespace-pre-wrap break-words">
          {plainText || '(no content)'}
        </p>
      )}
    </div>
  );
}

interface InboxMessage {
  id: string;
  subject: string;
  sender: string;
  fromAddress: string;
  receivedTime: string;
  summary: string;
  body: string;
  bodyHtml: string;
  encrypted: boolean;
  contentHash: string;
  type: string;
  decayPct: number;
  expiresAt: string | null;
  frozen?: boolean;
  decayDays?: number | null;
}

interface AuditEntry {
  id: string;
  from: string;
  to: string;
  subject: string;
  content: string;
  timestamp: number;
  contentHash: string;
  verified: boolean;
  redacted?: boolean;
  redactionReason?: string;
}

interface FeedItem {
  key: string;
  subject: string;
  from: string;
  timestamp: number;
  channel: string;
  contentHash?: string;
  body?: string;
  encrypted?: boolean;
  redacted?: boolean;
  direction?: string;
}

interface MoltTransition {
  agent: string;
  fromTld: string;
  toTld: string;
  block: number;
  timestamp: number;
  status: string;
}

interface ResolveResult {
  name: string;
  exists: boolean;
  expired?: boolean;
  stream: string;
  privacyTier: 'exposed' | 'private' | 'hard-privacy';
  hasMessages: boolean;
  hasEciesKey: boolean;
  hasZohoSeat: boolean;
  collection?: string;
  collectionName?: string;
  tokenId?: string;
  socialPair?: [string, string];
  sovereign?: boolean;
  accountTier?: 'basic' | 'lite' | 'premium' | 'ghost';
  expiresAt?: number | null;
  canSend?: boolean;
  canRenew?: boolean;
  safe?: string | null;
  storyIp?: string | null;
  onChainOwner?: string | null;
  originNft?: string | null;
  messagesCleared?: boolean;
  availability?: {
    status: string;
    type: string;
    collectionName?: string;
    assignedName?: string;
    tokenId?: string;
    pair?: [string, string];
    name?: string;
    message?: string;
  };
}

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

export default function InboxPage() {
  const params = useParams();
  const router = useRouter();
  const name = params.name as string;
  const isAgent = name?.endsWith('_');

  // Redirect: hyphenated sovereign names → dot-separated (mac-slave → mac.slave)
  // Hyphens are not valid sovereign email separators — dots are canonical
  useEffect(() => {
    if (!name || isAgent) return;
    if (name.includes('-')) {
      router.replace(`/inbox/${name.replace(/-/g, '.')}`);
    }
  }, [name, isAgent, router]);

  // Auth state
  const { authenticated, user, login, logout } = usePrivy();

  // Address resolution state
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [resolving, setResolving] = useState(true);

  // Inbox state (only used when account exists)
  const [privacyTier, setPrivacyTier] = useState<'exposed' | 'private' | 'hard-privacy'>('exposed');
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Agent classification state
  const [agentTld, setAgentTld] = useState<string>('');
  const [isGlassbox, setIsGlassbox] = useState(false);
  const [classificationDone, setClassificationDone] = useState(false);

  // Molt agent state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [transitions, setTransitions] = useState<MoltTransition[]>([]);

  // Privacy toggle in-flight
  const [togglingPrivacy, setTogglingPrivacy] = useState(false);

  // Owner check: if onChainOwner is recorded, require wallet match.
  // If not recorded (legacy mints pre-ownership tracking), fall back to authenticated.
  const isOwner = useMemo(() => {
    if (!authenticated) return false;
    if (!resolved?.onChainOwner) return authenticated; // legacy: trust session
    const owner = resolved.onChainOwner.toLowerCase();
    const wallets: string[] = [];
    if (user?.wallet?.address) wallets.push(user.wallet.address.toLowerCase());
    if (user?.linkedAccounts) {
      for (const acct of user.linkedAccounts) {
        if ((acct as any).address) wallets.push((acct as any).address.toLowerCase());
      }
    }
    return wallets.includes(owner);
  }, [authenticated, resolved?.onChainOwner, user]);

  const agentName = name?.endsWith('_') ? name.slice(0, -1) : name;

  // ECIES decrypt: only active for agent inboxes where owner is authenticated
  const eciesAgent = isAgent && isOwner ? agentName : null;
  const {
    keyState,
    hasKey,
    blindMessages,
    decryptedMessages,
    decryptError: eciesDecryptError,
    decryptingCount,
    loadBlindInbox,
    loadKey,
    generateAndRegisterKey,
    forgetKey,
  } = useEciesDecrypt(eciesAgent);

  // Key management UI state
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [generatedKeyPair, setGeneratedKeyPair] = useState<{ publicKey: string; privateKey: string } | null>(null);

  // Folder / compose state
  type Folder = 'inbox' | 'compose';
  const [activeFolder, setActiveFolder] = useState<Folder>('inbox');

  // Step 1: Resolve the address (+ agent classification if agent route)
  useEffect(() => {
    if (!name) return;
    (async () => {
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolveAddress', name }),
        });
        const data: ResolveResult = await res.json();
        setResolved(data);
        setPrivacyTier(data.privacyTier || 'exposed');

        // For agents, tld + isPublic are now embedded in resolveAddress response
        if (isAgent && agentName) {
          setAgentTld((data as any).tld || 'nftmail.gno');
          setIsGlassbox((data as any).isPublic === true);
          setClassificationDone(true);
        } else {
          setClassificationDone(true);
        }
      } catch {
        setResolved({ name, exists: false, stream: 'unknown', privacyTier: 'exposed', hasMessages: false, hasEciesKey: false, hasZohoSeat: false, availability: { status: 'invalid', type: 'error', message: 'Failed to resolve address' } });
      }
      setResolving(false);
    })();
  }, [name, isAgent, agentName]);

  // Step 2: Load inbox if account exists
  const loadInbox = useCallback(async () => {
    if (!name || !resolved?.exists) return;
    setLoading(true);
    try {
      if (isAgent) {
        // Glassbox agents: fetch audit log from Moltworker proxy
        if (isGlassbox) {
          try {
            const auditRes = await fetch(`https://${agentName}-proxy.richard-159.workers.dev/audit`);
            if (auditRes.ok) {
              const auditData = await auditRes.json() as { auditLog?: any[] };
              setAuditEntries((auditData.auditLog || []).map((e: any) => ({
                id: e.id,
                from: e.from,
                to: e.to,
                subject: e.subject,
                content: e.content || '',
                timestamp: e.timestamp,
                contentHash: e.contentHash,
                verified: true,
              })));
            }
          } catch {}
        }

        // Fetch inbox messages from KV worker
        try {
          const kvRes = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getInbox', localPart: name }),
          });
          if (kvRes.ok) {
            const kvData = await kvRes.json() as { messages?: any[] };
            const kvMessages = (kvData.messages || []).map((m: any) => {
              const rawRa = m.receivedAt || 0;
              const receivedMs = rawRa > 0 && rawRa < 1e12 ? rawRa * 1000 : rawRa;
              return {
                id: m.id || `msg-${Math.random().toString(36).slice(2)}`,
                subject: m.subject || '(no subject)',
                sender: m.from || m.senderAgent || 'unknown',
                fromAddress: m.from || '',
                receivedTime: receivedMs ? new Date(receivedMs).toISOString() : '',
                summary: m.content || (m.payload?.body ? stripHtml(m.payload.body).slice(0, 200) : ''),
                body: m.payload?.body || m.content || '',
                bodyHtml: m.payload?.bodyHtml || (m.payload?.body?.includes('<') ? m.payload.body : ''),
                encrypted: !!m.encrypted,
                contentHash: m.plaintextHash || '',
                type: m.channel || m.type || 'a2a',
                decayPct: 0,
                expiresAt: '',
              };
            });
            setMessages(kvMessages);
          }
        } catch {}

        setLoading(false);
        return;
      }

      const res = await fetch(`/api/inbox?email=${encodeURIComponent(name + '@nftmail.box')}`);
      const data = await res.json() as { error?: string; messages?: any[]; [key: string]: any };
      if (data.error && !data.messages) {
        setError(data.error);
        setLoading(false);
        return;
      }
      setMessages(
        (data.messages || []).map((m: any) => ({
          id: m.id || `msg-${Math.random().toString(36).slice(2)}`,
          subject: stripHtml(m.subject || '(no subject)'),
          sender: m.sender || m.fromAddress || 'unknown',
          fromAddress: m.fromAddress || '',
          receivedTime: m.receivedTime || '',
          summary: stripHtml(m.summary || ''),
          body: m.body || m.summary || '',
          bodyHtml: m.bodyHtml || '',
          encrypted: m.encrypted ?? false,
          contentHash: m.contentHash || '',
          type: m.type || '',
          decayPct: m.decayPct ?? 0,
          expiresAt: m.expiresAt || '',
        }))
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load inbox');
    }
    setLoading(false);
  }, [name, resolved, isAgent, isGlassbox, agentName]);

  useEffect(() => {
    if (resolved?.exists && classificationDone) loadInbox();
  }, [resolved, classificationDone, loadInbox]);

  // Load blind inbox (ECIES envelopes) when owner views agent inbox
  useEffect(() => {
    if (isAgent && isOwner && resolved?.exists) loadBlindInbox();
  }, [isAgent, isOwner, resolved, loadBlindInbox]);

  // Unified feed for glassbox agents: merge audit entries + inbox messages
  const glassboxFeed = useMemo<FeedItem[]>(() => {
    if (!isGlassbox) return [];
    const feed: FeedItem[] = [];
    const inboxSubjects = new Set<string>();
    for (const msg of messages) {
      const ts = msg.receivedTime ? new Date(msg.receivedTime).getTime() : 0;
      inboxSubjects.add(msg.subject.toLowerCase().trim());
      feed.push({
        key: `msg-${msg.id}`,
        subject: msg.subject,
        from: msg.sender,
        timestamp: ts,
        channel: msg.type || 'email',
        body: msg.summary || '',
        encrypted: msg.encrypted,
      });
    }
    for (const entry of auditEntries) {
      if (inboxSubjects.has((entry.subject || '').toLowerCase().trim())) continue;
      const isTgInbound = entry.id.startsWith('tg-in-');
      const isTgOutbound = entry.id.startsWith('tg-out-');
      const isTg = isTgInbound || isTgOutbound;
      const isMoltbook = entry.id.startsWith('moltbook-');
      const dir = isTgInbound || entry.id.startsWith('in-') ? 'inbound' : 'outbound';
      feed.push({
        key: `audit-${entry.id}`,
        subject: isTgOutbound ? entry.subject : (entry.subject || '(no subject)'),
        from: entry.from,
        timestamp: entry.timestamp,
        channel: isTg ? 'telegram' : isMoltbook ? 'moltbook' : 'audit',
        contentHash: entry.contentHash,
        body: entry.content || '',
        redacted: entry.redacted,
        direction: dir,
      });
    }
    feed.sort((a, b) => b.timestamp - a.timestamp);
    return feed;
  }, [isGlassbox, messages, auditEntries]);

  // Privacy tier toggle: exposed → private (and vice versa). hard-privacy requires payment.
  const handlePrivacyToggle = async () => {
    if (togglingPrivacy) return;
    const nextTier = privacyTier === 'exposed' ? 'private' : 'exposed';
    setTogglingPrivacy(true);
    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setPrivacy', localPart: agentName, tier: nextTier }),
      });
      setPrivacyTier(nextTier);
    } catch {}
    setTogglingPrivacy(false);
  };

  const handleDelete = async (messageId: string) => {
    if (!confirm('Delete this message permanently?')) return;
    setDeletingId(messageId);
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteMessage', localPart: agentName, messageId }),
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== messageId));
        if (expandedId === messageId) setExpandedId(null);
      }
    } catch {}
    setDeletingId(null);
  };

  const formatTimeAgo = (ts: string) => {
    const ms = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const formatTimestamp = (ts: number | string) => {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  const daysRemaining = (expiresAt: string) => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return '0d';
    const d = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return `${d}d`;
  };


  const decayColor = (pct: number) => {
    if (pct < 25) return 'bg-emerald-400';
    if (pct < 50) return 'bg-blue-400';
    if (pct < 75) return 'bg-amber-400';
    return 'bg-red-400';
  };

  // ─── LOADING SPINNER ───
  if (resolving) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,var(--background),#03040a)] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
          <span className="text-sm text-[var(--muted)]">Resolving {name}@nftmail.box...</span>
        </div>
      </div>
    );
  }

  // ─── MESSAGES CLEARED (basic tier): identity permanent, inbox address active ───
  if (resolved && resolved.exists && resolved.messagesCleared) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8 md:px-6">
          <header className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
            </Link>
            {authenticated ? (
              <button onClick={logout} className="rounded-full border border-emerald-500/30 bg-emerald-500/8 px-4 py-1.5 text-[10px] font-semibold text-emerald-300 transition hover:border-red-500/30 hover:text-red-400">
                {user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}` : 'Disconnect'}
              </button>
            ) : (
              <button onClick={login} className="rounded-full border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-4 py-1.5 text-[10px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]">
                Connect Wallet
              </button>
            )}
          </header>
          <div className="flex flex-col items-center justify-center flex-1 gap-6 py-12">
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3">
              <span className="text-lg font-medium text-white">{name}@nftmail.box</span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 bg-zinc-500/10 text-zinc-400 ring-zinc-500/20">MESSAGES CLEARED</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-zinc-400" />
              <span className="text-sm font-medium text-amber-300">8-day history window — inbox address is permanent</span>
            </div>
            <p className="text-center text-sm text-[var(--muted)] max-w-md">
              Your <strong className="text-white">{name}@nftmail.box</strong> is permanent — free tier messages clear after 8 days.
              Upgrade to <strong className="text-amber-300">Lite ($10)</strong> for 30-day retention,
              sending, and a <strong className="text-white">Gnosis Safe body</strong>.
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <Link
                href={`/nftmail?upgrade=lite&label=${name}`}
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20 text-center"
              >
                Upgrade to Lite — $10
              </Link>
              <Link
                href={`/nftmail?upgrade=premium&label=${name}`}
                className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-6 py-2.5 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/20 text-center"
              >
                Go Premium — $60/yr
              </Link>
            </div>
          </div>
          <footer className="text-center text-[10px] text-[var(--muted)] pb-2">
            nftmail.box — Privacy is a Right, Sovereignty is an Upgrade
          </footer>
        </div>
      </div>
    );
  }

  // ─── ADDRESS DOES NOT EXIST / SOVEREIGN RESERVED: AVAILABILITY STATES ───
  if (resolved && !resolved.exists) {
    const avail = resolved.availability;
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8 md:px-6">
          <header className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
            </Link>
            {authenticated ? (
            <button onClick={logout} className="rounded-full border border-emerald-500/30 bg-emerald-500/8 px-4 py-1.5 text-[10px] font-semibold text-emerald-300 transition hover:border-red-500/30 hover:text-red-400">
              {user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}` : 'Disconnect'}
            </button>
          ) : (
            <button onClick={login} className="rounded-full border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-4 py-1.5 text-[10px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]">
              Connect Wallet
            </button>
          )}
          </header>

          <div className="flex flex-col items-center justify-center flex-1 gap-6 py-12">
            {/* Address display */}
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/30 px-5 py-3">
              <span className="text-lg font-medium text-white">{name}@nftmail.box</span>
            </div>

            {/* ── ENS / Flat name: "vitalik" ── */}
            {avail?.type === 'ens' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-300">NFTmail inbox available</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)] max-w-md">
                  Connect with <strong className="text-white">ENS NFT wallet</strong> to claim
                  {' '}<strong className="text-white">{name}@nftmail.box</strong>
                  {' '}<span className="text-emerald-400">(free — treasury-funded gas for first 100,000)</span>
                </p>
                <Link
                  href="/nftmail"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Connect ENS Wallet
                </Link>
              </>
            )}

            {/* ── Approved NFT Collection: "chonk.1" ── */}
            {avail?.type === 'nft-collection' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-300">NFTmail inbox available</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)] max-w-md">
                  Connect with <strong className="text-white">{avail.collectionName}</strong> token ID
                  {' '}<strong className="text-white">{avail.tokenId}</strong> NFT wallet
                </p>
                <Link
                  href="/nftmail"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Connect NFT Wallet
                </Link>
              </>
            )}

            {/* ── Unknown NFT Collection: "punk.6529" ── */}
            {avail?.type === 'nft-unknown' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="text-sm font-medium text-red-300">Collection not approved</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)] max-w-md">
                  Collection not approved — <strong className="text-white">apply to whitelist</strong> your NFT collection
                </p>
                <div className="flex gap-3">
                  <Link
                    href="/nftmail"
                    className="rounded-lg border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-5 py-2.5 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]"
                  >
                    View Approved Collections
                  </Link>
                </div>
              </>
            )}

            {/* ── Name Pair: "fresh.boy" — reserved for no-coiners (email/social login) ── */}
            {avail?.type === 'name-pair' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-300">Address available</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)] max-w-md">
                  Sign up with <strong className="text-white">email</strong> or
                  {' '}<strong className="text-white">social login</strong> to claim
                  {' '}<strong className="text-white">{name}@nftmail.box</strong> — no wallet required
                </p>
                <Link
                  href="/nftmail"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Sign Up
                </Link>
              </>
            )}

            {/* ── Agent available: "freshboy_" ── */}
            {avail?.type === 'agent' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-300">Agent inbox available</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)] max-w-md">
                  {avail.message || `Mint ${name}@nftmail.box as your Sovereign Sensory Layer agent`}
                </p>
                <Link
                  href="/nftmail"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Mint Agent
                </Link>
              </>
            )}

            {/* ── Invalid format ── */}
            {avail?.status === 'invalid' && (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="text-sm font-medium text-red-300">Invalid address</span>
                </div>
                <p className="text-center text-sm text-[var(--muted)]">{avail.message}</p>
              </>
            )}
          </div>

          <footer className="text-center text-[10px] text-[var(--muted)] pb-2">
            nftmail.box — Privacy is a Right, Sovereignty is an Upgrade
          </footer>
        </div>
      </div>
    );
  }

  // ─── AGENT VIEW: glassbox (molt.gno) vs blackbox (agent.gno, vault.gno, etc.) ───
  if (isAgent) {
    const hasMolted = transitions.length > 0;
    const boxLabel = isGlassbox ? 'GLASS BOX' : 'BLACK BOX';
    const tldLabel = agentTld || (isGlassbox ? 'molt.gno' : 'agent.gno');

    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(124,77,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(0,163,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
          <header className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
            </Link>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${isGlassbox ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' : 'bg-slate-500/10 text-slate-300 ring-slate-500/20'}`}>{boxLabel}</span>
              {authenticated ? (
                <button onClick={logout} className="rounded-full border border-emerald-500/30 bg-emerald-500/8 px-4 py-1.5 text-[10px] font-semibold text-emerald-300 transition hover:border-red-500/30 hover:text-red-400">
                  {user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}` : 'Disconnect'}
                </button>
              ) : (
                <button onClick={login} className="rounded-full border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-4 py-1.5 text-[10px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]">Connect</button>
              )}
            </div>
          </header>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 ${isGlassbox ? 'border-violet-500/30 bg-violet-500/8' : 'border-slate-500/30 bg-slate-500/8'}`}>
              <div className={`h-2 w-2 rounded-full ${isGlassbox ? (hasMolted ? 'bg-emerald-400' : 'bg-violet-400 animate-pulse') : 'bg-slate-400'}`} />
              <span className="text-sm font-medium text-white">{name}@nftmail.box</span>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${isGlassbox ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' : 'bg-slate-500/10 text-slate-300 ring-slate-500/20'}`}>
              {hasMolted ? 'SOVEREIGN (MOLTED)' : tldLabel}
            </span>
          </div>

          {/* Glassbox: public audit log explanation */}
          {isGlassbox && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
                <span className="text-xs font-semibold text-violet-300">PUBLIC AUDIT LOG</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                This agent operates under <strong className="text-violet-300">molt.gno</strong> governance.
                All incoming instructions are logged as <strong className="text-white">Verified Agent Instructions</strong> with SHA-256 content hashes.
              </p>
            </div>
          )}

          {/* Blackbox: encrypted inbox explanation */}
          {!isGlassbox && (
            <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
                <span className="text-xs font-semibold text-slate-300">ENCRYPTED INBOX</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                This agent operates under <strong className="text-slate-300">{tldLabel}</strong> governance.
                All messages are <strong className="text-white">ECIES-encrypted</strong> and only readable by the NFT owner&apos;s wallet.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${isGlassbox ? 'border-violet-400' : 'border-slate-400'}`} />
            </div>
          )}

          {/* Glassbox: unified activity feed */}
          {!loading && isGlassbox && glassboxFeed.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg className="h-12 w-12 text-violet-400 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 8l-10 5L2 8" /></svg>
              <p className="text-sm text-[var(--muted)]">No instructions received yet</p>
            </div>
          )}
          {!loading && isGlassbox && glassboxFeed.length > 0 && (
            <div className="space-y-3">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">ACTIVITY FEED ({glassboxFeed.length})</span>
              {glassboxFeed.map((item) => {
                const isOut = item.direction === 'outbound';
                const channelColor =
                  item.channel === 'telegram' ? 'bg-sky-500/10 text-sky-300 ring-sky-500/20' :
                  item.channel === 'moltbook' ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' :
                  (item.channel === 'ghost-wire' || item.channel === 'a2a') ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' :
                  'bg-blue-500/10 text-blue-300 ring-blue-500/20';
                return (
                  <div key={item.key} className={`rounded-xl border p-4 space-y-2 ${item.redacted ? 'border-amber-500/25 bg-amber-500/5' : 'border-[var(--border)] bg-[var(--card)]'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${item.redacted ? 'text-amber-300' : 'text-white'}`}>{item.subject}</span>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {isOut ? 'To: ' : 'From: '}
                          <BlurFrom from={isOut ? item.from : item.from} />
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`rounded-full px-1.5 py-0.5 text-[8px] ring-1 ${isOut ? 'bg-violet-500/10 text-violet-300 ring-violet-500/20' : 'bg-blue-500/10 text-blue-300 ring-blue-500/20'}`}>{isOut ? '↑ out' : '↓ in'}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[8px] ring-1 ${channelColor}`}>{item.channel}</span>
                        <span className="text-[10px] text-[var(--muted)] whitespace-nowrap">{item.timestamp ? formatTimeAgo(new Date(item.timestamp).toISOString()) : ''}</span>
                      </div>
                    </div>
                    {item.body && !item.encrypted && (
                      <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                        <p className="text-xs text-[var(--muted)] leading-relaxed whitespace-pre-line">{stripHtml(item.body)}</p>
                      </div>
                    )}
                    {item.encrypted && (
                      <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2">
                        <p className="text-xs text-amber-300/70">Content encrypted — connect NFT owner wallet to decrypt</p>
                      </div>
                    )}
                    {item.contentHash && !item.body && (
                      <div className="flex items-center gap-1.5">
                        <svg className="h-3 w-3 text-violet-400/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                        <code className="text-[9px] font-mono text-violet-300/50 truncate" title={item.contentHash}>SHA-256: {item.contentHash.slice(0, 16)}…</code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Blackbox: standard inbox */}
          {!loading && !isGlassbox && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg className="h-12 w-12 text-slate-400 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 8l-10 5L2 8" /></svg>
              <p className="text-sm text-[var(--muted)]">No messages yet</p>
            </div>
          )}
          {!loading && !isGlassbox && messages.length > 0 && (
            <div className="space-y-3">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">INBOX ({messages.length})</span>
              {messages.map((msg) => (
                <div key={msg.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-white">{msg.subject}</span>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">From: <BlurFrom from={msg.sender} /></p>
                    </div>
                    <div className="flex items-center gap-2">
                      {msg.encrypted && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-300 ring-1 ring-amber-500/20">ENCRYPTED</span>
                      )}
                      {msg.type && (
                        <span className="rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[8px] text-slate-300 ring-1 ring-slate-500/20">{msg.type}</span>
                      )}
                      <span className="text-[10px] text-[var(--muted)]">{msg.receivedTime ? formatTimeAgo(msg.receivedTime) : ''}</span>
                    </div>
                  </div>
                  {msg.summary && !msg.encrypted && (
                    <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                      <p className="text-xs text-[var(--muted)] leading-relaxed whitespace-pre-line">{stripHtml(msg.summary)}</p>
                    </div>
                  )}
                  {msg.encrypted && (
                    <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2">
                      <p className="text-xs text-amber-300/70">Content encrypted — connect NFT owner wallet to decrypt</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <footer className="text-center text-[10px] text-[var(--muted)]">
            {isGlassbox
              ? 'nftmail.box — Transparency is the only guard against the rogue AI'
              : 'nftmail.box — Privacy is a Right, Sovereignty is an Upgrade'}
          </footer>
        </div>
      </div>
    );
  }

  // ─── STANDARD INBOX VIEW (account exists) ───
  const accountTier = (resolved as any)?.accountTier || 'basic';
  const expiresAt: number | null = (resolved as any)?.expiresAt ?? null;
  const canSend: boolean = (resolved as any)?.canSend ?? false;
  const safeAddress: string | null = (resolved as any)?.safe ?? null;
  const tierDecayDays = (resolved as any)?.decayDays ?? (accountTier === 'lite' ? 30 : accountTier === 'basic' ? 8 : null);
  const tierDecayMs = tierDecayDays ? tierDecayDays * 24 * 60 * 60 * 1000 : null;
  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24))) : null;
  const decayPct = (expiresAt && tierDecayMs && (accountTier === 'lite' || accountTier === 'basic')) 
    ? Math.min(100, Math.max(0, Math.round((1 - (expiresAt - Date.now()) / tierDecayMs) * 100)))
    : null;
  const isImago = accountTier === 'premium' || accountTier === 'ghost';
  const showLarvaWarning = accountTier === 'basic' && daysLeft !== null && daysLeft <= 7;

  // Forwarding configuration state (after isImago is defined)
  const [forwardingConfig, setForwardingConfig] = useState<{
    enabled: boolean;
    targetEmail: string;
    level: 'imago' | 'ghost';
  } | null>(null);
  const [loadingForwarding, setLoadingForwarding] = useState(false);

  // Load forwarding configuration
  useEffect(() => {
    if (!name || !isImago || !isOwner) return;

    const loadForwarding = async () => {
      try {
        setLoadingForwarding(true);
        const response = await fetch(`/api/forwarding/${name}`);
        if (response.ok) {
          const data = await response.json();
          setForwardingConfig(data);
        }
      } catch (error) {
        console.error('Failed to load forwarding config:', error);
      } finally {
        setLoadingForwarding(false);
      }
    };

    loadForwarding();
  }, [name, isImago, isOwner]);

  // Save forwarding configuration
  const handleSaveForwarding = async (config: any) => {
    if (!user?.wallet?.address) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(`/api/forwarding/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          ownerAddress: user.wallet.address
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save forwarding settings');
      }

      const data = await response.json();
      setForwardingConfig(data);
    } catch (error: any) {
      throw new Error(error.message || 'Failed to save forwarding settings');
    }
  };

  const acctTierLabel = accountTier === 'ghost' ? 'AGENT' : accountTier === 'premium' ? 'IMAGO' : accountTier === 'lite' ? 'PUPA' : 'LARVA';
  const acctTierColor = accountTier === 'ghost'
    ? 'text-violet-300 bg-violet-500/10 ring-violet-500/20'
    : accountTier === 'premium'
    ? 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20'
    : accountTier === 'lite'
    ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20'
    : 'text-amber-300 bg-amber-500/10 ring-amber-500/20';

  const tierLabel = privacyTier === 'hard-privacy' ? 'HARD PRIVACY' : privacyTier === 'private' ? 'PRIVATE' : 'EXPOSED';
  const tierColor = privacyTier === 'hard-privacy'
    ? 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20'
    : privacyTier === 'private'
    ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20'
    : 'text-amber-300 bg-amber-500/10 ring-amber-500/20';
  const dotColor = privacyTier === 'hard-privacy' ? 'bg-cyan-400' : privacyTier === 'private' ? 'bg-emerald-400' : 'bg-amber-400';
  const isBlurred = privacyTier === 'private';

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-4 py-6 md:px-6">

        {/* ── Header ── */}
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
            <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
          </Link>
          {authenticated ? (
            <button onClick={logout} className="rounded-full border border-emerald-500/30 bg-emerald-500/8 px-4 py-1.5 text-[10px] font-semibold text-emerald-300 transition hover:border-red-500/30 hover:text-red-400">
              {user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}` : 'Disconnect'}
            </button>
          ) : (
            <button onClick={login} className="rounded-full border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-4 py-1.5 text-[10px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]">
              Connect Wallet
            </button>
          )}
        </header>

        {/* ── Identity bar ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/30 px-4 py-2">
                <div className={`h-2 w-2 rounded-full ${dotColor}`} />
                <span className="text-sm font-medium text-white">{name}@nftmail.box</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${acctTierColor}`}>
                {acctTierLabel}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${tierColor}`}>
                {tierLabel}
              </span>
            </div>

            {/* Privacy toggle: exposed ↔ private — only for authenticated owner */}
            {isOwner ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrivacyToggle}
                disabled={togglingPrivacy || privacyTier === 'hard-privacy'}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold transition ${
                  privacyTier === 'private'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : privacyTier === 'hard-privacy'
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 cursor-default'
                    : 'border-[var(--border)] bg-black/20 text-[var(--muted)] hover:text-white'
                } disabled:opacity-50`}
              >
                {togglingPrivacy ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : privacyTier !== 'exposed' ? (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                ) : (
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                )}
                {privacyTier === 'hard-privacy' ? 'LOCKED' : privacyTier === 'private' ? 'PRIVATE' : 'EXPOSED'}
              </button>
                {privacyTier === 'exposed' && (
                <span className="text-[9px] text-[var(--muted)]">toggle to blur</span>
              )}
            </div>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${
              privacyTier === 'private' ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20'
              : privacyTier === 'hard-privacy' ? 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20'
              : ''
            }`}>
              {privacyTier === 'private' ? 'PRIVATE' : privacyTier === 'hard-privacy' ? 'HARD PRIVACY' : ''}
            </span>
          )}
          </div>

          {/* Safe body address + decay bar + Larva warning */}
          {(safeAddress || decayPct !== null || showLarvaWarning || isImago) && (
            <div className="flex flex-col gap-2 px-1">
              {safeAddress && (
                <div className="flex items-center gap-2">
                  <svg className="h-3 w-3 text-emerald-400/60 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  <span className="text-[9px] text-[var(--muted)]">Mirror Body:</span>
                  <a
                    href={`https://gnosisscan.io/address/${safeAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-emerald-300/70 hover:text-emerald-300 transition"
                  >
                    {safeAddress.slice(0, 10)}...{safeAddress.slice(-6)}
                  </a>
                </div>
              )}
              {isImago && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-cyan-300/80">✦ Sovereign Identity — no decay</span>
                </div>
              )}
              {decayPct !== null && !isImago && daysLeft !== null && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        decayPct < 50 ? 'bg-emerald-400' : decayPct < 75 ? 'bg-amber-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${100 - decayPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-[var(--muted)]">{daysLeft}d left · {tierDecayDays}-day cycle</span>
                  <Link
                    href={`/nftmail?upgrade=lite&label=${name}`}
                    className="text-[9px] text-amber-300 hover:underline"
                  >renew</Link>
                </div>
              )}
              {showLarvaWarning && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-1.5">
                  <span className="text-[10px] text-amber-300">⚠ Your memory is nearly full ({daysLeft}d left). Molt to Pupa to extend to 30 days and deploy your Mirror Body.</span>
                  <Link href={`/nftmail?upgrade=lite&label=${name}`} className="ml-auto flex-shrink-0 text-[9px] font-semibold text-amber-300 hover:underline">Molt →</Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Email Forwarding Panel (Imago only) ── */}
        {isOwner && isImago && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <ForwardingSetup
              agentName={name}
              ownerAddress={user?.wallet?.address || ''}
              currentConfig={forwardingConfig || undefined}
              onSave={handleSaveForwarding}
            />
          </div>
        )}

        {/* ── Folder tabs + Compose button ── */}
        {isOwner && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-black/20 p-0.5">
              <button
                onClick={() => setActiveFolder('inbox')}
                className={`rounded-md px-3 py-1.5 text-[10px] font-semibold transition ${
                  activeFolder === 'inbox'
                    ? 'bg-[rgba(0,163,255,0.15)] text-[rgb(160,220,255)]'
                    : 'text-[var(--muted)] hover:text-white'
                }`}
              >
                Inbox {messages.length > 0 ? `(${messages.length})` : ''}
              </button>
              {canSend && (
                <button
                  onClick={() => setActiveFolder('compose')}
                  className={`rounded-md px-3 py-1.5 text-[10px] font-semibold transition ${
                    activeFolder === 'compose'
                      ? 'bg-[rgba(0,163,255,0.15)] text-[rgb(160,220,255)]'
                      : 'text-[var(--muted)] hover:text-white'
                  }`}
                >
                  Compose
                </button>
              )}
            </div>
            {canSend && activeFolder === 'inbox' && (
              <button
                onClick={() => setActiveFolder('compose')}
                className="flex items-center gap-1.5 rounded-lg border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-3 py-1.5 text-[10px] font-semibold text-[rgb(160,220,255)] hover:bg-[rgba(0,163,255,0.16)] transition"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                New Message
              </button>
            )}
          </div>
        )}

        {/* ── Compose panel ── */}
        {isOwner && activeFolder === 'compose' && (
          <div className="rounded-xl border border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.04)] p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-[rgb(160,220,255)] tracking-wider">NEW MESSAGE</h2>
              <button onClick={() => setActiveFolder('inbox')} className="text-[var(--muted)] hover:text-white transition">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <ComposeEmail
              label={name}
              ownerWallet={user?.wallet?.address || ''}
              onSent={() => { setTimeout(() => setActiveFolder('inbox'), 2000); }}
              onClose={() => setActiveFolder('inbox')}
            />
          </div>
        )}

        {/* ── Evolve panel: shown to owner on basic/lite tier ── */}
        {isOwner && (accountTier === 'basic' || accountTier === 'lite') && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <p className="text-sm font-semibold text-white">
                {accountTier === 'basic' ? 'You are a Larva.' : 'You are a Pupa.'}
              </p>
              <span className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 bg-amber-500/10 text-amber-300 ring-amber-500/20">
                {accountTier === 'basic' ? 'LARVA' : 'PUPA'}
              </span>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              {accountTier === 'basic'
                ? `${name}@nftmail.box · Your shell is temporary (8-day decay). Choose your next stage of metamorphosis.`
                : `${name}@nftmail.box · 30-day cycle. Evolve to Imago for infinite retention and sovereign relay.`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {accountTier === 'basic' && (
                <Link
                  href={`/nftmail?upgrade=lite&label=${name}`}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-center text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20"
                >
                  <span className="block text-sm font-bold">10 xDAI</span>
                  Molt to Pupa
                </Link>
              )}
              <Link
                href={`/nftmail?upgrade=premium&label=${name}`}
                className={`rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-center text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/20 ${
                  accountTier === 'basic' ? '' : 'col-span-2'
                }`}
              >
                <span className="block text-sm font-bold">24 xDAI<span className="text-[10px] font-normal text-[var(--muted)]">/yr</span></span>
                Evolve to Imago
              </Link>
            </div>
            {daysLeft !== null && daysLeft <= 7 && (
              <p className="text-[10px] text-amber-300">⚠ {daysLeft} day{daysLeft === 1 ? '' : 's'} remaining — renew before decay</p>
            )}
          </div>
        )}

        {/* ── Error state ── */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3">
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* ── Loading inbox ── */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.4)] border-t-transparent" />
          </div>
        )}

        {/* ── Private inbox: blurred placeholder (account exists + private/hard-privacy) ── */}
        {!loading && !error && privacyTier !== 'exposed' && messages.length === 0 && (
          <div className="space-y-2 select-none" aria-hidden="true">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2 blur-sm opacity-60">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className={`h-3 rounded bg-white/20 ${i === 0 ? 'w-48' : i === 1 ? 'w-36' : 'w-56'}`} />
                    <div className="h-2.5 w-32 rounded bg-white/10" />
                  </div>
                  <div className="h-2.5 w-12 rounded bg-white/10" />
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 space-y-1">
                  <div className={`h-2 rounded bg-white/10 ${i === 0 ? 'w-full' : i === 1 ? 'w-4/5' : 'w-3/4'}`} />
                  <div className="h-2 w-2/3 rounded bg-white/10" />
                </div>
              </div>
            ))}
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <svg className="h-8 w-8 text-emerald-400 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              <p className="text-xs font-medium text-emerald-300">This inbox is private</p>
              <p className="text-[10px] text-[var(--muted)]">Connect the owner wallet to view messages</p>
            </div>
          </div>
        )}

        {/* ── Empty state: account exists, exposed, but no emails ── */}
        {!loading && !error && privacyTier === 'exposed' && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <svg className="h-14 w-14 text-[var(--muted)] opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M22 8l-10 5L2 8" /></svg>
            <p className="text-sm text-[var(--muted)]">Inbox empty</p>
            <p className="text-[11px] text-[var(--muted)]">
              Send an email to <span className="text-white font-medium">{name}@nftmail.box</span>
            </p>
          </div>
        )}

        {/* ── Message count + Dashboard link ── */}
        {!loading && messages.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                INBOX ({messages.length})
              </span>
              <Link
                href={isOwner ? `/dashboard?email=${encodeURIComponent(name + '@nftmail.box')}` : '/nftmail'}
                className="rounded-md border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-[var(--muted)] hover:text-white hover:border-white/20 transition"
              >
                Dashboard
              </Link>
            </div>
            <span className="text-[9px] text-[var(--muted)]">
              {isImago ? '✦ Sovereign — no decay' : `Messages auto-delete after ${tierDecayDays ?? 8} days`}
            </span>
          </div>
        )}

        {/* ── Message list ── */}
        {!loading && messages.length > 0 && (
          <div className="space-y-2">
            {messages.map((msg) => {
              const isExpanded = expandedId === msg.id;
              const isDeleting = deletingId === msg.id;
              const remaining = msg.expiresAt ? daysRemaining(msg.expiresAt) : '∞';

              return (
                <div
                  key={msg.id}
                  className={`rounded-xl border transition-all duration-200 ${
                    msg.encrypted
                      ? 'border-cyan-500/20 bg-cyan-500/5'
                      : 'border-[var(--border)] bg-[var(--card)]'
                  } ${isExpanded ? 'ring-1 ring-[rgba(0,163,255,0.2)]' : ''}`}
                  style={isBlurred && !msg.encrypted ? { filter: 'blur(6px)', WebkitFilter: 'blur(6px)' } : undefined}
                >
                  {/* ── Collapsed row ── */}
                  <button
                    className="w-full text-left px-4 py-3 focus:outline-none"
                    onClick={() => {
                      if (isOwner && !isBlurred) setExpandedId(isExpanded ? null : msg.id);
                      if (!isOwner && privacyTier === 'exposed') setExpandedId(isExpanded ? null : msg.id);
                    }}
                    disabled={isBlurred && !isOwner}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {msg.encrypted && (
                            <svg className="h-3 w-3 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                          )}
                          {msg.frozen && (
                            <span className="text-[10px]" title="Frozen — High-Value Memory">❄️</span>
                          )}
                          <span className="truncate text-sm font-medium text-white">
                            {msg.encrypted ? 'Encrypted message' : msg.subject}
                          </span>
                        </div>
                        {!msg.encrypted && (
                          <p className="mt-0.5 text-xs text-[var(--muted)] truncate"><BlurFrom from={msg.sender} /></p>
                        )}
                        {!msg.encrypted && !isExpanded && msg.summary && (
                          <p className="mt-0.5 text-xs text-[var(--muted)] opacity-50 truncate">{stripHtml(msg.summary).slice(0, 120)}</p>
                        )}
                        {msg.encrypted && (
                          <code className="mt-1 block text-[9px] font-mono text-cyan-300/60 truncate">{msg.contentHash?.slice(0, 24)}...</code>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[10px] text-[var(--muted)]">{msg.receivedTime ? formatTimeAgo(msg.receivedTime) : ''}</span>
                        {msg.frozen ? (
                          <span className="text-[8px] text-cyan-300/70">❄️ hardened</span>
                        ) : isImago ? (
                          <span className="text-[8px] text-cyan-300/50">✦ sovereign</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <div className="h-1 w-12 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${decayColor(msg.decayPct)}`}
                                style={{ width: `${100 - msg.decayPct}%` }}
                              />
                            </div>
                            <span className="text-[8px] text-[var(--muted)]">{remaining}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* ── Expanded panel ── */}
                  {isExpanded && !isBlurred && (
                    <div className="border-t border-[var(--border)] px-4 py-3 space-y-3">
                      {msg.encrypted ? (
                        (() => {
                          const decrypted = decryptedMessages.find(d => d.id === msg.id);
                          if (decrypted) {
                            return (
                              <>
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-[var(--muted)]">From:</span>
                                    <BlurFrom from={decrypted.from} />
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-[var(--muted)]">Subject:</span>
                                    <span className="text-white">{decrypted.subject}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="text-[var(--muted)]">Date:</span>
                                    <span className="text-white/70">{formatTimestamp(decrypted.timestamp)}</span>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-cyan-500/20 bg-cyan-900/10 px-4 py-3">
                                  <div className="flex items-center gap-1.5 mb-2">
                                    <svg className="h-3 w-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                    <span className="text-[9px] font-semibold text-cyan-400 tracking-wider">DECRYPTED LOCALLY</span>
                                  </div>
                                  <p className="text-xs text-[var(--muted)] leading-relaxed whitespace-pre-wrap break-words">{decrypted.body}</p>
                                </div>
                                {decrypted.ipfsCid && (
                                  <p className="text-[9px] text-[var(--muted)]">IPFS: <code className="text-cyan-300/60">{decrypted.ipfsCid}</code></p>
                                )}
                              </>
                            );
                          }
                          if (decryptingCount > 0) {
                            return (
                              <div className="rounded-lg border border-cyan-500/15 bg-cyan-900/10 px-4 py-5 text-center">
                                <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent mb-2" />
                                <p className="text-xs text-cyan-300">Decrypting...</p>
                              </div>
                            );
                          }
                          return (
                            <div className="rounded-lg border border-cyan-500/15 bg-cyan-900/10 px-4 py-5 text-center space-y-2">
                              <svg className="mx-auto h-8 w-8 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                              <p className="text-xs text-cyan-300">ECIES encrypted at the edge</p>
                              {isOwner && keyState === 'missing' ? (
                                <button
                                  onClick={() => setShowKeyPanel(true)}
                                  className="mx-auto mt-1 flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition"
                                >
                                  Load decryption key
                                </button>
                              ) : (
                                <code className="block text-[9px] font-mono text-cyan-300/50 break-all">{msg.contentHash}</code>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-[var(--muted)]">From:</span>
                              <BlurFrom from={msg.sender} />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-[var(--muted)]">Date:</span>
                              <span className="text-white/70">{msg.receivedTime ? formatTimestamp(msg.receivedTime) : ''}</span>
                            </div>
                          </div>
                          <MsgBodyView body={msg.body || ''} bodyHtml={msg.bodyHtml || ''} />
                        </>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] text-[var(--muted)]">
                            Expires: {msg.expiresAt ? formatTimestamp(msg.expiresAt) : 'N/A'}
                          </span>
                          {msg.type && (
                            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[8px] text-[var(--muted)]">{msg.type}</span>
                          )}
                        </div>
                        {isOwner && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(msg.id); }}
                            disabled={isDeleting}
                            className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[10px] font-medium text-red-300 transition hover:bg-red-500/15 disabled:opacity-40"
                          >
                            {isDeleting ? (
                              <div className="h-3 w-3 animate-spin rounded-full border border-red-300 border-t-transparent" />
                            ) : (
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            )}
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── ECIES key management panel ── */}
        {isAgent && isOwner && (showKeyPanel || keyState === 'missing') && !hasKey && (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <span className="text-sm font-semibold text-white">ECIES Decryption Key</span>
              </div>
              <button onClick={() => setShowKeyPanel(false)} className="text-[var(--muted)] hover:text-white transition">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-[11px] text-[var(--muted)]">Your private key is stored only in this browser. It is never sent to any server.</p>

            {/* Paste existing key */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">PASTE EXISTING KEY</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  placeholder="32-byte hex private key (64 chars)"
                  className="flex-1 rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 outline-none focus:border-cyan-500/50"
                />
                <button
                  onClick={() => { loadKey(keyInput); setShowKeyPanel(false); }}
                  disabled={keyInput.replace(/^0x/, '').length !== 64}
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition disabled:opacity-40"
                >
                  Load
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] text-[var(--muted)]">or</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            {/* Generate new key */}
            {generatedKeyPair ? (
              <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] font-semibold text-amber-300">⚠ Save your private key now — it will not be shown again</p>
                <div className="space-y-1">
                  <label className="text-[9px] tracking-wider text-[var(--muted)]">PRIVATE KEY (save this)</label>
                  <code className="block rounded bg-black/40 px-2 py-1.5 text-[9px] font-mono text-amber-200 break-all select-all">{generatedKeyPair.privateKey}</code>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] tracking-wider text-[var(--muted)]">PUBLIC KEY (registered with worker)</label>
                  <code className="block rounded bg-black/40 px-2 py-1.5 text-[9px] font-mono text-cyan-300/70 break-all">{generatedKeyPair.publicKey}</code>
                </div>
                <button
                  onClick={() => { setGeneratedKeyPair(null); setShowKeyPanel(false); }}
                  className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition"
                >
                  I&apos;ve saved my key — continue
                </button>
              </div>
            ) : (
              <button
                onClick={async () => {
                  const kp = await generateAndRegisterKey(agentName);
                  if (kp) setGeneratedKeyPair(kp);
                }}
                disabled={keyState === 'generating'}
                className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2.5 text-xs font-semibold text-[var(--muted)] hover:text-white hover:border-cyan-500/30 transition disabled:opacity-40"
              >
                {keyState === 'generating' ? 'Generating...' : 'Generate new key pair'}
              </button>
            )}
          </div>
        )}

        {/* ── ECIES key status bar (when key is loaded) ── */}
        {isAgent && isOwner && hasKey && (
          <div className="flex items-center justify-between rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span className="text-[11px] text-cyan-300">
                {decryptingCount > 0 ? `Decrypting ${decryptingCount} message${decryptingCount > 1 ? 's' : ''}...` :
                  decryptedMessages.length > 0 ? `${decryptedMessages.length} message${decryptedMessages.length > 1 ? 's' : ''} decrypted locally` :
                  'Decryption key loaded'}
              </span>
              {eciesDecryptError && <span className="text-[10px] text-red-400">{eciesDecryptError}</span>}
            </div>
            <button onClick={forgetKey} className="text-[10px] text-[var(--muted)] hover:text-red-400 transition">Forget key</button>
          </div>
        )}

        {/* ── Blind inbox: decrypted messages (separate from regular inbox) ── */}
        {isAgent && isOwner && decryptedMessages.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold tracking-wider text-cyan-300/70">BLIND INBOX — DECRYPTED ({decryptedMessages.length})</span>
              <span className="text-[9px] text-[var(--muted)]">Decrypted locally, never sent to server</span>
            </div>
            {decryptedMessages.map(dm => {
              const isExpanded = expandedId === `blind-${dm.id}`;
              return (
                <div key={dm.id} className={`rounded-xl border border-cyan-500/20 bg-cyan-500/5 transition-all duration-200 ${isExpanded ? 'ring-1 ring-cyan-500/30' : ''}`}>
                  <button
                    className="w-full text-left px-4 py-3 focus:outline-none"
                    onClick={() => setExpandedId(isExpanded ? null : `blind-${dm.id}`)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <svg className="h-3 w-3 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                          <span className="truncate text-sm font-medium text-white">{dm.subject || '(no subject)'}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--muted)] truncate"><BlurFrom from={dm.from} /></p>
                        {!isExpanded && <p className="mt-0.5 text-xs text-[var(--muted)] opacity-50 truncate">{dm.body?.slice(0, 100)}</p>}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-[10px] text-[var(--muted)]">{formatTimestamp(dm.receivedAt)}</span>
                      </div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-cyan-500/15 px-4 py-3 space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs"><span className="text-[var(--muted)]">From:</span><span className="text-white">{dm.from}</span></div>
                        <div className="flex items-center gap-2 text-xs"><span className="text-[var(--muted)]">To:</span><span className="text-white/70">{dm.to}</span></div>
                        <div className="flex items-center gap-2 text-xs"><span className="text-[var(--muted)]">Sent:</span><span className="text-white/70">{formatTimestamp(dm.timestamp)}</span></div>
                      </div>
                      <div className="rounded-lg border border-cyan-500/20 bg-black/30 px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <svg className="h-3 w-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                          <span className="text-[9px] font-semibold text-cyan-400 tracking-wider">DECRYPTED LOCALLY — P-256 ECIES</span>
                        </div>
                        <p className="text-xs text-[var(--muted)] leading-relaxed whitespace-pre-wrap break-words">{dm.body}</p>
                      </div>
                      {dm.ipfsCid && (
                        <p className="text-[9px] text-[var(--muted)]">IPFS: <code className="text-cyan-300/60">{dm.ipfsCid}</code></p>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <code className="text-[8px] font-mono text-[var(--muted)] break-all">{dm.contentHash?.slice(0, 24)}...</code>
                        <button
                          onClick={async () => {
                            await fetch('https://nftmail-email-worker.richard-159.workers.dev', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'deleteMessage', localPart: agentName, messageId: dm.id }),
                            });
                            await loadBlindInbox();
                          }}
                          className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-[10px] font-medium text-red-300 transition hover:bg-red-500/15"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Evolve CTA ── */}
        <div className="mt-auto rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white">Evolve to Imago to molt</p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">Dedicated Pupa or Imago mailbox, send emails, attachments, +retention, deploy mirror body</p>
            </div>
            <Link
              href={`/nftmail?upgrade=pro&label=${encodeURIComponent(agentName)}`}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-2 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20 flex-shrink-0"
            >
              Evolve
            </Link>
          </div>
        </div>

        <footer className="text-center text-[10px] text-[var(--muted)] pb-2">
          nftmail.box — Privacy is a Right, Sovereignty is an Upgrade
        </footer>
      </div>
    </div>
  );
}
