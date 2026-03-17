/// POST /api/send-email
/// Send email on behalf of a label@nftmail.box address.
///
/// Auth: Privy JWT in Authorization header (Bearer <token>)
///       OR ownerWallet in body (fallback for Privy embedded wallets)
///
/// Tier gate: acct-tier KV must be 'lite' or 'premium'. Basic = receive-only.
///
/// Send strategy:
///   - lite/premium with Zoho provisioned seat → send from label@nftmail.box directly
///   - lite without dedicated seat → relay via ghostagent@nftmail.box with Reply-To: label@nftmail.box
///     (Zoho alias send — all nftmail.box inbound routes through ghostagent catch-all anyway)

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      label?: string;         // sender label (e.g. "mac.slave")
      ownerWallet?: string;   // Privy wallet address for auth
      to?: string;            // recipient address
      subject?: string;
      body?: string;          // markdown body
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

    // ── Tier gate: verify sender owns this label and has send permissions ──
    const resolveRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolveAddress', name: label }),
    });
    const resolved = await resolveRes.json() as any;

    if (!resolved?.exists) {
      return NextResponse.json({ error: 'This address does not exist' }, { status: 404 });
    }

    // Verify wallet matches the registered controller
    const controller = resolved?.onChainOwner?.toLowerCase();
    if (controller && controller !== ownerWallet.toLowerCase()) {
      return NextResponse.json({ error: 'Wallet does not match the registered owner of this address' }, { status: 403 });
    }

    const accountTier = resolved?.accountTier || 'basic';
    if (accountTier === 'basic') {
      return NextResponse.json({
        error: 'Basic tier is receive-only. Upgrade to Lite ($10 xDAI) to enable sending.',
        upgradeUrl: `/nftmail?upgrade=lite&label=${label}`,
        tier: 'basic',
      }, { status: 402 });
    }

    if (!['lite', 'premium', 'ghost'].includes(accountTier)) {
      return NextResponse.json({ error: `Unknown tier: ${accountTier}` }, { status: 403 });
    }

    const zohoOrgId = process.env.ZOHO_ORG_ID;
    const token = await getZohoAccessToken();

    if (!token || !zohoOrgId) {
      return NextResponse.json({ error: 'Mail server not configured' }, { status: 503 });
    }

    // ── Find the Zoho account to send from ──
    // Premium: dedicated label@nftmail.box seat. Lite: relay via ghostagent@nftmail.box.
    const fromEmail = `${label}@nftmail.box`;
    const relayEmail = `ghostagent@nftmail.box`;

    const accountsRes = await fetch(
      `${ZOHO_MAIL_API}/organization/${zohoOrgId}/accounts`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );

    if (!accountsRes.ok) {
      return NextResponse.json({ error: `Zoho accounts API error: ${accountsRes.status}` }, { status: 502 });
    }

    const accountsData = (await accountsRes.json()) as Record<string, any>;
    const accounts: any[] = accountsData?.data || [];

    // Try exact match first (premium seat), fall back to relay account
    let sendAccount = accounts.find(
      (a: any) =>
        a.primaryEmailAddress?.toLowerCase() === fromEmail.toLowerCase() ||
        a.mailboxAddress?.toLowerCase() === fromEmail.toLowerCase()
    );
    const useAlias = !sendAccount;
    if (useAlias) {
      sendAccount = accounts.find(
        (a: any) =>
          a.primaryEmailAddress?.toLowerCase() === relayEmail.toLowerCase() ||
          a.mailboxAddress?.toLowerCase() === relayEmail.toLowerCase()
      );
    }

    if (!sendAccount) {
      return NextResponse.json({ error: 'No Zoho mailbox available for sending. Contact support.' }, { status: 503 });
    }

    const accountId = sendAccount.accountId || sendAccount.zuid;

    // Convert markdown to simple HTML for better email client rendering
    const htmlBody = markdownToHtml(mailBody);

    const sendPayload: Record<string, any> = {
      fromAddress: useAlias ? relayEmail : fromEmail,
      toAddress: to,
      subject: subject || '(no subject)',
      content: htmlBody,
      mailFormat: 'html',
    };

    // For alias relay: set Reply-To so replies come back to label@nftmail.box
    if (useAlias) {
      sendPayload.replyTo = fromEmail;
      sendPayload.displayName = `${label} via NFTMail`;
    }

    const sendRes = await fetch(
      `${ZOHO_MAIL_API}/accounts/${accountId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(sendPayload),
      }
    );

    if (!sendRes.ok) {
      const errData = (await sendRes.json().catch(() => ({}))) as Record<string, any>;
      return NextResponse.json(
        { error: errData?.data?.message || `Zoho send failed: ${sendRes.status}` },
        { status: 502 }
      );
    }

    const sendData = (await sendRes.json()) as Record<string, any>;

    return NextResponse.json({
      success: true,
      messageId: sendData?.data?.messageId || 'sent',
      from: fromEmail,
      to,
      subject: subject || '(no subject)',
      relayed: useAlias,
    });
  } catch (err: any) {
    console.error('[send-email]', err);
    return NextResponse.json({ error: err?.message || 'Send failed' }, { status: 500 });
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
