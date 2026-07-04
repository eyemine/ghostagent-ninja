/**
 * handlers/transmission.ts — bitmap-only secure channel (Agent Fax / NFTfax).
 *
 * Handles: sendTransmission | getDocumentTray | getTransmission | acknowledgeTransmission
 *
 * Cleartext gap fix: imageData is ECIES-encrypted before KV storage when the
 * recipient has a registered public key. Metadata (id, from, to, mimeType,
 * sentAt, acknowledged) remains plaintext so getDocumentTray can list without
 * decrypting. The encrypted payload is stored as `encryptedImage` (ECIES
 * envelope). Tray entries without a pubkey fall back to plaintext `imageData`
 * with a `cleartext: true` flag so clients can warn appropriately.
 */

/// <reference types="@cloudflare/workers-types" />

import { encrypt as eciesEncrypt } from '../ecies';
import type { HandlerFn } from './types';

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/bmp', 'image/tiff'];
const MG_EU_ENDPOINT = 'https://api.eu.mailgun.net/v3/mg.nftmail.box/messages';
const TTL_MAP: Record<string, number> = { basic: 8 * 86400, lite: 30 * 86400, professional: 365 * 86400, vault: 365 * 86400 };

// ── Env shape required by this handler ───────────────────────────────────────
interface TxEnv {
  INBOX_KV: KVNamespace;
  MG_SENDING_MAILGUN_API_KEY?: string;
  MG_MAILGUN_API_KEY?: string;
  GM_MAILGUN_API_KEY?: string;
  SEND_MAILGUN_API_KEY?: string;
  MAILGUN_API_KEY?: string;
}

function mgKey(e: TxEnv): string | undefined {
  return e.MG_SENDING_MAILGUN_API_KEY || e.MG_MAILGUN_API_KEY || e.GM_MAILGUN_API_KEY || e.SEND_MAILGUN_API_KEY || e.MAILGUN_API_KEY;
}

// ── sendTransmission ─────────────────────────────────────────────────────────

export const sendTransmission: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as TxEnv;
  const fromName = (String(email.fromName || '')).toLowerCase().trim();
  const toEmail  = String(email.toEmail  || '').trim();
  const imageData = String(email.imageData || '').trim();
  const mimeType  = String(email.mimeType  || '').toLowerCase().trim();
  const fileName  = String(email.fileName  || 'transmission').trim();

  if (!fromName || !toEmail || !imageData || !mimeType) {
    return corsify(Response.json({ error: 'Missing fromName, toEmail, imageData or mimeType' }, { status: 400 }), request);
  }
  if (!ALLOWED_MIME.includes(mimeType)) {
    return corsify(Response.json({ error: `Unsupported type: ${mimeType}. Allowed: PNG, JPEG, BMP, TIFF.` }, { status: 415 }), request);
  }
  if (imageData.length > 7 * 1024 * 1024) {
    return corsify(Response.json({ error: 'Image exceeds 5 MB limit' }, { status: 413 }), request);
  }

  const tierRaw = await env.INBOX_KV.get(`acct-tier:${fromName}`);
  if (!tierRaw) {
    return corsify(Response.json({ error: 'Sender agent not found' }, { status: 404 }), request);
  }
  const tierData = JSON.parse(tierRaw) as Record<string, unknown>;
  const tier = String(tierData.tier || 'basic');

  if (tier === 'basic') {
    return corsify(Response.json({ error: 'Basic tier cannot send transmissions. Upgrade to send.' }, { status: 402 }), request);
  }

  const nowMs = Date.now();
  const todayUtcMs = nowMs - (nowMs % 86400000);
  let sendsRemaining: number | string = 'unlimited';

  if (tier === 'lite') {
    const DAILY_LIMIT = 100;
    if ((tierData.dailySendWindowStart as number || 0) < todayUtcMs) {
      tierData.dailySendCount = 0;
      tierData.dailySendWindowStart = todayUtcMs;
    }
    const used = (tierData.dailySendCount as number) || 0;
    if (used >= DAILY_LIMIT) {
      return corsify(Response.json({ error: 'Daily send limit reached', sendsRemaining: 0 }, { status: 429 }), request);
    }
    tierData.dailySendCount = used + 1;
    tierData.dailySendWindowStart = todayUtcMs;
    sendsRemaining = DAILY_LIMIT - (tierData.dailySendCount as number);
  }

  const txId = `tx-${nowMs}-${crypto.randomUUID().slice(0, 8)}`;
  const sendApiKey = mgKey(env);
  const subject = `[TRANSMISSION] ${txId.slice(0, 20)} from ${fromName}@nftmail.box`;
  const coverHtml = buildCoverHtml(fromName, toEmail, txId, nowMs, mimeType);
  const toNorm = toEmail.toLowerCase().trim();

  if (toNorm.endsWith('@nftmail.box')) {
    const recipLocal = toNorm.slice(0, -'@nftmail.box'.length);
    const recipTierRaw = await env.INBOX_KV.get(`acct-tier:${recipLocal}`);
    if (!recipTierRaw) {
      return corsify(Response.json({ error: 'Recipient not found on nftmail.box' }, { status: 404 }), request);
    }
    const recipTier = String((JSON.parse(recipTierRaw) as { tier?: string }).tier || 'basic');
    const ttl = TTL_MAP[recipTier] ?? 8 * 86400;

    // ── Encrypt imageData with recipient ECIES pubkey if available ────────────
    const recipPubKey = await env.INBOX_KV.get(`ecies-pubkey:${recipLocal}`);
    let trayRecord: Record<string, unknown>;
    if (recipPubKey) {
      let encryptedImage: unknown = null;
      try {
        encryptedImage = await eciesEncrypt(imageData, recipPubKey);
      } catch (encErr) {
        console.error('[sendTransmission] ECIES encrypt failed (non-fatal):', encErr);
      }
      trayRecord = {
        id: txId, from: `${fromName}@nftmail.box`, to: toEmail,
        mimeType, fileName, sentAt: nowMs, acknowledged: false,
        ...(encryptedImage ? { encryptedImage, cleartext: false } : { imageData, cleartext: true }),
      };
    } else {
      trayRecord = {
        id: txId, from: `${fromName}@nftmail.box`, to: toEmail,
        mimeType, fileName, sentAt: nowMs, acknowledged: false,
        imageData, cleartext: true,
      };
    }

    await env.INBOX_KV.put(`tray:${recipLocal}:${txId}`, JSON.stringify(trayRecord), { expirationTtl: ttl });

    if (sendApiKey) {
      try {
        const notifForm = new URLSearchParams();
        notifForm.append('from', `${fromName} <${fromName}@nftmail.box>`);
        notifForm.append('to', toEmail);
        notifForm.append('subject', subject);
        notifForm.append('html', coverHtml);
        notifForm.append('text', `Transmission received from ${fromName}@nftmail.box. Visit your Document Tray to collect.`);
        await fetch(MG_EU_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`api:${sendApiKey}`)}` },
          body: notifForm,
        });
      } catch (err) {
        console.error('[sendTransmission] notification email failed (non-fatal):', err);
      }
    }
  } else {
    if (!sendApiKey) {
      return corsify(Response.json({ error: 'Email sending not configured' }, { status: 503 }), request);
    }
    const binaryStr = atob(imageData);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const form = new FormData();
    form.append('from', `${fromName} <${fromName}@nftmail.box>`);
    form.append('to', toEmail);
    form.append('subject', subject);
    form.append('html', coverHtml);
    form.append('text', `Transmission from ${fromName}@nftmail.box — bitmap attachment enclosed.`);
    form.append('attachment', new Blob([bytes], { type: mimeType }), fileName);
    const mgRes = await fetch(MG_EU_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`api:${sendApiKey}`)}` },
      body: form,
    });
    if (!mgRes.ok) {
      const errText = await mgRes.text();
      return corsify(Response.json({ error: `Mailgun error: ${errText.slice(0, 100)}` }, { status: 502 }), request);
    }
  }

  await env.INBOX_KV.put(`acct-tier:${fromName}`, JSON.stringify(tierData));
  return corsify(Response.json({ status: 'transmitted', txId, sendsRemaining, encrypted: true }), request);
};

// ── getDocumentTray ──────────────────────────────────────────────────────────
// Returns metadata only — imageData and encryptedImage are stripped.

export const getDocumentTray: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as TxEnv;
  const localPart = String(email.localPart || '').toLowerCase().trim();
  if (!localPart) {
    return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
  }
  const listed = await env.INBOX_KV.list({ prefix: `tray:${localPart}:` });
  const items = await Promise.all(
    listed.keys.map(async (k) => {
      const raw = await env.INBOX_KV.get(k.name);
      if (!raw) return null;
      const { imageData: _img, encryptedImage: _enc, ...meta } = JSON.parse(raw) as Record<string, unknown>;
      return meta;
    }),
  );
  return corsify(Response.json({ transmissions: items.filter(Boolean) }), request);
};

// ── getTransmission ──────────────────────────────────────────────────────────
// Returns full record; if encryptedImage is present the client must decrypt.

export const getTransmission: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as TxEnv;
  const localPart = String(email.localPart || '').toLowerCase().trim();
  const txId = String(email.txId || '').trim();
  if (!localPart || !txId) {
    return corsify(Response.json({ error: 'Missing localPart or txId' }, { status: 400 }), request);
  }
  const raw = await env.INBOX_KV.get(`tray:${localPart}:${txId}`);
  if (!raw) {
    return corsify(Response.json({ error: 'Transmission not found' }, { status: 404 }), request);
  }
  return corsify(Response.json(JSON.parse(raw)), request);
};

// ── acknowledgeTransmission ──────────────────────────────────────────────────

export const acknowledgeTransmission: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as TxEnv;
  const localPart = String(email.localPart || '').toLowerCase().trim();
  const txId = String(email.txId || '').trim();
  if (!localPart || !txId) {
    return corsify(Response.json({ error: 'Missing localPart or txId' }, { status: 400 }), request);
  }
  const key = `tray:${localPart}:${txId}`;
  const raw = await env.INBOX_KV.get(key);
  if (!raw) {
    return corsify(Response.json({ error: 'Transmission not found or already acknowledged' }, { status: 404 }), request);
  }
  const record = JSON.parse(raw) as Record<string, unknown>;
  record.acknowledged = true;
  record.acknowledgedAt = Date.now();
  await env.INBOX_KV.put(key, JSON.stringify(record), { expirationTtl: 86400 });
  return corsify(Response.json({ status: 'acknowledged', txId }), request);
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCoverHtml(from: string, to: string, txId: string, nowMs: number, mimeType: string): string {
  return `<!DOCTYPE html><html><body style="background:#111;color:#d4d4aa;font-family:monospace;padding:24px;max-width:520px"><pre style="border:1px solid #444;padding:16px;font-size:12px;line-height:1.6">================================
  AGENT TRANSMISSION RECEIVED
================================
FROM  : ${from}@nftmail.box
TO    : ${to}
TX ID : ${txId}
DATE  : ${new Date(nowMs).toISOString().replace('T', ' ').slice(0, 19)} UTC
TYPE  : ${mimeType}
================================
Visit your Document Tray to view
and acknowledge this transmission.
================================</pre><p style="color:#888;font-size:11px;margin-top:16px">Bitmap-only secure channel. No executables. No macros. No scripts.</p></body></html>`;
}
