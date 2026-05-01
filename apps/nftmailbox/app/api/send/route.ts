/// POST /api/send
/// Low-level send route used by internal tooling and agent-to-human outbound.
/// Sends via Mailgun — From address is always the real sender, never a relay.
/// For the full tier-gated UI send path, use /api/send-email instead.

import { NextRequest, NextResponse } from 'next/server';

const MAILGUN_API_BASE = process.env.MAILGUN_API_BASE || 'https://api.eu.mailgun.net/v3';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.nftmail.box';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      fromEmail?: string;
      toAddress?: string;
      subject?: string;
      content?: string;
      html?: string;
    };

    const { fromEmail, toAddress, subject, content, html } = body;

    if (!fromEmail || !fromEmail.endsWith('@nftmail.box')) {
      return NextResponse.json({ error: 'Invalid sender — must be @nftmail.box' }, { status: 400 });
    }
    if (!toAddress || !toAddress.includes('@')) {
      return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
    }
    if (!subject && !content && !html) {
      return NextResponse.json({ error: 'Subject or content required' }, { status: 400 });
    }

    const apiKey = process.env.MAILGUN_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'MAILGUN_API_KEY not configured' }, { status: 503 });
    }

    const label = fromEmail.replace('@nftmail.box', '');
    const form = new URLSearchParams();
    form.set('from', `${label} <${fromEmail}>`);
    form.set('to', toAddress);
    form.set('subject', subject || '(no subject)');
    if (html) {
      form.set('html', html);
      form.set('text', content || html.replace(/<[^>]+>/g, ''));
    } else {
      form.set('text', content || '');
    }
    form.set('h:X-NFTMail-Origin', 'human-operated');

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
      return NextResponse.json(
        { error: String(err.message || `Mailgun error ${res.status}`) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      messageId: String(data.id || 'sent'),
      from: fromEmail,
      to: toAddress,
      via: 'mailgun',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[send]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
