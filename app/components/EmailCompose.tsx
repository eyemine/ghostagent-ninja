'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface EmailComposeProps {
  agentName: string;
  agentEmail: string;
  tier: 'free' | 'pro' | 'premium';
  onSent?: () => void;
}

interface Draft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  updatedAt: number;
}

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

function getDraftKey(agentName: string) {
  return `nftmail:draft:${agentName}`;
}

function getSentKey(agentName: string) {
  return `nftmail:sent:${agentName}`;
}

export default function EmailCompose({ agentName, agentEmail, tier, onSent }: EmailComposeProps) {
  const { user } = usePrivy();
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savedDraftTime, setSavedDraftTime] = useState<string | null>(null);

  // Load draft from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(getDraftKey(agentName));
    if (saved) {
      try {
        const draft: Draft = JSON.parse(saved);
        setTo(draft.to || []);
        setCc(draft.cc || []);
        setBcc(draft.bcc || []);
        setSubject(draft.subject || '');
        setBody(draft.body || '');
        if (draft.cc?.length || draft.bcc?.length) {
          setShowCcBcc(true);
        }
      } catch {
        // Invalid draft, ignore
      }
    }
  }, [agentName]);

  // Auto-save draft every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (to.length || cc.length || bcc.length || subject || body) {
        const draft: Draft = {
          to,
          cc,
          bcc,
          subject,
          body,
          updatedAt: Date.now(),
        };
        localStorage.setItem(getDraftKey(agentName), JSON.stringify(draft));
        setSavedDraftTime(new Date().toLocaleTimeString());
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [agentName, to, cc, bcc, subject, body]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(getDraftKey(agentName));
    setTo([]);
    setCc([]);
    setBcc([]);
    setSubject('');
    setBody('');
    setSavedDraftTime(null);
  }, [agentName]);

  const saveToSent = useCallback((email: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; sentAt: number }) => {
    const key = getSentKey(agentName);
    const existing = localStorage.getItem(key);
    const sent: typeof email[] = existing ? JSON.parse(existing) : [];
    sent.unshift(email); // Add to beginning
    // Keep only last 100 sent emails
    if (sent.length > 100) sent.pop();
    localStorage.setItem(key, JSON.stringify(sent));
  }, [agentName]);

  const handleSend = async () => {
    if (!to.length) {
      setError('At least one recipient is required');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    setSending(true);
    setError('');
    setSuccess('');

    try {
      // Pro/Premium: allow multiple recipients
      // Free: only first recipient
      const recipients = tier === 'free' ? [to[0]] : to;
      const ccRecipients = tier === 'free' ? [] : cc;
      const bccRecipients = tier === 'free' ? [] : bcc;

      // Send to each recipient
      for (const recipient of recipients) {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sendOutbound',
            from: agentEmail,
            to: recipient,
            cc: ccRecipients,
            bcc: bccRecipients,
            subject,
            body,
          }),
        });

        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
      }

      // Save to sent box
      saveToSent({
        to: recipients,
        cc: ccRecipients,
        bcc: bccRecipients,
        subject,
        body,
        sentAt: Date.now(),
      });

      // Clear draft after successful send
      clearDraft();
      setSuccess(`Email sent to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''}`);
      onSent?.();
    } catch (e: any) {
      setError(e.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleAddRecipient = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    const emails = value.split(',').map(e => e.trim()).filter(e => e);
    setter(emails);
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-black/40 border border-gray-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-[#f2eee4] mb-4">Compose Email</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* From */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">From</label>
        <div className="text-sm text-[#f2eee4] font-mono">{agentEmail}</div>
      </div>

      {/* To */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">
          To {tier === 'free' && <span className="text-amber-400">(Pro/Premium: multi-send)</span>}
        </label>
        <input
          type="text"
          value={to.join(', ')}
          onChange={(e) => handleAddRecipient(setTo, e.target.value)}
          placeholder={tier === 'free' ? 'recipient@example.com' : 'recipient1@example.com, recipient2@example.com'}
          className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#f2eee4] placeholder-gray-600 focus:outline-none focus:border-[#b0805c]"
        />
      </div>

      {/* CC/BCC Toggle */}
      {(tier === 'pro' || tier === 'premium') && (
        <div className="mb-4">
          <button
            onClick={() => setShowCcBcc(!showCcBcc)}
            className="text-xs text-[#b0805c] hover:text-[#f2eee4] transition-colors"
          >
            {showCcBcc ? 'Hide CC/BCC' : 'Show CC/BCC'}
          </button>
        </div>
      )}

      {/* CC/BCC Fields */}
      {showCcBcc && (tier === 'pro' || tier === 'premium') && (
        <>
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">CC</label>
            <input
              type="text"
              value={cc.join(', ')}
              onChange={(e) => handleAddRecipient(setCc, e.target.value)}
              placeholder="cc@example.com"
              className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#f2eee4] placeholder-gray-600 focus:outline-none focus:border-[#b0805c]"
            />
          </div>
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">BCC</label>
            <input
              type="text"
              value={bcc.join(', ')}
              onChange={(e) => handleAddRecipient(setBcc, e.target.value)}
              placeholder="bcc@example.com"
              className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#f2eee4] placeholder-gray-600 focus:outline-none focus:border-[#b0805c]"
            />
          </div>
        </>
      )}

      {/* Subject */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject"
          className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#f2eee4] placeholder-gray-600 focus:outline-none focus:border-[#b0805c]"
        />
      </div>

      {/* Body */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message..."
          rows={8}
          className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#f2eee4] placeholder-gray-600 focus:outline-none focus:border-[#b0805c] resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 bg-[#b0805c] hover:bg-[#c0906c] text-black font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
          <button
            onClick={clearDraft}
            disabled={sending}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            Discard
          </button>
        </div>

        {savedDraftTime && (
          <span className="text-xs text-gray-500">
            Draft saved at {savedDraftTime}
          </span>
        )}
      </div>

      {/* Tier indicator */}
      <div className="mt-4 pt-4 border-t border-gray-800">
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded ${
            tier === 'premium' ? 'bg-purple-500/20 text-purple-400' :
            tier === 'pro' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-gray-700 text-gray-400'
          }`}>
            {tier.toUpperCase()}
          </span>
          <span className="text-gray-500">
            {tier === 'free' && 'Single recipient only'}
            {tier === 'pro' && 'Up to 10 recipients, CC/BCC enabled'}
            {tier === 'premium' && 'Unlimited recipients, CC/BCC enabled'}
          </span>
        </div>
      </div>
    </div>
  );
}
