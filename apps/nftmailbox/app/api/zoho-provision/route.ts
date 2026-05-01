import { NextResponse } from 'next/server';

const ZOHO_API = 'https://mail.zoho.com/api';

async function getZohoAccessToken() {
  const existing = process.env.ZOHO_OAUTH_TOKEN;
  if (existing) return existing;

  const accountsDomain = process.env.ZOHO_ACCOUNTS_DOMAIN;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!accountsDomain || !refreshToken || !clientId || !clientSecret) {
    return null;
  }

  const tokenUrl = `https://${accountsDomain}/oauth/v2/token`;

  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', refreshToken);
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    throw new Error(data?.error || data?.error_description || `Zoho token endpoint returned ${res.status}`);
  }

  return (data.access_token as string) || null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      agentName?: string;
      email?: string;
      tbaAddress?: string;
    };

    const { agentName, email, tbaAddress } = body;

    if (!agentName || !email) {
      return NextResponse.json({ error: 'Missing agentName or email' }, { status: 400 });
    }

    const zohoOrgId = process.env.ZOHO_ORG_ID;

    const zohoToken = await getZohoAccessToken();

    if (!zohoToken || !zohoOrgId) {
      return NextResponse.json(
        {
          error:
            'Zoho not configured — set ZOHO_ORG_ID and either ZOHO_OAUTH_TOKEN or (ZOHO_ACCOUNTS_DOMAIN, ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET)',
        },
        { status: 503 }
      );
    }

    const createRes = await fetch(`${ZOHO_API}/organization/${zohoOrgId}/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${zohoToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        primaryEmailAddress: email,
        displayName: agentName,
        password: crypto.randomUUID().slice(0, 16) + 'Aa1!',
        role: 'member',
      }),
    });

    if (!createRes.ok) {
      const errData = (await createRes.json().catch(() => ({}))) as Record<string, any>;
      return NextResponse.json(
        {
          error: errData?.data?.message || `Zoho API returned ${createRes.status}`,
        },
        { status: 502 }
      );
    }

    const createData = (await createRes.json()) as Record<string, any>;
    const accountId = createData?.data?.accountId || createData?.data?.zuid;

    return NextResponse.json({
      status: 'provisioned',
      mailboxId: accountId || 'pending',
      email,
      agentName,
      tbaAddress,
      webmailUrl: `https://mail.zoho.com`,
      imapHost: 'imappro.zoho.com',
      smtpHost: 'smtppro.zoho.com',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Provisioning failed' }, { status: 500 });
  }
}
