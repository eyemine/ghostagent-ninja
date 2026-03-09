/// <reference types="@cloudflare/workers-types" />
import type { Env } from './types';

export async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.TOKEN_KV.get('zoho_access_token');
  if (cached) return cached;
  const res = await fetch(`${env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.ZOHO_CLIENT_ID, client_secret: env.ZOHO_CLIENT_SECRET, refresh_token: env.ZOHO_REFRESH_TOKEN }),
  });
  if (!res.ok) throw new Error(`ZOHO token refresh failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in?: number };
  await env.TOKEN_KV.put('zoho_access_token', data.access_token, { expirationTtl: (data.expires_in ?? 3600) - 55 });
  return data.access_token;
}

export async function getAccountId(agentEmail: string, token: string, env: Env): Promise<string | null> {
  const res = await fetch(`${env.ZOHO_MAIL_URL}/api/organization/${env.ZOHO_ZOID}/accounts?searchWord=${encodeURIComponent(agentEmail)}`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) return null;
  const data = await res.json() as { data?: { accountId: string }[] };
  return data.data?.[0]?.accountId ?? null;
}

export interface ZohoMsg { messageId: string; fromAddress: string; toAddress: string; subject: string; receivedTime: string; }

export async function listUnread(accountId: string, token: string, env: Env): Promise<ZohoMsg[]> {
  const res = await fetch(`${env.ZOHO_MAIL_URL}/api/accounts/${accountId}/messages/view?limit=50&sortorder=false&status=unread`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) return [];
  const data = await res.json() as { data?: ZohoMsg[] };
  return data.data ?? [];
}

export async function getBody(accountId: string, messageId: string, token: string, env: Env): Promise<string> {
  const res = await fetch(`${env.ZOHO_MAIL_URL}/api/accounts/${accountId}/folders/INBOX/messages/${messageId}/content`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  if (!res.ok) return '[content unavailable]';
  const data = await res.json() as { data?: { content?: string } };
  return (data.data?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function deleteMsg(accountId: string, messageId: string, token: string, env: Env): Promise<void> {
  await fetch(`${env.ZOHO_MAIL_URL}/api/accounts/${accountId}/messages/${messageId}`, { method: 'DELETE', headers: { Authorization: `Zoho-oauthtoken ${token}` } });
}
