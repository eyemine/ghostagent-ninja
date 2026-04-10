/// POST /api/send-email
/// Send email on behalf of a label@nftmail.box address.
///
/// Auth: ownerWallet in body (verified against KV-registered controller)
///
/// Tier gate: basic = receive-only. lite/premium/ghost = send via Mailgun.
///
/// Send strategy:
///   - All tiers (lite, premium, ghost): Mailgun API, From: label@nftmail.box
///     True per-address sending — no relay, no ghostagent@nftmail.box in the envelope.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const MAILGUN_API_BASE = process.env.MAILGUN_API_BASE || 'https://api.eu.mailgun.net/v3';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.nftmail.box';

async function sendViaMailgun(params: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ messageId: string }> {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new Error('MAILGUN_API_KEY not configured');

  const form = new URLSearchParams();
  form.set('from', params.from);
  form.set('to', params.to);
  form.set('subject', params.subject);
  form.set('html', params.html);
  form.set('text', params.text);

  const res = await fetch(`${MAILGUN_API_BASE}/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(String(err.message || `Mailgun error ${res.status}`));
  }

  const data = (await res.json()) as Record<string, unknown>;
  return { messageId: String(data.id || 'sent') };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      label?: string;
      ownerWallet?: string;
      to?: string;
      subject?: string;
      body?: string;
      replyToMessageId?: string;
    };

    const { label, ownerWallet, to, subject } = body;
    const mailBody = body.body || '';

    if (!label || typeof label !== 'string') {
      return NextResponse.json({ error: 'Missing label' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'ownerWallet required for auth' }, { status: 401 });
    }
    if (!to || !to.includes('@')) {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }
    if (!subject && !mailBody) {
      return NextResponse.json({ error: 'Subject or body required' }, { status: 400 });
    }

    // ── Resolve address + verify ownership ──────────────────────────────────
    const resolveRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: label }),
    });
    const resolved = (await resolveRes.json()) as Record<string, unknown>;

    if (!resolved?.exists) {
      return NextResponse.json({ error: 'This address does not exist' }, { status: 404 });
    }

    const controller = (resolved.onChainOwner as string | undefined)?.toLowerCase();
    if (controller && controller !== ownerWallet.toLowerCase()) {
      return NextResponse.json({ error: 'Wallet does not match the registered owner' }, { status: 403 });
    }

    const accountTier = (resolved.accountTier as string | undefined) || 'basic';
    if (accountTier === 'basic') {
      return NextResponse.json({
        error: 'Basic tier is receive-only. Upgrade to Standard to enable sending.',
        upgradeUrl: `/nftmail?upgrade=standard&label=${label}`,
        tier: 'basic',
      }, { status: 402 });
    }

    const fromEmail = `${label}@nftmail.box`;
    const htmlBody = markdownToHtml(mailBody);
    const textBody = mailBody;

    // ── Send via Mailgun (all lite/premium/ghost tiers) ─────────────────────
    const { messageId } = await sendViaMailgun({
      from: `${label} <${fromEmail}>`,
      to,
      subject: subject || '(no subject)',
      html: htmlBody,
      text: textBody,
    });

    return NextResponse.json({
      success: true,
      messageId,
      from: fromEmail,
      to,
      via: 'mailgun',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Send failed';
    console.error('[send-email]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/// Minimal markdown → HTML converter for email bodies
function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#1a1a2e;padding:1px 4px;border-radius:3px;font-family:monospace">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 6px;font-size:14px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin:18px 0 8px;font-size:16px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin:20px 0 10px;font-size:18px">$1</h1>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid #333;margin:16px 0">')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #444;margin:8px 0;padding-left:12px;color:#aaa">$1</blockquote>')
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    // Line breaks → <br>
    .replace(/\n/g, '<br>\n')
    // Wrap list items
    .replace(/(<li[^>]*>.*<\/li>(\s*<br>\s*)*)+/g, (m) => `<ul style="margin:8px 0;padding-left:18px">${m.replace(/<br>\s*/g, '')}</ul>`)
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#4fa8e8">$1</a>');
}
