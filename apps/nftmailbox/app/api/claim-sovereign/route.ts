import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL = process.env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

async function sendWelcomeEmail(claimedEmail: string, keyType: string): Promise<void> {
  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN || 'nftmail.box';
  const mailgunBase = process.env.MAILGUN_API_BASE || 'https://api.eu.mailgun.net/v3';
  if (!mailgunApiKey) return;

  const label = claimedEmail.replace('@nftmail.box', '');
  const inboxUrl = `https://nftmail.box/inbox/${label}`;
  const moltUrl = `https://nftmail.box/nftmail?upgrade=lite`;
  const sourceLabel = keyType === 'ens' ? 'ENS name' : 'NFT';

  const form = new URLSearchParams();
  form.set('from', `NFTMail <welcome@${mailgunDomain}>`);
  form.set('to', claimedEmail);
  form.set('subject', `Your nftmail.box inbox is live — ${claimedEmail}`);
  form.set('text', [
    `Hi ${label},`,
    ``,
    `Your inbox is live, claimed via your ${sourceLabel}:`,
    `  ${claimedEmail}`,
    ``,
    `Read inbox:   ${inboxUrl}`,
    `Dashboard:    https://nftmail.box/dashboard`,
    ``,
    `Your inbox is privacy-first — messages are encrypted at rest`,
    `and only you can read them with your connected wallet.`,
    ``,
    `Free tier includes:`,
    `  · Receive unlimited emails`,
    `  · Send up to 10 emails`,
    `  · 8-day message history`,
    `  · Up to 10 addresses per wallet`,
    ``,
    `─────────────────────────────────────────`,
    ``,
    `Molt to Imago — unlock the full agent experience:`,
    ``,
    `  · Unlimited sending`,
    `  · 30-day message history`,
    `  · Agent-to-agent (A2A) messaging`,
    `  · On-chain identity as an NFT — transferable, tradeable`,
    `  · A Gnosis Safe treasury attached to your agent name`,
    `  · Autonomous agent mode with on-chain brain`,
    ``,
    `  Molt at: ${moltUrl}`,
    ``,
    `─────────────────────────────────────────`,
    ``,
    `— nftmail.box`,
  ].join('\n'));

  await fetch(`${mailgunBase}/${mailgunDomain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`api:${mailgunApiKey}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      keyType: string;
      keyId: string;
      ownerAddress: string;
      claimedEmail: string;
    };

    const { keyType, keyId, ownerAddress, claimedEmail } = body;

    if (!keyType || !keyId || !ownerAddress || !claimedEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['ens', 'nft-collection'].includes(keyType)) {
      return NextResponse.json({ error: 'keyType must be ens or nft-collection' }, { status: 400 });
    }

    if (!claimedEmail.endsWith('@nftmail.box')) {
      return NextResponse.json({ error: 'claimedEmail must end with @nftmail.box' }, { status: 400 });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'claimSovereignInbox',
        keyType,
        keyId,
        ownerAddress: ownerAddress.toLowerCase(),
        claimedEmail,
      }),
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Send welcome email non-fatally — claim already succeeded
    sendWelcomeEmail(claimedEmail, keyType).catch(() => {});

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Claim failed' }, { status: 500 });
  }
}
