'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WhiteLabelZohoProps {
  agentName: string;
  email: string;
  tbaAddress: string;
}

type ProvisionStep = 'idle' | 'provisioning' | 'done' | 'error';

export function WhiteLabelZoho({ agentName, email, tbaAddress }: WhiteLabelZohoProps) {
  const [step, setStep] = useState<ProvisionStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [zohoResult, setZohoResult] = useState<{
    mailboxId: string;
    webmailUrl: string;
    imapHost: string;
    smtpHost: string;
  } | null>(null);

  const provision = useCallback(async () => {
    setStep('provisioning');
    setError(null);

    try {
      const res = await fetch('/api/zoho-provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentName,
          email,
          tbaAddress,
        }),
      });

      const data = (await res.json()) as Record<string, any>;

      if (!res.ok) {
        throw new Error(data.error || 'Zoho provisioning failed');
      }

      setZohoResult({
        mailboxId: data.mailboxId || data.accountId || 'pending',
        webmailUrl: data.webmailUrl || `https://mail.zoho.com`,
        imapHost: data.imapHost || 'imappro.zoho.com',
        smtpHost: data.smtpHost || 'smtppro.zoho.com',
      });
      setStep('done');
    } catch (err: any) {
      setError(err?.message || 'Failed to provision Zoho mailbox');
      setStep('error');
    }
  }, [agentName, email, tbaAddress]);

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-[var(--card)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-[0.18em] text-violet-300/70">PAID TIER</span>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">ZOHO MAIL</span>
        </div>
        {step === 'done' && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            PROVISIONED
          </span>
        )}
      </div>

      <div className="space-y-4 px-5 py-4">
        {step === 'done' && zohoResult ? (
          <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold tracking-wider text-emerald-300/70">MAILBOX</span>
              <code className="text-sm text-emerald-300">{email}</code>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-[var(--muted)]">IMAP</span>
                <code className="mt-0.5 block text-[rgb(160,220,255)]">{zohoResult.imapHost}</code>
              </div>
              <div>
                <span className="text-[10px] text-[var(--muted)]">SMTP</span>
                <code className="mt-0.5 block text-[rgb(160,220,255)]">{zohoResult.smtpHost}</code>
              </div>
            </div>
            <a
              href={zohoResult.webmailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/20"
            >
              Open Webmail ↗
            </a>
          </div>
        ) : (
          <button
            onClick={provision}
            disabled={step === 'provisioning'}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/8 px-5 py-3 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {step === 'provisioning' ? 'Provisioning Zoho Mailbox...' : 'Upgrade to Zoho Mail'}
          </button>
        )}

        {error && <p className="text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
