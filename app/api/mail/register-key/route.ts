import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

/**
 * POST /api/mail/register-key
 * Called after agent mint to register the agent's P-256 encryption pubkey
 * and privacy mode in the worker KV so the email-ingest worker knows
 * whether to encrypt or use GlassBox for incoming mail.
 *
 * Body: {
 *   agentName: string          e.g. "alice"
 *   namespace: string          e.g. "molt.gno"
 *   privacyMode: 'glassbox' | 'private' | 'hard-privacy'
 *   encryptionPubkeyHex?: string  P-256 uncompressed pubkey (04...), required for private/hard-privacy
 * }
 */


export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      agentName: string;
      namespace: string;
      privacyMode: 'glassbox' | 'private' | 'hard-privacy';
      encryptionPubkeyHex?: string;
    };

    const { agentName, namespace, privacyMode, encryptionPubkeyHex } = body;

    if (!agentName || !namespace || !privacyMode) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // molt.gno is always GlassBox regardless of what's sent
    const effectiveMode = namespace === 'molt.gno' ? 'glassbox' : privacyMode;

    if (effectiveMode !== 'glassbox' && !encryptionPubkeyHex) {
      return NextResponse.json(
        { error: 'encryptionPubkeyHex required for private/hard-privacy namespaces' },
        { status: 400 }
      );
    }

    const config = {
      privacyMode: effectiveMode,
      namespace,
      encryptionPubkeyHex: effectiveMode === 'glassbox' ? undefined : encryptionPubkeyHex,
    };

    // Store in worker KV via existing worker action pattern
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'setAgentConfig',
        agentName: agentName.toLowerCase(),
        config,
      }),
    });

    const data = await res.json() as { status?: string; error?: string };
    if (!res.ok) {
      return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    }

    return NextResponse.json({ status: 'ok', agentName, effectiveMode, namespace });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

/**
 * GET /api/mail/register-key?agent=alice&namespace=molt.gno
 * Returns the registered config for an agent (pubkey redacted).
 */
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get('agent');
  const namespace = req.nextUrl.searchParams.get('namespace');

  if (!agent) {
    return NextResponse.json({ error: 'Missing agent' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET },
      body: JSON.stringify({
        action: 'getAgentConfig',
        agentName: agent.toLowerCase(),
        namespace,
      }),
    });

    if (res.status === 404) return NextResponse.json({ config: null });
    const data = await res.json() as {
      config?: { privacyMode: string; namespace: string; encryptionPubkeyHex?: string };
      error?: string;
    };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });

    // Redact the pubkey — return only mode and namespace
    const { encryptionPubkeyHex: _, ...safeConfig } = data.config ?? {};
    return NextResponse.json({ config: safeConfig ?? null });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
