/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Email Worker — Receive-and-Encrypt Ingest
 *
 * Deployed on the nftmail.box MX record via Cloudflare Email Routing.
 * Catches ALL inbound SMTP to *@nftmail.box before ZOHO sees it.
 *
 * Privacy routing:
 *   molt.gno      → GlassBox: store plaintext + full GlassBox audit entry
 *   glassbox mode → GlassBox: store plaintext + full GlassBox audit entry
 *   private       → Encrypt to agent P-256 pubkey, store ciphertext only
 *   hard-privacy  → Encrypt, store ciphertext only, log hash only
 *
 * Required Worker KV bindings:
 *   MAIL_KV        — stores encrypted/plaintext mail + agent config
 *
 * Required Worker secrets:
 *   WORKER_API_SECRET — shared secret for API calls back to Next.js
 *   NEXTJS_BASE_URL   — e.g. https://ghostagent.ninja
 *
 * Wrangler config (add to wrangler.toml):
 *   [[email]]
 *   name = "email-ingest"
 *
 *   [[kv_namespaces]]
 *   binding = "MAIL_KV"
 *   id = "<your-kv-id>"
 */

export interface Env {
  MAIL_KV: KVNamespace;   // INBOX_KV d2177071c3fb4c48a1a22b36ee1a1baf — mail storage
  AGENT_KV: KVNamespace;  // AGENT_KV  a2ff4c0ed2a348529e781a2a3ed2a140 — agent config
  WORKER_API_SECRET: string;
  NEXTJS_BASE_URL: string;
}

type PrivacyMode = 'glassbox' | 'private' | 'hard-privacy';

interface AgentConfig {
  privacyMode: PrivacyMode;
  namespace: string;          // e.g. molt.gno
  encryptionPubkeyHex?: string; // P-256 pubkey for non-glassbox agents
}

interface StoredMail {
  id: string;
  to: string;
  from: string;
  subject: string;
  receivedAt: number;
  // One of these is set:
  body?: string;              // plaintext (GlassBox only)
  encrypted?: {               // ECIES ciphertext
    version: string;
    epk: string;
    iv: string;
    ct: string;
  };
  glassbox: boolean;
  contentHash: string;        // SHA-256 of full mail JSON (always logged)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(buf));
}

async function encryptBody(
  body: string,
  pubkeyHex: string
): Promise<{ epk: string; iv: string; ct: string }> {
  const recipientBytes = hexToBytes(pubkeyHex);
  const recipientBuf = recipientBytes.buffer.slice(
    recipientBytes.byteOffset,
    recipientBytes.byteOffset + recipientBytes.byteLength
  ) as ArrayBuffer;

  const recipientKey = await crypto.subtle.importKey(
    'raw', recipientBuf,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey }, ephemeral.privateKey, 256
  );

  const epkRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const epkHex = bytesToHex(new Uint8Array(epkRaw));

  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const ivBuf = ivBytes.buffer.slice(
    ivBytes.byteOffset, ivBytes.byteOffset + ivBytes.byteLength
  ) as ArrayBuffer;

  const baseKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const saltBuf = ivBuf;
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info: new TextEncoder().encode('nftmail-inbox-v1') },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );

  const ptBytes = new TextEncoder().encode(body);
  const ptBuf = ptBytes.buffer.slice(
    ptBytes.byteOffset, ptBytes.byteOffset + ptBytes.byteLength
  ) as ArrayBuffer;

  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuf }, aesKey, ptBuf);

  return { epk: epkHex, iv: bytesToHex(ivBytes), ct: bytesToHex(new Uint8Array(ct)) };
}

// ── Agent config lookup ───────────────────────────────────────────────────────

async function getAgentConfig(agentName: string, env: Env): Promise<AgentConfig> {
  const raw = await env.AGENT_KV.get(`agent:config:${agentName.toLowerCase()}`, 'json');
  if (raw) return raw as AgentConfig;

  // Default: molt.gno is always GlassBox, others default to private
  return {
    privacyMode: 'private',
    namespace: 'unknown',
  };
}

// ── GlassBox notification ─────────────────────────────────────────────────────

async function notifyGlassBox(opts: {
  agentName: string;
  namespace: string;
  from: string;
  subject: string;
  contentHash: string;
  mailId: string;
  glassbox: boolean;
}, env: Env): Promise<void> {
  try {
    await fetch(`${env.NEXTJS_BASE_URL}/api/glassbox/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': env.WORKER_API_SECRET,
      },
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
        protocol: 'email' as const,
      }),
    });
  } catch {
    // Non-fatal — don't fail mail delivery if GlassBox logging fails
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const to = message.to;                   // e.g. alice_@nftmail.box
    const from = message.from;
    const agentName = to.split('@')[0].replace(/_$/, ''); // strip trailing _

    // Read raw email body (text/plain preferred, fall back to full raw)
    let body = '';
    try {
      const reader = message.raw.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const raw = new TextDecoder().decode(
        chunks.reduce((a, b) => {
          const merged = new Uint8Array(a.length + b.length);
          merged.set(a); merged.set(b, a.length);
          return merged;
        })
      );
      // Extract body after double CRLF header separator
      const sep = raw.indexOf('\r\n\r\n');
      body = sep !== -1 ? raw.slice(sep + 4) : raw;
    } catch {
      body = '[body unavailable]';
    }

    const subject = message.headers.get('subject') ?? '(no subject)';
    const receivedAt = Date.now();
    const mailId = `mail-${receivedAt}-${Math.random().toString(36).slice(2, 8)}`;

    // Look up agent config
    const config = await getAgentConfig(agentName, env);

    // molt.gno always GlassBox regardless of stored config
    const isGlassBox =
      config.namespace === 'molt.gno' ||
      to.includes('molt.gno') ||
      config.privacyMode === 'glassbox';

    const contentHash = await sha256Hex(
      JSON.stringify({ from, to, subject, body, receivedAt })
    );

    let stored: StoredMail;

    if (isGlassBox) {
      // ── GlassBox path: store plaintext, full audit trail ──────────────────
      stored = {
        id: mailId,
        to, from, subject, receivedAt,
        body,                   // cleartext preserved for public audit
        glassbox: true,
        contentHash,
      };
    } else if (config.encryptionPubkeyHex) {
      // ── Private/hard-privacy: encrypt body, discard plaintext ─────────────
      const encrypted = await encryptBody(body, config.encryptionPubkeyHex);
      stored = {
        id: mailId,
        to, from,
        subject: config.privacyMode === 'hard-privacy' ? '[encrypted]' : subject,
        receivedAt,
        encrypted: { version: 'ecies-p256-aesgcm-1', ...encrypted },
        glassbox: false,
        contentHash,
      };
      // Plaintext body is now out of scope and will be GC'd
    } else {
      // No pubkey registered yet — store encrypted placeholder
      stored = {
        id: mailId,
        to, from,
        subject: '[pending key registration]',
        receivedAt,
        glassbox: false,
        contentHash,
      };
    }

    // Write to KV — TTL 90 days (8_035_200 seconds) for private, no TTL for GlassBox
    const kvKey = `mail:${agentName.toLowerCase()}:${mailId}`;
    const ttl = isGlassBox ? undefined : 8_035_200;
    await env.MAIL_KV.put(kvKey, JSON.stringify(stored), ttl ? { expirationTtl: ttl } : undefined);

    // Update unread count
    const unreadKey = `unread:${agentName.toLowerCase()}`;
    const prev = parseInt(await env.MAIL_KV.get(unreadKey) ?? '0', 10);
    await env.MAIL_KV.put(unreadKey, String(prev + 1));

    // Notify GlassBox audit trail
    await notifyGlassBox({
      agentName,
      namespace: config.namespace,
      from,
      subject,
      contentHash,
      mailId,
      glassbox: isGlassBox,
    }, env);
  },
};
