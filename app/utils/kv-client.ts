/**
 * Centralized KV client for Cloudflare Worker interactions.
 * Automatically injects X-Worker-Secret header on all requests.
 */

import { WORKER_URL } from './config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

export async function kvFetch(action: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': WORKER_SECRET,
    },
    body: JSON.stringify({ action, ...body }),
  });
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const res = await kvFetch('kvGet', { key });
  if (!res.ok) return null;
  const data = await res.json() as { value?: string };
  return data.value ? JSON.parse(data.value) : null;
}

export async function kvPut(key: string, value: unknown, ownerAddress?: string): Promise<boolean> {
  const res = await kvFetch('kvPut', {
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    ownerAddress: ownerAddress ?? 'system',
  });
  return res.ok;
}

export async function getAgentIdentity(name: string): Promise<Record<string, unknown> | null> {
  const res = await kvFetch('getAgentIdentity', { name });
  if (!res.ok) return null;
  return res.json();
}

export async function getAgentProfile(name: string): Promise<Record<string, unknown> | null> {
  const res = await kvFetch('getAgentProfile', { name });
  if (!res.ok) return null;
  return res.json();
}

export async function setTld(agentName: string, tld: string): Promise<boolean> {
  const res = await kvFetch('setTld', { agentName, tld });
  return res.ok;
}

export async function listAgents(): Promise<{ agents: Array<Record<string, unknown>>; total: number }> {
  const res = await kvFetch('listAgents', {});
  if (!res.ok) return { agents: [], total: 0 };
  const data = await res.json();
  return data as { agents: Array<Record<string, unknown>>; total: number };
}

export async function getAlias(primaryName: string): Promise<Record<string, unknown> | null> {
  const res = await kvFetch('getAlias', { primaryName });
  if (!res.ok) return null;
  return res.json();
}

export async function getAcctTier(localPart: string, tld?: string): Promise<{ tier?: string } | null> {
  const res = await kvFetch('getAcctTier', { localPart, tld: tld ?? '' });
  if (!res.ok) return null;
  return res.json();
}
