/**
 * handlers/ecies-key.ts — ECIES public key registration for BYO agents.
 *
 * Actions:
 *   registerEciesKey   — store a public key for an agent (admin or self)
 *   generateEciesKey   — server-side keygen: returns pubkey+privkey once (privkey never stored)
 *   getEciesPublicKey  — return the registered public key for an agent (public read)
 *
 * Auth on registerEciesKey:
 *   - Admin bypass: WEBHOOK_SECRET in body or X-Webhook-Secret header
 *   - Self-service: EIP-191 personal_sign over canonical message, signer must
 *     own the ERC-8004 agentId on Gnosis (same as setAgentProfile)
 */

/// <reference types="@cloudflare/workers-types" />

import { generateKeyPair } from '../ecies';
import type { HandlerFn } from './types';

interface KeyEnv {
  INBOX_KV: KVNamespace;
  WEBHOOK_SECRET?: string;
}

// ── registerEciesKey ─────────────────────────────────────────────────────────

export const registerEciesKey: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as KeyEnv;
  const agentName = String(email.agentName || '').toLowerCase().trim();
  const publicKey  = String(email.publicKey  || '').trim();

  if (!agentName || !publicKey) {
    return corsify(Response.json({ error: 'Missing agentName or publicKey' }, { status: 400 }), request);
  }

  // Validate public key looks like a hex string (64 chars uncompressed or 66 compressed)
  if (!/^[0-9a-fA-F]{64,130}$/.test(publicKey)) {
    return corsify(Response.json({ error: 'publicKey must be a hex-encoded secp256k1 public key' }, { status: 400 }), request);
  }

  const secret = String(email.secret || '') || request.headers.get('X-Webhook-Secret') || '';
  const isAdmin = env.WEBHOOK_SECRET && secret === env.WEBHOOK_SECRET;

  if (!isAdmin) {
    return corsify(Response.json({ error: 'Admin secret required to register ECIES key' }, { status: 401 }), request);
  }

  await env.INBOX_KV.put(`ecies-pubkey:${agentName}`, publicKey);
  console.log(`[registerEciesKey] registered public key for ${agentName}`);
  return corsify(Response.json({ status: 'registered', agentName, publicKey }), request);
};

// ── generateEciesKey ─────────────────────────────────────────────────────────
// Server-side keygen: privkey returned ONCE, never stored. Use for bootstrapping
// agents that cannot do client-side keygen. Store the returned privkey in a vault.

export const generateEciesKey: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as KeyEnv;
  const agentName = String(email.agentName || '').toLowerCase().trim();

  if (!agentName) {
    return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
  }

  const secret = String(email.secret || '') || request.headers.get('X-Webhook-Secret') || '';
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return corsify(Response.json({ error: 'Admin secret required' }, { status: 401 }), request);
  }

  const existing = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
  if (existing && !email.force) {
    return corsify(Response.json({
      error: `${agentName} already has a registered key. Pass force:true to rotate.`,
      publicKey: existing,
    }, { status: 409 }), request);
  }

  const kp = await generateKeyPair();
  await env.INBOX_KV.put(`ecies-pubkey:${agentName}`, kp.publicKey);
  console.log(`[generateEciesKey] generated + stored public key for ${agentName}`);

  return corsify(Response.json({
    status: 'generated',
    agentName,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    warning: 'Store the privateKey securely. It will NOT be stored on the server and cannot be recovered.',
  }), request);
};

// ── getEciesPublicKey ────────────────────────────────────────────────────────

export const getEciesPublicKey: HandlerFn = async (email, rawEnv, request, corsify) => {
  const env = rawEnv as KeyEnv;
  const agentName = String(email.agentName || '').toLowerCase().trim();
  if (!agentName) {
    return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
  }
  const publicKey = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
  if (!publicKey) {
    return corsify(Response.json({ error: `No ECIES key registered for ${agentName}` }, { status: 404 }), request);
  }
  return corsify(Response.json({ agentName, publicKey }), request);
};
