/// GET /api/sentbox?label=<local-part>
/// Fetch sent messages from KV via worker for a given label@nftmail.box address.
/// Messages stored by send-email API with full body content.

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET(req: NextRequest) {
  const label = req.nextUrl.searchParams.get('label');
  if (!label || !/^[a-z0-9_.-]+$/.test(label)) {
    return NextResponse.json({ error: 'Missing or invalid label' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getSentMessages', localPart: label }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(
        { error: String(err.error || `Worker error ${res.status}`) },
        { status: res.status },
      );
    }

    const data = (await res.json()) as { messages?: Array<Record<string, unknown>> };
    const messages = (data.messages || []).map((msg: Record<string, unknown>) => ({
      id: String(msg.id || msg.sentId || ''),
      timestamp: Math.floor((msg.timestamp as number || msg.sentAt as number || Date.now()) / 1000),
      from: String(msg.from || ''),
      to: String(msg.to || ''),
      cc: msg.cc ? String(msg.cc) : undefined,
      bcc: msg.bcc ? String(msg.bcc) : undefined,
      subject: String(msg.subject || '(no subject)'),
      body: msg.body ? String(msg.body) : undefined,
      messageId: String(msg.messageId || msg.id || ''),
    }));

    return NextResponse.json({ label, messages });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch sentbox';
    console.error('[sentbox]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
