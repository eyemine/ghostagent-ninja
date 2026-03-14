import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';

/**
 * GET /api/mail/inbox?agent=alice&cursor=<cursor>&limit=20
 * Returns list of stored mail for an agent from INBOX_KV via the worker.
 * Ciphertext is returned as-is — decryption happens client-side.
 */


export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 50);

  if (!agent) return NextResponse.json({ error: 'Missing agent' }, { status: 400 });

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listMail', agentName: agent.toLowerCase(), cursor, limit }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * DELETE /api/mail/inbox?agent=alice&id=mail-123
 * Deletes a stored mail entry from INBOX_KV.
 */
export async function DELETE(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  const id = req.nextUrl.searchParams.get('id');

  if (!agent || !id) return NextResponse.json({ error: 'Missing agent or id' }, { status: 400 });

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteMail', agentName: agent.toLowerCase(), mailId: id }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error }, { status: res.status });
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
