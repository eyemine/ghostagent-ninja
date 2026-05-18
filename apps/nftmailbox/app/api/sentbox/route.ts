/// GET /api/sentbox?label=ghostagent
/// Fetches sent messages for a label@nftmail.box address from Mailgun's Events API.
/// Mailgun retains events for 30 days on free plan, longer on paid.

import { NextRequest, NextResponse } from 'next/server';

const MAILGUN_API_BASE = process.env.MAILGUN_API_BASE || 'https://api.eu.mailgun.net/v3';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.nftmail.box';

export async function GET(req: NextRequest) {
  try {
    const label = req.nextUrl.searchParams.get('label')?.toLowerCase().trim();
    if (!label) {
      return NextResponse.json({ error: 'Missing label' }, { status: 400 });
    }

    const apiKey = process.env.MAILGUN_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'MAILGUN_API_KEY not configured' }, { status: 503 });
    }

    const fromEmail = `${label}@nftmail.box`;

    // Query Mailgun Events API for accepted (sent) events from this address
    const params = new URLSearchParams({
      event: 'accepted',
      from: fromEmail,
      limit: '100',
    });

    const res = await fetch(
      `${MAILGUN_API_BASE}/${MAILGUN_DOMAIN}/events?${params}`,
      {
        headers: {
          Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
        },
      },
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(
        { error: String(err.message || `Mailgun events API error ${res.status}`) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { items?: Record<string, unknown>[] };
    const items = data.items || [];

    const messages = items.map((ev) => {
      const msg = (ev.message || {}) as Record<string, unknown>;
      const headers = (msg.headers || {}) as Record<string, unknown>;
      const recipient = (ev.recipient || ev.recipients || '') as string;
      return {
        messageId: String(ev.id || headers['message-id'] || ''),
        from: fromEmail,
        to: Array.isArray(recipient) ? recipient.join(', ') : String(recipient),
        subject: String(headers.subject || '(no subject)'),
        sentAt: ev.timestamp ? (ev.timestamp as number) * 1000 : Date.now(),
        status: String(ev.event || 'accepted'),
      };
    });

    // Sort newest first
    messages.sort((a, b) => b.sentAt - a.sentAt);

    return NextResponse.json({ messages, count: messages.length }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch sentbox';
    console.error('[sentbox]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
