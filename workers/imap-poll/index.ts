/// <reference types="@cloudflare/workers-types" />

import { encryptBody, sha256Hex } from './crypto';
import { getAccessToken, getAccountId, listUnread, getBody, deleteMsg } from './zoho';
import type { Env } from './types';
export type { Env } from './types';

type PrivacyMode = 'glassbox' | 'private' | 'hard-privacy';

interface AgentConfig {
  privacyMode: PrivacyMode;
  namespace: string;
  encryptionPubkeyHex?: string;
}

interface StoredMail {
  id: string;
  zohoMessageId: string;
  to: string;
  from: string;
  subject: string;
  receivedAt: number;
  body?: string;
  encrypted?: { version: string; epk: string; iv: string; ct: string };
  glassbox: boolean;
  contentHash: string;
}

async function notifyGlassBox(opts: {
  agentName: string; namespace: string; from: string;
  subject: string; contentHash: string; glassbox: boolean;
}, env: Env): Promise<void> {
  try {
    await fetch(`${env.NEXTJS_BASE_URL}/api/glassbox/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: opts.agentName,
        tld: opts.namespace,
        eventType: 'email-received',
        contentHash: opts.contentHash,
        xmtpEnabled: false,
        enhancedLogging: opts.glassbox,
        walletAddress: '0x0000000000000000000000000000000000000000',
        from: opts.glassbox ? opts.from : undefined,
        subject: opts.glassbox ? opts.subject : undefined,
        protocol: 'email',
      }),
    });
  } catch { /* non-fatal */ }
}

async function processAgent(agentName: string, token: string, env: Env): Promise<number> {
  const agentEmail = `${agentName}_@nftmail.box`;
  const config = await env.AGENT_KV.get<AgentConfig>(`agent:config:${agentName}`, 'json');
  if (!config) return 0;

  const isGlassBox = config.namespace === 'molt.gno' || config.privacyMode === 'glassbox';

  const accountId = await getAccountId(agentEmail, token, env);
  if (!accountId) return 0;

  const messages = await listUnread(accountId, token, env);
  let processed = 0;

  for (const msg of messages) {
    const body = await getBody(accountId, msg.messageId, token, env);
    const receivedAt = Date.now();
    const mailId = `mail-${receivedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const contentHash = await sha256Hex(JSON.stringify({ from: msg.fromAddress, to: msg.toAddress, subject: msg.subject, body, receivedAt }));

    let stored: StoredMail;

    if (isGlassBox) {
      stored = {
        id: mailId, zohoMessageId: msg.messageId,
        to: msg.toAddress, from: msg.fromAddress,
        subject: msg.subject, receivedAt,
        body,
        glassbox: true, contentHash,
      };
    } else if (config.encryptionPubkeyHex) {
      const encrypted = await encryptBody(body, config.encryptionPubkeyHex);
      stored = {
        id: mailId, zohoMessageId: msg.messageId,
        to: msg.toAddress, from: msg.fromAddress,
        subject: config.privacyMode === 'hard-privacy' ? '[encrypted]' : msg.subject,
        receivedAt,
        encrypted: { version: 'ecies-p256-aesgcm-1', ...encrypted },
        glassbox: false, contentHash,
      };
    } else {
      // No key yet — store stub, don't delete from ZOHO so it can be retried
      continue;
    }

    // Write to INBOX_KV — no TTL for GlassBox, 90 days for private
    const ttl = isGlassBox ? undefined : 7_776_000;
    await env.INBOX_KV.put(
      `mail:${agentName}:${mailId}`,
      JSON.stringify(stored),
      ttl ? { expirationTtl: ttl } : undefined
    );

    // Increment unread counter
    const prevRaw = await env.INBOX_KV.get(`unread:${agentName}`);
    await env.INBOX_KV.put(`unread:${agentName}`, String((parseInt(prevRaw ?? '0', 10)) + 1));

    // Delete from ZOHO — cleartext no longer needed
    await deleteMsg(accountId, msg.messageId, token, env);

    // GlassBox audit trail
    await notifyGlassBox({
      agentName, namespace: config.namespace,
      from: msg.fromAddress, subject: msg.subject,
      contentHash, glassbox: isGlassBox,
    }, env);

    processed++;
  }

  return processed;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const token = await getAccessToken(env);
      const list = await env.AGENT_KV.list({ prefix: 'agent:config:' });
      const agents = list.keys.map((k: { name: string }) => k.name.replace('agent:config:', ''));

      let total = 0;
      for (const agent of agents) {
        try {
          total += await processAgent(agent, token, env);
        } catch (err) {
          console.error(`[imap-poll] error processing ${agent}:`, err);
        }
      }
      console.log(`[imap-poll] processed ${total} messages across ${agents.length} agents`);
    })());
  },
};
