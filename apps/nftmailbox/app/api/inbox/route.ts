import { NextRequest, NextResponse } from 'next/server';

const ZOHO_MAIL_API = 'https://mail.zoho.com.au/api';

async function getZohoAccessToken(): Promise<string | null> {
  const existing = process.env.ZOHO_OAUTH_TOKEN;
  if (existing) return existing;

  const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!accountsDomain || !refreshToken || !clientId || !clientSecret) return null;

  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', refreshToken);
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);

  const res = await fetch(`https://${accountsDomain}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) return null;
  return (data.access_token as string) || null;
}

interface ZohoMessage {
  messageId: string;
  subject: string;
  sender: string;
  fromAddress: string;
  receivedTime: string;
  summary: string;
  isRead: boolean;
  hasAttachment: boolean;
}

export async function GET(req: NextRequest) {
  try {
    const email = req.nextUrl.searchParams.get('email');
    if (!email || !email.endsWith('@nftmail.box')) {
      return NextResponse.json({ error: 'Invalid nftmail.box email' }, { status: 400 });
    }

    // Extract local part - preserve underscore suffix for agent aliases
    // ghostagent@nftmail.box (human) and ghostagent_@nftmail.box (agent) are separate inboxes
    const localPart = email.split('@')[0];

    // Always fetch from Worker KV (all streams store here)
    const workerUrl = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
    let kvMessages: any[] = [];

    let workerError = '';
    try {
      const workerRes = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getBlindInbox',
          localPart: localPart  // Preserve underscore - ghostagent and ghostagent_ are separate
        })
      });

      if (workerRes.ok) {
        const workerData = await workerRes.json() as Record<string, any>;
        // decayDays from resolveAddress: 8 for Larva, 30 for Pupa, null for Imago/Agent
        const acctDecayDays: number | null = workerData.decayDays ?? null;
        kvMessages = (workerData.messages || []).map((m: any) => {
          const isEnc = m.encrypted === true;
          const now = Date.now();
          // Defensive timestamp parsing: handle seconds (Unix), milliseconds, or ISO string
          let rawRa = m.receivedAt || m.timestamp || m.createdAt || 0;
          if (typeof rawRa === 'string') rawRa = Date.parse(rawRa) || 0;
          // If < year 2000 in ms (≈946684800000), treat as seconds and convert
          const receivedMs = rawRa > 0 && rawRa < 946684800000 ? rawRa * 1000 : (rawRa || now);
          const frozen = m.frozen === true;
          // Frozen emails never decay; use per-message decayDays if available, else account default
          // Imago/Agent accounts have acctDecayDays = null (no decay)
          const msgDecayDays = m.decayDays ?? acctDecayDays; // No fallback - null means no decay
          const hasDecay = msgDecayDays !== null && msgDecayDays > 0;
          const decayMs = hasDecay ? msgDecayDays * 24 * 60 * 60 * 1000 : 0;
          const ageMs = now - receivedMs;

          return {
            id: m.id,
            messageId: m.id,
            subject: isEnc ? '(encrypted)' : (m.payload?.subject || '(no subject)'),
            sender: isEnc ? '' : (m.payload?.from || 'unknown'),
            fromAddress: isEnc ? '' : (m.payload?.from || ''),
            receivedTime: new Date(receivedMs).toISOString(),
            summary: isEnc ? '' : (m.payload?.body?.slice(0, 200) || ''),
            body: isEnc ? '' : (m.payload?.body || ''),
            bodyHtml: isEnc ? '' : (m.payload?.bodyHtml || ''),
            isRead: false,
            hasAttachment: false,
            encrypted: isEnc,
            type: m.type || '',
            contentHash: m.envelope?.contentHash || m.plaintextHash || '',
            frozen,
            decayDays: frozen || !hasDecay ? null : msgDecayDays,
            decayPct: frozen || !hasDecay ? 0 : Math.min(100, Math.round((ageMs / decayMs) * 100)),
            expiresAt: frozen || !hasDecay ? null : new Date(receivedMs + decayMs).toISOString(),
            expired: !frozen && hasDecay && ageMs >= decayMs,
          };
        });
      } else {
        workerError = `Worker returned ${workerRes.status}: ${await workerRes.text().catch(() => '')}`;
        console.error('Worker KV fetch failed:', workerError);
      }
    } catch (e: any) {
      workerError = e?.message || String(e);
      console.error('Worker KV fetch error:', workerError);
    }

    // If we have KV messages, return them directly (KV is the source of truth)
    if (kvMessages.length > 0) {
      const active = kvMessages.filter((m: any) => !m.expired);
      const hasEncrypted = active.some((m: any) => m.encrypted);
      const hasCleartext = active.some((m: any) => !m.encrypted);
      const tier = hasEncrypted && !hasCleartext ? 'L2' : hasEncrypted ? 'L1' : 'L0';

      return NextResponse.json({
        messages: active,
        total: active.length,
        tier,
      });
    }

    // For human stream (no underscore or dot), try Zoho API as fallback
    const zohoOrgId = process.env.ZOHO_ORG_ID;
    const token = await getZohoAccessToken();
    if (!token || !zohoOrgId) {
      return NextResponse.json({ 
        messages: [], 
        tier: 'free',
        ...(workerError ? { workerError } : {}),
      });
    }

    // 1. Find the account ID for this email
    const accountsRes = await fetch(
      `${ZOHO_MAIL_API}/organization/${zohoOrgId}/accounts`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );

    if (!accountsRes.ok) {
      return NextResponse.json(
        { error: `Zoho accounts API returned ${accountsRes.status}` },
        { status: 502 }
      );
    }

    const accountsData = (await accountsRes.json()) as Record<string, any>;
    const accounts = accountsData?.data || [];
    const account = accounts.find(
      (a: any) =>
        a.primaryEmailAddress?.toLowerCase() === email.toLowerCase() ||
        a.mailboxAddress?.toLowerCase() === email.toLowerCase()
    );

    if (!account) {
      // No Zoho mailbox provisioned — return empty inbox (free tier)
      return NextResponse.json({
        messages: [],
        tier: 'free',
        note: 'No Zoho mailbox provisioned. Emails received via Cloudflare Worker routing.',
      });
    }

    const accountId = account.accountId || account.zuid;

    // 2. Fetch inbox messages
    const messagesRes = await fetch(
      `${ZOHO_MAIL_API}/accounts/${accountId}/messages/view?folderId=inbox&limit=50&sortBy=date&sortOrder=desc`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );

    if (!messagesRes.ok) {
      return NextResponse.json(
        { error: `Zoho messages API returned ${messagesRes.status}` },
        { status: 502 }
      );
    }

    const messagesData = (await messagesRes.json()) as Record<string, any>;
    const rawMessages = messagesData?.data || [];

    // 3. Zoho fallback — basic tier, 8-day decay
    const now = Date.now();
    const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

    const messages = rawMessages.map((m: any) => {
      const receivedMs = parseInt(m.receivedTime, 10) || Date.parse(m.receivedTime) || now;
      const ageMs = now - receivedMs;
      const decayPct = Math.min(100, Math.round((ageMs / EIGHT_DAYS_MS) * 100));
      const expiresAt = new Date(receivedMs + EIGHT_DAYS_MS).toISOString();
      const expired = ageMs >= EIGHT_DAYS_MS;

      return {
        messageId: m.messageId,
        subject: m.subject || '(no subject)',
        sender: m.sender || m.fromAddress || 'unknown',
        fromAddress: m.fromAddress || '',
        receivedTime: m.receivedTime,
        summary: m.summary || '',
        isRead: m.flagid === '5' || m.status === '1',
        hasAttachment: m.hasAttachment === 'true' || m.hasAttachment === true,
        decayPct,
        expiresAt,
        expired,
      };
    });

    // Filter out expired messages (8-day decay)
    const activeMessages = messages.filter((m: any) => !m.expired);

    return NextResponse.json({
      messages: activeMessages,
      total: activeMessages.length,
      tier: 'premium',
    });
  } catch (err: any) {
    console.error('Inbox error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch inbox' },
      { status: 500 }
    );
  }
}
