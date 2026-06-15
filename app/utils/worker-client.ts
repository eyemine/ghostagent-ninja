/**
 * Worker Client Utility
 * 
 * Makes authenticated requests to the Cloudflare Worker API.
 * Automatically includes X-Worker-Secret header for auth.
 */

import { WORKER_URL } from './config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET;

if (!WORKER_SECRET) {
  console.warn('WORKER_SECRET not set - worker requests will fail');
}

interface WorkerRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Make authenticated request to Cloudflare Worker
 */
export async function workerRequest(
  action: string,
  payload: Record<string, unknown> = {},
  options: WorkerRequestOptions = {}
): Promise<Response> {
  const url = WORKER_URL;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Worker-Secret': WORKER_SECRET || '',
    ...options.headers,
  };

  const body = JSON.stringify({
    action,
    ...payload,
  });

  return fetch(url, {
    method: options.method || 'POST',
    headers,
    body,
  });
}

/**
 * Convenience methods for common worker actions
 */
export const workerClient = {
  async getInbox(agentName: string) {
    const res = await workerRequest('getInbox', { localPart: agentName });
    return res.json();
  },

  async getAgentStatus(agentName: string) {
    const res = await workerRequest('getAgentStatus', { localPart: agentName });
    return res.json();
  },

  async getAgentIdentity(agentName: string) {
    const res = await workerRequest('getAgentIdentity', { agentName });
    return res.json();
  },

  async setAgentProfile(agentName: string, profile: Record<string, unknown>, signature: string, sigMessage: string, agentId: number) {
    const res = await workerRequest('setAgentProfile', {
      agentName,
      ...profile,
      signature,
      sigMessage,
      agentId,
    });
    return res.json();
  },

  async listAgents(safeAddress?: string) {
    const res = await workerRequest('listAgents', { safeAddress });
    return res.json();
  },

  async setAgentRecord(agentName: string, data: Record<string, unknown>) {
    const res = await workerRequest('setAgentRecord', { agentName, ...data });
    return res.json();
  },

  async setTld(agentName: string, tld: string) {
    const res = await workerRequest('setTld', { agentName, tld });
    return res.json();
  },
};

export default workerClient;
