'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { sdk } from '@farcaster/miniapp-sdk';
import { LOGO_URL, MAILBOX_ICON_URL, TIER_IMAGES, EMPTY_INBOX_URL, LOADING_LOGO_URL } from './images';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nftmail.box';
const TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3';
const BASE_USDC_CAIP19 = 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

type NftmailTier = 'free' | 'pro' | 'premium';
const TIER_META: Record<NftmailTier, { label: string; emoji: string; color: string; border: string; description: string; features: Array<[string,string]>; upgradeCta: string | null; upgradeFee: number }> = {
  free: {
    label: 'FREE', emoji: '👻', color: 'text-green-400', border: 'border-green-800',
    description: 'Free inbox secured by your Farcaster identity. 8-day history, 10 sends.',
    features: [['Inbox history','8 days'],['Outbound sends','10'],['Account expiry','Never'],['Identity','Farcaster FID']],
    upgradeCta: 'Upgrade to PRO 10 USDC one-time', upgradeFee: 10,
  },
  pro: {
    label: 'PRO', emoji: '⚡', color: 'text-yellow-400', border: 'border-yellow-800',
    description: 'Permanent inbox backed by a Base NFT beacon. 30-day history, 50 sends.',
    features: [['Inbox history','30 days'],['Outbound sends','50'],['Account expiry','Never'],['Beacon NFT','Base chain']],
    upgradeCta: 'Upgrade to PREMIUM 24 USDC annual', upgradeFee: 24,
  },
  premium: {
    label: 'PREMIUM', emoji: '👑', color: 'text-purple-400', border: 'border-purple-800',
    description: 'Sovereign agent inbox. Unlimited retention, 200 sends, full agent stack.',
    features: [['Inbox history','Unlimited'],['Outbound sends','200'],['Account expiry','Never'],['Agent stack','ghostagent.ninja']],
    upgradeCta: null, upgradeFee: 0,
  },
};
function normaliseTier(raw: string | undefined): NftmailTier {
  const t = (raw ?? '').toLowerCase();
  if (t === 'premium' || t === 'imago') return 'premium';
  if (t === 'pro' || t === 'pupa' || t === 'lite') return 'pro';
  return 'free';
}
function TierBadge({ tier, onClick }: { tier: NftmailTier; onClick: () => void }) {
  const m = TIER_META[tier];
  return (
    <button onClick={onClick} className={`bg-gray-900 border ${m.border} ${m.color} font-mono text-xs px-2.5 py-1 rounded-full transition-colors`}>
      {m.emoji} {m.label}
    </button>
  );
}
function TierAboutPanel({ tier, onClose, onUpgrade }: { tier: NftmailTier; onClose: () => void; onUpgrade: () => void }) {
  const m = TIER_META[tier];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-t-2xl p-6 pb-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className={`${m.color} font-mono text-xs font-bold tracking-widest uppercase`}>{m.emoji} {m.label}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-gray-300 text-sm mb-4">{m.description}</p>
        <div className="space-y-2 mb-5 text-xs text-gray-400">
          {m.features.map(([k,v]) => (
            <div key={k} className="flex justify-between"><span>{k}</span><span className="text-white">{v}</span></div>
          ))}
        </div>
        {m.upgradeCta && (
          <button onClick={() => { onClose(); onUpgrade(); }} className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg text-sm transition-colors">
            {m.upgradeCta} →
          </button>
        )}
        {!m.upgradeCta && (
          <div className="text-xs text-gray-500 text-center">Manage your agent at <span className="text-white">ghostagent.ninja</span></div>
        )}
      </div>
    </div>
  );
}

// ── Client-side ECIES decrypt (P-256 / AES-256-GCM — mirrors worker ecies.ts) ──
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const b = new Uint8Array(clean.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(clean.substr(i * 2, 2), 16);
  return b;
}
function wrapP256PrivateKey(raw: Uint8Array): ArrayBuffer {
  const prefix = new Uint8Array([0x30,0x41,0x02,0x01,0x00,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,0x27,0x30,0x25,0x02,0x01,0x01,0x04,0x20]);
  const out = new Uint8Array(prefix.length + raw.length);
  out.set(prefix); out.set(raw, prefix.length);
  return out.buffer;
}
async function eciesDecryptClient(envelopeJson: string, privHex: string): Promise<string> {
  const env = JSON.parse(envelopeJson) as { ephemeralPublicKey: string; iv: string; ciphertext: string };
  const ephPub = await crypto.subtle.importKey('raw', hexToBytes(env.ephemeralPublicKey) as unknown as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const recipPriv = await crypto.subtle.importKey('pkcs8', wrapP256PrivateKey(hexToBytes(privHex)) as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephPub }, recipPriv, 256);
  const keyMaterial = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('nftmail-ecies-v1'), info: new TextEncoder().encode('aes-256-gcm') },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(env.iv) as unknown as ArrayBuffer, tagLength: 128 }, aesKey, hexToBytes(env.ciphertext) as unknown as ArrayBuffer);
  return new TextDecoder().decode(dec);
}

// ── Safe markdown renderer — bold/italic/code/headings/blockquote only, no links ──
function SafeMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        // Horizontal rule
        if (/^---+$/.test(line.trim())) return <hr key={i} className="border-gray-700 my-1" />;
        // Heading
        const hMatch = line.match(/^(#{1,3})\s+(.*)/);
        if (hMatch) {
          const sizes = ['text-base font-bold text-white', 'text-sm font-bold text-white', 'text-xs font-bold text-gray-200'];
          return <p key={i} className={sizes[hMatch[1].length - 1]}>{renderInline(hMatch[2])}</p>;
        }
        // Blockquote
        if (line.startsWith('> ')) return (
          <p key={i} className="border-l-2 border-gray-600 pl-2 text-gray-400 text-xs italic">{renderInline(line.slice(2))}</p>
        );
        // Empty line → spacer
        if (line.trim() === '') return <div key={i} className="h-1" />;
        // Normal line
        return <p key={i} className="text-gray-300 text-xs leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode[] {
  // Strip any markdown link syntax [label](url) → just show label
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Strip bare URLs (no rendering as anchors)
  text = text.replace(/https?:\/\/\S+/g, '[link]');
  const parts: React.ReactNode[] = [];
  // Tokenise bold+italic, bold, italic, inline code
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={idx++}>{text.slice(last, m.index)}</span>);
    if (m[2]) parts.push(<strong key={idx++} className="font-bold italic text-white">{m[2]}</strong>);
    else if (m[3]) parts.push(<strong key={idx++} className="font-semibold text-white">{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={idx++} className="italic text-gray-200">{m[4]}</em>);
    else if (m[5]) parts.push(<code key={idx++} className="bg-gray-800 text-green-300 px-1 rounded text-[10px] font-mono">{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={idx++}>{text.slice(last)}</span>);
  return parts;
}

type Step = 'loading' | 'entry' | 'naming' | 'signin' | 'provisioning' | 'success' | 'already' | 'inbox' | 'compose' | 'sending' | 'sent' | 'upgrade' | 'error';

interface ProvisionResult {
  status: string;
  agentName?: string;
  humanEmail?: string;
  expiresAt?: number;
  error?: string;
}

interface InboxMessage {
  id: string;
  from: string;
  to?: string;      // for sent messages
  subject: string;
  body?: string;    // set after client-side ECIES decrypt
  content?: string; // raw from worker getInbox (maps to payload.body)
  receivedAt: number;
  encrypted?: boolean;
  type?: 'inbox' | 'sent';
}

interface InboxResult {
  messages: InboxMessage[];
  sendsRemaining: number | string;
  tier?: string;
  error?: string;
}

export default function MiniApp() {
  const [step, setStep] = useState<Step>('loading');
  const [fid, setFid] = useState<number | null>(null);
  const [customName, setCustomName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [humanEmail, setHumanEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [inboxTier, setInboxTier] = useState<NftmailTier>('free');
  const [showTierAbout, setShowTierAbout] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [sentMessages, setSentMessages] = useState<InboxMessage[]>([]);
  const [sendsRemaining, setSendsRemaining] = useState<number | string>(10);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [eciesPrivKey, setEciesPrivKey] = useState<string | null>(null);
  const [openMsgId, setOpenMsgId] = useState<string | null>(null);
  const otpRequestedRef = useRef(false);

  // Draft auto-save to localStorage every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (composeTo || composeSubject || composeBody) {
        const draft = {
          to: composeTo,
          cc: composeCc,
          bcc: composeBcc,
          subject: composeSubject,
          body: composeBody,
          savedAt: Date.now(),
        };
        localStorage.setItem(`nftmail:draft:${agentName}`, JSON.stringify(draft));
        setDraftSavedAt(new Date().toLocaleTimeString());
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [agentName, composeTo, composeCc, composeBcc, composeSubject, composeBody]);

  // Load draft on mount
  useEffect(() => {
    if (agentName) {
      const saved = localStorage.getItem(`nftmail:draft:${agentName}`);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setComposeTo(draft.to || '');
          setComposeCc(draft.cc || '');
          setComposeBcc(draft.bcc || '');
          setComposeSubject(draft.subject || '');
          setComposeBody(draft.body || '');
          if (draft.cc || draft.bcc) setShowCcBcc(true);
        } catch {}
      }
    }
  }, [agentName]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(`nftmail:draft:${agentName}`);
    setComposeTo('');
    setComposeCc('');
    setComposeBcc('');
    setComposeSubject('');
    setComposeBody('');
    setDraftSavedAt(null);
  }, [agentName]);

  const openDashboard = useCallback(() => {
    sdk.actions.openUrl(`${APP_URL}`);
  }, []);

  const openMainSite = useCallback(() => {
    sdk.actions.openUrl(`${APP_URL}`);
  }, []);

  const openApp = useCallback(() => {
    sdk.actions.openUrl(`${APP_URL}/mini`);
  }, []);

  const openUpgrade = useCallback(() => setStep('upgrade'), []);

  async function handlePayAndUpgrade() {
    if (!agentName || upgrading) return;
    const tierMeta = TIER_META[inboxTier];
    if (!tierMeta.upgradeFee) return;
    setUpgrading(true);
    try {
      const amountMicro = String(tierMeta.upgradeFee * 1_000_000);
      const result = await (sdk.actions as any).sendToken({
        token: BASE_USDC_CAIP19,
        amount: amountMicro,
        recipientAddress: TREASURY,
      });
      if (!result.success) {
        setUpgrading(false);
        return;
      }
      const res = await fetch('/api/mini-upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid, agentName, txHash: result.send.transaction, currentTier: inboxTier }),
      });
      const data = await res.json() as { status?: string; newTier?: string; error?: string };
      if (data.status === 'upgraded' && data.newTier) {
        setInboxTier(normaliseTier(data.newTier));
      }
      setStep('inbox');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upgrade failed');
      setStep('error');
    } finally {
      setUpgrading(false);
    }
  }


  useEffect(() => {
    const init = async () => {
      let userFid: number | null = null;
      try {
        const context = await sdk.context;
        userFid = context?.user?.fid ?? null;
        setFid(userFid);
      } catch {
        // running outside Warpcast — continue without FID
      }
      // Signal ready immediately after getting context - critical for Farcaster Mini Apps
      // This must be called before any long-running operations
      try {
        await sdk.actions.ready();
      } catch {
        // ready() may fail outside Warpcast - that's ok
      }
      // Auto-check: if this FID already has an account, skip straight to inbox
      if (userFid) {
        try {
          const res = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'provisionFidAgent', fid: userFid, preferredName: '', farcasterVisibility: 'fid-only', emailVisibility: 'hidden' }),
          });
          const data = await res.json() as ProvisionResult & { eciesPrivateKey?: string };
          if (data.status === 'already_provisioned' && data.agentName) {
            setAgentName(data.agentName);
            setHumanEmail(`${data.agentName}@nftmail.box`);
            let privKey: string | null = null;
            try { privKey = localStorage.getItem(`ecies-priv:${data.agentName}`); } catch {}
            if (privKey) setEciesPrivKey(privKey);
            await loadInboxDirect(data.agentName, privKey);
            return;
          }
        } catch { /* non-fatal — fall through to entry */ }
      }
      setStep('entry');
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provision = useCallback(async (name: string, visibility: 'hidden' | 'fid-only' | 'full') => {
    if (!fid) { setError('No FID detected — open this in Warpcast.'); setStep('error'); return; }
    setStep('provisioning');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'provisionFidAgent',
          fid,
          preferredName: name.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
          farcasterVisibility: visibility,
          emailVisibility: 'hidden',
        }),
      });
      const data: ProvisionResult = await res.json();
      if (data.status === 'already_provisioned' && data.agentName) {
        setAgentName(data.agentName);
        setHumanEmail(data.humanEmail || `${data.agentName}@nftmail.box`);
        await loadInbox(data.agentName);
        return;
      }
      if (data.status === 'provisioned' && data.agentName) {
        setAgentName(data.agentName);
        setHumanEmail(data.humanEmail || `${data.agentName}@nftmail.box`);
        setExpiresAt(data.expiresAt || null);
        // Persist privkey in localStorage — only copy, never sent back to server
        if ((data as any).eciesPrivateKey) {
          try { localStorage.setItem(`ecies-priv:${data.agentName}`, (data as any).eciesPrivateKey); } catch {}
          setEciesPrivKey((data as any).eciesPrivateKey);
        }
        setStep('success');
        return;
      }
      setError(data.error || 'Provisioning failed — please try again.');
      setStep('error');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setStep('error');
    }
  }, [fid]);

  const openByoMolt = useCallback(() => {
    sdk.actions.openUrl(`https://ghostagent.ninja/byo-molt?agent=${agentName}&from=nftmail`);
  }, [agentName]);

  // Core inbox fetch — usable before eciesPrivKey state is set (pass key explicitly)
  const loadInboxDirect = async (name: string, privKey: string | null) => {
    setStep('inbox');
    try {
      // Fetch inbox, sentbox, and quota in parallel for accurate sendsRemaining
      const [inboxRes, sentboxRes, quotaRes] = await Promise.all([
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getInbox', localPart: name }),
        }),
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getSentbox', localPart: name }),
        }).catch(() => null), // non-fatal if sentbox fails
        fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'checkSendLimit', agentName: name }),
        }).catch(() => null), // non-fatal if quota check fails
      ]);
      const data: InboxResult = await inboxRes.json();
      
      // Also check sovereign account tier (may be different from FID-provisioned)
      const fidTier = data.tier || 'free';
      let sovereignTier = fidTier;
      try {
        const sovereignRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAgentProfile', label: name }),
        });
        const sovereignData = await sovereignRes.json();
        if (sovereignData?.tier && sovereignData.tier !== 'basic' && sovereignData.tier !== 'free') {
          sovereignTier = sovereignData.tier;
        }
      } catch {
        // Ignore errors, use FID tier
      }
      
      // Use the higher tier (sovereign takes precedence if upgraded)
      const effectiveTier = sovereignTier;
      
      const decrypted = await Promise.all((data.messages || []).map(async (msg) => {
        if ((msg as any).encrypted && (msg as any).envelope && privKey) {
          try {
            const plain = await eciesDecryptClient(JSON.stringify((msg as any).envelope), privKey);
            const inner = JSON.parse(plain) as { payload?: { from?: string; subject?: string; body?: string } };
            return { ...msg, from: inner.payload?.from || msg.from, subject: inner.payload?.subject || msg.subject, content: inner.payload?.body || msg.content, body: inner.payload?.body || msg.body };
          } catch { return msg; }
        }
        return msg;
      }));
      setMessages(decrypted);
      // Set tier from response or default to larva
      // Use effectiveTier (combines FID-provisioned and sovereign account tiers)
      setInboxTier(normaliseTier(effectiveTier));
      // Load sentbox from worker if available
      if (sentboxRes) {
        try {
          const sentData = await sentboxRes.json() as { messages?: InboxMessage[] };
          if (sentData.messages) {
            setSentMessages(sentData.messages.slice(0, 10));
          }
        } catch {}
      }
      // Use checkSendLimit quota if available, fallback to getInbox value
      let quota = data.sendsRemaining ?? 10;
      if (quotaRes) {
        try {
          const quotaData = await quotaRes.json() as { sendsRemaining?: number };
          if (typeof quotaData.sendsRemaining === 'number') {
            quota = quotaData.sendsRemaining;
          }
        } catch {}
      }
      setSendsRemaining(quota);
    } catch {
      setMessages([]);
    }
  };

  const loadInbox = useCallback(async (name: string) => {
    let privKey = eciesPrivKey;
    if (!privKey) { try { privKey = localStorage.getItem(`ecies-priv:${name}`); } catch {} }
    await loadInboxDirect(name, privKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eciesPrivKey]);

  const sendTest = useCallback(async () => {
    setStep('sending');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendTestEmail', agentName }),
      });
      const data = await res.json() as { status?: string; sendsRemaining?: number; error?: string };
      if (data.error) throw new Error(data.error);
      setSendsRemaining(data.sendsRemaining ?? sendsRemaining);
      setStep('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
      setStep('error');
    }
  }, [agentName, sendsRemaining]);

  const sendCompose = useCallback(async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      setError('To, Subject and Body are required.');
      setStep('error');
      return;
    }
    
    // Parse recipients - split by comma for multi-send
    const allRecipients = composeTo.split(',').map(e => e.trim()).filter(e => e);
    
    // Tier-based restrictions
    const isPro = inboxTier === 'pro';
    const isPremium = inboxTier === 'premium';
    
    // Free: only 1 recipient
    // Pro: up to 10 recipients + CC/BCC
    // Premium: unlimited recipients + CC/BCC
    let recipients = allRecipients;
    if (!isPro && !isPremium) {
      recipients = [allRecipients[0]]; // Free tier: first recipient only
    } else if (isPro && allRecipients.length > 10) {
      recipients = allRecipients.slice(0, 10); // Pro: max 10
    }
    
    // CC/BCC only for Pro/Premium
    const ccList = (isPro || isPremium) && composeCc 
      ? composeCc.split(',').map(e => e.trim()).filter(e => e).slice(0, isPro ? 2 : undefined)
      : [];
    const bccList = (isPro || isPremium) && composeBcc
      ? composeBcc.split(',').map(e => e.trim()).filter(e => e).slice(0, isPro ? 2 : undefined)
      : [];
    
    setStep('sending');
    try {
      // Send to each recipient
      for (const recipient of recipients) {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sendOutbound',
            agentName,
            to: recipient,
            cc: ccList,
            bcc: bccList,
            subject: composeSubject.trim(),
            body: composeBody.trim(),
          }),
        });
        const data = await res.json() as { status?: string; sendsRemaining?: number; error?: string };
        if (data.error) throw new Error(data.error);
        setSendsRemaining(data.sendsRemaining ?? sendsRemaining);
      }
      
      // Clear draft after successful send
      clearDraft();
      // Add to sentbox locally and save to worker
      const now = Date.now();
      const newSent: InboxMessage = {
        id: `sent-${now}`,
        subject: composeSubject.trim(),
        from: humanEmail || `${agentName}@nftmail.box`,
        to: composeTo.trim(),
        content: composeBody.trim(),
        receivedAt: now,
        type: 'sent',
      };
      setSentMessages(prev => [newSent, ...prev].slice(0, 10));
      // Persist to worker (non-blocking)
      fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveSentMessage', localPart: agentName, message: newSent }),
      }).catch(() => {});
      setComposeTo(''); setComposeSubject(''); setComposeBody('');
      setStep('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
      setStep('error');
    }
  }, [agentName, composeTo, composeSubject, composeBody, sendsRemaining, humanEmail]);

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Image src={LOADING_LOGO_URL} alt="" width={80} height={80} className="mx-auto mb-4 opacity-80" />
          <p className="text-[#43a574] font-mono text-sm">Initialising...</p>
        </div>
      </div>
    );
  }

  if (step === 'entry') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <Image src={LOGO_URL} alt="" width={80} height={80} className="rounded-xl" />
            </div>
            <h1 className="text-white font-bold text-4xl mb-1 font-mono">nftmail.box</h1>
            <p className="text-gray-400 text-sm">Encrypted mail · Farcaster wallet secured</p>
            {fid
              ? <p className="text-[#43a574] font-mono text-xs mt-2">FID: {fid} ✓</p>
              : <p className="text-yellow-400 font-mono text-xs mt-2">Open in Warpcast to link FID</p>
            }
          </div>
          <div className="space-y-3">
            <input
              type="text"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
              placeholder={fid ? `Custom name (default: your Farcaster name · FID ${fid})` : 'Custom name (optional)'}
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              maxLength={32}
              autoComplete="off"
              autoCapitalize="none"
            />
            <button
              onClick={() => setStep('naming')}
              disabled={!fid}
              className="w-full bg-[#43a574] hover:bg-[#3d8f65] disabled:bg-gray-800 disabled:text-gray-500 text-black font-bold py-3 rounded-lg transition-colors"
            >
              {fid ? 'Claim Free Inbox →' : 'Open in Warpcast to Claim'}
            </button>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-800" /></div>
              <div className="relative flex justify-center"><span className="bg-black px-2 text-[10px] text-gray-500 uppercase">or</span></div>
            </div>
            <button
              onClick={() => setStep('signin')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-[#43a574] text-white py-3 rounded-lg text-sm transition-colors"
            >
              Sign in with existing email
            </button>
            <p className="text-gray-500 text-xs text-center">8-day free inbox · 10 free sends · Upgrade to permanent anytime</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'naming') {
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const displayName = name || `your-farcaster-name`;
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-white font-bold text-xl mb-1">Privacy Settings</h2>
            <p className="text-gray-400 font-mono text-sm">{displayName}.cast@nftmail.box</p>
          </div>
          <p className="text-gray-500 text-sm text-center mb-6">Who can see your Farcaster identity?</p>
          <div className="space-y-3">
            <button
              onClick={() => provision(name, 'hidden')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-[#43a574] text-white py-3 rounded-lg text-sm transition-colors"
            >
              🕵️ Hidden — No FID visible
            </button>
            <button
              onClick={() => provision(name, 'fid-only')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-[#43a574] text-white py-3 rounded-lg text-sm transition-colors"
            >
              👁 FID Only — Show FID number
            </button>
            <button
              onClick={() => provision(name, 'full')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-[#43a574] text-white py-3 rounded-lg text-sm transition-colors"
            >
              🌐 Full Profile — Show username + avatar
            </button>
            <button onClick={() => setStep('entry')} className="w-full text-gray-500 text-sm py-2">
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'signin') {
    const [signinEmail, setSigninEmail] = useState('');
    const [signinError, setSigninError] = useState('');
    const [signinLoading, setSigninLoading] = useState(false);
    
    const handleSignin = async () => {
      const label = signinEmail.trim().toLowerCase().replace(/@nftmail\.box$/, '').replace(/[^a-z0-9-]/g, '');
      if (!label) { setSigninError('Please enter a valid email or label'); return; }
      setSigninLoading(true);
      setSigninError('');
      try {
        // Check if account exists and get profile
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'getAgentProfile', label }),
        });
        const data = await res.json();
        if (data && data.label) {
          setAgentName(data.label);
          setHumanEmail(`${data.label}@nftmail.box`);
          if (data.tier) setInboxTier(normaliseTier(data.tier));
          let privKey: string | null = null;
          try { privKey = localStorage.getItem(`ecies-priv:${data.label}`); } catch {}
          if (privKey) setEciesPrivKey(privKey);
          await loadInboxDirect(data.label, privKey);
        } else {
          setSigninError('Account not found. Check the email or claim a new inbox.');
        }
      } catch {
        setSigninError('Failed to look up account. Please try again.');
      } finally {
        setSigninLoading(false);
      }
    };
    
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔑</div>
            <h2 className="text-white font-bold text-xl mb-1">Sign In</h2>
            <p className="text-gray-400 text-sm">Enter your nftmail.box address</p>
          </div>
          <div className="space-y-3">
            <input
              type="text"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
              placeholder="yourname@nftmail.box"
              value={signinEmail}
              onChange={e => setSigninEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !signinLoading && handleSignin()}
              autoComplete="off"
              autoCapitalize="none"
              disabled={signinLoading}
            />
            {signinError && (
              <p className="text-red-400 text-xs text-center">{signinError}</p>
            )}
            <button
              onClick={handleSignin}
              disabled={signinLoading}
              className="w-full bg-[#43a574] hover:bg-[#3d8f65] disabled:bg-gray-800 disabled:text-gray-500 text-black font-bold py-3 rounded-lg transition-colors"
            >
              {signinLoading ? 'Looking up...' : 'Sign In →'}
            </button>
            <button onClick={() => setStep('entry')} className="w-full text-gray-500 text-sm py-2">
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'provisioning') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#43a574] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#43a574] font-mono text-sm">Creating your account...</p>
          <p className="text-gray-500 text-xs mt-2">Resolving Farcaster name · Setting up inbox</p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    const expiresStr = expiresAt ? new Date(expiresAt).toLocaleDateString() : '30 days';
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-white font-bold text-2xl mb-2">Account Created!</h2>
          <div className="bg-gray-900 border border-[#43a574] rounded-lg p-4 my-6">
            <p className="text-[#43a574] font-mono text-sm font-bold">{humanEmail}</p>
            <p className="text-gray-500 text-xs mt-1">FREE · Active until {expiresStr} · 8-day inbox history</p>
          </div>
          <p className="text-gray-400 text-xs mb-6">
            Secured by your Farcaster wallet. Upgrade to permanent by minting an NFT.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setStep('upgrade')}
              className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg transition-colors"
            >
              Mint Sovereign Identity
            </button>
            <button
              onClick={() => setStep('inbox')}
              className="w-full py-3 px-4 border border-gray-700 text-gray-300 text-sm rounded hover:bg-gray-900 transition-colors"
            >
              Return to Inbox
            </button>
            <button onClick={openByoMolt} className="w-full text-gray-500 text-xs py-1">
              Already have an NFT? Use BYO Molt
            </button>
          </div>
        </div>
      </div>
    );
  }


  if (step === 'inbox') {
    return (
      <div className="min-h-screen bg-black flex flex-col px-4 py-6">
        <div className="w-full max-w-sm mx-auto">
          {/* Header with Logo, Tier Indicator, and Account Dropdown */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Image src={LOGO_URL} alt="" width={28} height={28} className="shrink-0" />
              <span className="text-white font-bold text-xl whitespace-nowrap font-mono">nftmail.box</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Tier badge — tap for about panel */}
              <TierBadge tier={inboxTier} onClick={() => setShowTierAbout(true)} />
            </div>
          </div>
          
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg">Inbox</h2>
            <button onClick={() => loadInbox(agentName)} className="text-[#43a574] text-sm hover:text-[#5ab883]">Refresh</button>
          </div>
          <p className="text-[#43a574] font-mono text-xs mb-2">{humanEmail || `${agentName}@nftmail.box`}</p>
          
          {showTierAbout && <TierAboutPanel tier={inboxTier} onClose={() => setShowTierAbout(false)} onUpgrade={() => { setShowTierAbout(false); setStep('upgrade'); }} />}
          
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Image src={EMPTY_INBOX_URL} alt="" width={80} height={80} className="mx-auto mb-3 opacity-70" />
              <p className="text-gray-500 text-sm">No messages yet</p>
              <p className="text-gray-600 text-xs mt-1">Send a test email to verify delivery</p>
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              {messages.slice(0, 10).map(msg => {
                const isOpen = openMsgId === msg.id;
                const body = msg.content || msg.body || '';
                return (
                  <div
                    key={msg.id}
                    className={`bg-gray-900 border rounded-lg p-3 cursor-pointer transition-colors ${isOpen ? 'border-green-500/50' : 'border-gray-800 hover:border-gray-700'}`}
                  >
                    <div 
                      className="flex items-start justify-between gap-2"
                      onClick={() => setOpenMsgId(isOpen ? null : msg.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">{msg.subject || '(no subject)'}</p>
                        <p className="text-gray-500 text-xs mt-0.5 truncate">{msg.from}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-gray-600 text-xs">{new Date(msg.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm('Delete this email?')) {
                              try {
                                await fetch(WORKER_URL, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'deleteMessage', localPart: agentName, messageId: msg.id }),
                                });
                              } catch {}
                              setMessages(prev => prev.filter(m => m.id !== msg.id));
                            }
                          }}
                          className="text-red-500 hover:text-red-400 text-xs px-1"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="mt-3 pt-3 border-t border-gray-800">
                        {body ? (
                          <SafeMarkdown text={body} />
                        ) : (
                          <p className="text-gray-600 text-xs italic">(no body — message may be encrypted without a local key)</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Sentbox Section */}
          <div className="mt-6 pt-4 border-t border-gray-800">
            <button 
              className="w-full flex items-center justify-between py-2 text-left"
              onClick={() => setOpenMsgId(openMsgId === 'sentbox-header' ? null : 'sentbox-header')}
            >
              <span className="text-gray-400 text-sm">Sentbox</span>
              <span className="text-gray-500 text-xs">{sentMessages.length}/10</span>
            </button>
            {sentMessages.length === 0 ? (
              <p className="text-gray-600 text-xs">No sent emails yet</p>
            ) : (
              <div className="space-y-2 mt-2">
                {sentMessages.map(msg => {
                  const isOpen = openMsgId === msg.id;
                  const body = msg.content || msg.body || '';
                  return (
                    <div 
                      key={msg.id} 
                      className={`bg-gray-900 border rounded-lg p-2 cursor-pointer transition-colors ${isOpen ? 'border-green-500/50' : 'border-gray-800 hover:border-gray-700'}`}
                      onClick={() => setOpenMsgId(isOpen ? null : msg.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-sm truncate">{msg.subject || '(no subject)'}</p>
                          <p className="text-gray-500 text-xs truncate">To: {msg.to}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-gray-600 text-xs">{new Date(msg.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <button 
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm('Delete this sent email?')) {
                                // Delete from worker (non-blocking)
                                fetch(WORKER_URL, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'deleteSentMessage', localPart: agentName, messageId: msg.id }),
                                }).catch(() => {});
                                setSentMessages(prev => prev.filter(m => m.id !== msg.id));
                              }
                            }}
                            className="text-red-500 hover:text-red-400 text-xs px-1"
                            title="Delete"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {isOpen && body && (
                        <div className="mt-2 pt-2 border-t border-gray-800">
                          <SafeMarkdown text={body} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 mt-6">
            <button onClick={() => setStep('compose')} className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
              <span>✉️</span> Compose
            </button>
            <p className="text-gray-600 text-xs text-center">{sendsRemaining} sends remaining</p>
            
            {/* Tier upgrade CTA */}
            {TIER_META[inboxTier].upgradeCta && (
              <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{TIER_META[inboxTier].label} Status</span>
                  {inboxTier === 'free' && <span className="text-xs font-mono text-[#43a574]">{sendsRemaining}/10 sends</span>}
                </div>
                {inboxTier === 'free' && (
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-[#43a574] transition-all" style={{ width: `${Math.max(0, Math.min(100, (typeof sendsRemaining === 'number' ? sendsRemaining : 0) * 10))}%` }} />
                  </div>
                )}
                <button
                  onClick={() => setStep('upgrade')}
                  className="w-full py-2 px-3 bg-[#43a574] text-black text-sm font-semibold rounded hover:bg-[#3d8f65] transition-colors"
                >
                  {TIER_META[inboxTier].upgradeCta} →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'compose') {
    const fromAddr = humanEmail || `${agentName}@nftmail.box`;
    return (
      <div className="min-h-screen bg-black flex flex-col px-4 py-6">
        <div className="w-full max-w-sm mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => setStep('inbox')} className="text-gray-500 text-lg hover:text-white">←</button>
            <h2 className="text-white font-bold text-lg">Compose</h2>
          </div>
          <p className="text-gray-600 font-mono text-xs mb-4">From: {fromAddr}</p>
          <div className="space-y-3">
            <input
              type="email"
              placeholder={inboxTier === 'free' ? "To: recipient@example.com" : "To: recipient1@example.com, recipient2@example.com (multi-send)"}
              value={composeTo}
              onChange={e => setComposeTo(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
              autoCapitalize="none"
              autoComplete="off"
            />
            {(inboxTier === 'pro' || inboxTier === 'premium') && (
              <>
                <button
                  onClick={() => setShowCcBcc(!showCcBcc)}
                  className="text-xs text-[#43a574] hover:text-white text-left transition-colors"
                >
                  {showCcBcc ? 'Hide CC/BCC' : 'Show CC/BCC'}
                </button>
                {showCcBcc && (
                  <>
                    <input
                      type="email"
                      placeholder="CC: cc@example.com (Pro: max 2, Premium: unlimited)"
                      value={composeCc}
                      onChange={e => setComposeCc(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                    <input
                      type="email"
                      placeholder="BCC: bcc@example.com (Pro: max 2, Premium: unlimited)"
                      value={composeBcc}
                      onChange={e => setComposeBcc(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                  </>
                )}
              </>
            )}
            <input
              type="text"
              placeholder="Subject"
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574]"
            />
            <textarea
              placeholder="Message body..."
              value={composeBody}
              onChange={e => setComposeBody(e.target.value)}
              rows={6}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#43a574] resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={sendCompose}
                disabled={!composeTo || !composeSubject || !composeBody}
                className="flex-1 bg-[#43a574] hover:bg-[#3d8f65] disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold py-3 rounded-lg transition-colors"
              >
                Send →
              </button>
              <button
                onClick={() => { clearDraft(); setStep('inbox'); }}
                className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg transition-colors"
                title="Clear draft"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{sendsRemaining} sends remaining</span>
              {draftSavedAt && (
                <span className="text-gray-500">Draft saved {draftSavedAt}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'sending') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-[#43a574] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#43a574] font-mono text-sm">Sending...</p>
        </div>
      </div>
    );
  }

  if (step === 'sent') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm text-center">
          <Image src={MAILBOX_ICON_URL} alt="Sent" width={64} height={64} className="mx-auto mb-3 opacity-70" />
          <h2 className="text-white font-bold text-xl mb-2">Sent!</h2>
          <div className="bg-gray-900 border border-[#43a574] rounded-lg p-4 my-6">
            <p className="text-[#43a574] font-mono text-sm">{humanEmail || `${agentName}@nftmail.box`}</p>
            <p className="text-gray-500 text-xs mt-1">{10 - (typeof sendsRemaining === 'number' ? sendsRemaining : 10)} of 10 sent · {sendsRemaining} remaining</p>
          </div>
          <p className="text-gray-400 text-xs mb-6">Your email is on its way to the recipient.</p>
          <div className="space-y-3">
            <button onClick={() => loadInbox(agentName)} className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg transition-colors">
              Back to Inbox →
            </button>
            {inboxTier === 'free' ? (
              <button onClick={openUpgrade} className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg text-sm transition-colors">
                Upgrade to PRO 10 USDC one-time →
              </button>
            ) : inboxTier === 'pro' ? (
              <button onClick={openUpgrade} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg text-sm transition-colors">
                Upgrade to PREMIUM 24 USDC annual →
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'upgrade') {
    const tierMeta = TIER_META[inboxTier];
    const nextTier = inboxTier === 'free' ? TIER_META.pro : TIER_META.premium;
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <div className="text-center">
            <div className="text-4xl mb-3">{nextTier.emoji}</div>
            <h2 className="text-white font-bold text-xl mb-1">Upgrade to {nextTier.label}</h2>
            <p className="text-gray-400 text-sm">{nextTier.description}</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 space-y-2">
            {nextTier.features.map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-gray-400">{k}</span>
                <span className="text-white">{v}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handlePayAndUpgrade}
            disabled={upgrading}
            className={`w-full py-3 px-4 font-bold text-sm rounded-lg transition-colors ${
              inboxTier === 'pro' 
                ? 'bg-purple-600 hover:bg-purple-500 text-white disabled:bg-gray-700 disabled:text-gray-500'
                : 'bg-[#43a574] hover:bg-[#3d8f65] text-black disabled:bg-gray-700 disabled:text-gray-500'
            }`}
          >
            {upgrading ? 'Processing…' : `${tierMeta.upgradeCta} →`}
          </button>
          <p className="text-gray-500 text-[10px] text-center">Paid via your Farcaster wallet on Base · NFT beacon minted to your custody address</p>
          <button
            onClick={() => setStep('inbox')}
            className="w-full py-3 px-4 border border-gray-700 text-gray-300 text-sm rounded hover:bg-gray-900 transition-colors"
          >
            ← Back to Inbox
          </button>
        </div>
      </div>
    );
  }

  const isSendLimitError = error?.toLowerCase().includes('send limit');
  
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h2 className="text-white font-bold text-xl mb-3">Something went wrong</h2>
        <p className="text-red-400 font-mono text-xs mb-6 break-words">{error}</p>
        {isSendLimitError ? (
          <div className="space-y-3">
            <button onClick={() => setStep('upgrade')} className="w-full bg-[#43a574] hover:bg-[#3d8f65] text-black font-bold py-3 rounded-lg transition-colors">
              Mint Sovereign Identity
            </button>
            <button onClick={() => { setStep('inbox'); setError(''); }} className="w-full bg-gray-900 border border-gray-700 hover:bg-gray-800 text-white py-3 rounded-lg">
              Return to Inbox
            </button>
          </div>
        ) : (
          <button onClick={() => { setStep('entry'); setError(''); }} className="w-full bg-gray-900 border border-gray-700 hover:bg-gray-800 text-white py-3 rounded-lg">
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
