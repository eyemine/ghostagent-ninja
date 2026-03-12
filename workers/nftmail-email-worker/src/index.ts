/// <reference types="@cloudflare/workers-types" />

import MailStorageAdapter, { CalendarInvite } from './storage';
import { buildDirectMessageTopic, createWakuEnvelope } from './waku';
import { encrypt as eciesEncrypt, generateKeyPair, EncryptedEnvelope } from './ecies';
import {
  PrivacyTier as PrivacyTierType,
  routeSetPrivacy,
  parsePrivacyRecord,
  validateSetPrivacy,
  shouldEncrypt,
  getMoltPrivateCharge,
} from './privacy-router';
import {
  handleAliasAction,
  resolveAlias,
  type AliasActionPayload,
} from './alias-router';
import {
  sealCleartext,
  buildAuditHashEntry,
  releasePlaintext,
} from './edge-encrypt';

export interface Env {
  BACKEND: 'KV';
  SURGE_TOKEN: string;
  GHOST_REGISTRY: string;
  INBOX_KV: KVNamespace;
  GHOST_CALENDAR: KVNamespace;
  ZOHO_WEBHOOK_SECRET?: string;
  WEBHOOK_SECRET?: string;
  IPFS_GATEWAY?: string;
  // Zoho API for forwarding encrypted blobs to catch-all
  ZOHO_REFRESH_TOKEN?: string;
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_CATCHALL_ACCOUNT_ID?: string;
  // Social recovery: Master Safe public key (optional auditor)
  MASTER_SAFE_PUBKEY?: string;
}

interface EmailMessage {
  from: string;
  to: string;
  raw: ReadableStream;
  headers: Headers;
  rawSize: number;
  forward(to: string, headers?: Headers): Promise<void>;
  reply(message: EmailMessage): Promise<void>;
  setReject(reason: string): void;
}

interface HttpEmailPayload {
  action?: string;
  email?: string;
  localPart?: string;
  from: string;
  to: string;
  subject: string;
  content: string;
}

// Accept both nftmail.box and surge.nftmail.box (Zoho routing destination)
const EMAIL_RE = /^([a-z0-9._-]+)(@(?:surge\.)?nftmail\.box)$/;
const AGENT_EMAIL_RE = /^([a-z0-9._-]+)_(@(?:surge\.)?nftmail\.box)$/;

function extractLocalPart(email: string): string | null {
  const match = EMAIL_RE.exec(email.toLowerCase().trim());
  return match ? match[1] : null;
}

// --- MIME Parsing Helpers ---
// Extract the original @nftmail.box recipient from headers or message.to
function resolveOriginalRecipient(message: EmailMessage): string {
  // Priority: X-Original-To → Delivered-To → To header → message.to
  const xOrigTo = message.headers.get('x-original-to');
  if (xOrigTo && xOrigTo.includes('@nftmail.box')) return xOrigTo.trim();
  const deliveredTo = message.headers.get('delivered-to');
  if (deliveredTo && deliveredTo.includes('@nftmail.box')) return deliveredTo.trim();
  const toHeader = message.headers.get('to');
  if (toHeader && toHeader.includes('@nftmail.box')) {
    // Extract email from "Name <email>" format
    const emailMatch = /<([^>]+@nftmail\.box)>/.exec(toHeader) || /([^\s,]+@nftmail\.box)/.exec(toHeader);
    if (emailMatch) return emailMatch[1].trim();
  }
  // Fallback: strip surge. prefix from message.to
  return message.to.replace('@surge.nftmail.box', '@nftmail.box');
}

// Extract plain text body from raw MIME content
function extractBodyFromMime(rawMime: string): string {
  // Split headers from body at first blank line
  const blankLineIdx = rawMime.indexOf('\r\n\r\n');
  const splitIdx = blankLineIdx !== -1 ? blankLineIdx : rawMime.indexOf('\n\n');
  if (splitIdx === -1) return rawMime; // No headers found, treat entire content as body

  const headerSection = rawMime.substring(0, splitIdx);
  const bodySection = rawMime.substring(splitIdx).replace(/^[\r\n]+/, '');

  // Check Content-Type for multipart
  const ctMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerSection);
  const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : 'text/plain';

  if (contentType.startsWith('multipart/')) {
    // Extract boundary
    const boundaryMatch = /boundary="?([^"\r\n;]+)"?/i.exec(headerSection);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = bodySection.split('--' + boundary);
      // Find text/plain part first, then text/html
      let plainText = '';
      let htmlText = '';
      for (const part of parts) {
        if (part.trim() === '--' || part.trim() === '') continue;
        const partHeaderEnd = part.indexOf('\r\n\r\n') !== -1 ? part.indexOf('\r\n\r\n') : part.indexOf('\n\n');
        if (partHeaderEnd === -1) continue;
        const partHeaders = part.substring(0, partHeaderEnd).toLowerCase();
        const partBody = part.substring(partHeaderEnd).replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
        if (partHeaders.includes('text/plain')) {
          plainText = partBody;
        } else if (partHeaders.includes('text/html')) {
          htmlText = partBody;
        }
      }
      if (plainText) return plainText;
      if (htmlText) {
        // Strip HTML tags for a rough text extraction
        return htmlText.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Simple text/plain or fallback
  return bodySection;
}

// --- Ghost-Router: Stream Classification ---
// Suffix-Boundary Architecture (Vitalik Proof):
//
//   Format                        Stream       KV Provisioning    Verification
//   ──────────────────────────────────────────────────────────────────────────
//   name_@nftmail.box             agent        AUTO (minting)     6551 Brain / Safe (ECIES)
//   name.digits_@nftmail.box      agent        AUTO (minting)     NFT collection + 6551
//   name@nftmail.box              sovereign    ENS RESERVED       Free (treasury gas for first 100k)
//   name.name@nftmail.box         no-coiner    EMAIL/SOCIAL       Privy creates wallet (email/social login)
//   name.digits@nftmail.box       collection   APPROVED NFT       [AssignedCollectionName].[TokenIDdigits]
//
// Upgrade path: name.name → Lite Tier → mint name_name.nftmail.gno → may molt to name_name.vault.gno
//
// The _ suffix IS the boundary. Only _@ addresses get automated KV stores.
// Root addresses (no _) are reserved for sovereign identities — cannot be
// auto-provisioned, only activated via ENS ownership proof or Genome Ownership Proof.
//
// ── ENS × Email Character Intersection ──
// Sovereign [name]@nftmail.box charset = overlap of ENS-valid + RFC 5321 local-part:
//   ENS labels:          [a-z0-9-]  (min 3 chars, no _ allowed)
//   Email local-part:    [a-z0-9!#$%&'*+/=?^_`{|}~.-]
//   Intersection:        [a-z0-9-]  + dot (.) for internal separators
//   Rules:               - no _ (reserved for agents — email allows, ENS does not)
//                         - no consecutive dots, no dot/hyphen at start/end
//                         - min 3 chars (ENS requirement)
//                         - SMTPUTF8 / Unicode: deferred (not supported at launch)
// Not all ENS names will qualify — only those within the intersection charset.
//
// Dot-delimited: name.segment2 where segment2 is ALL digits or ALL letters.
// Mixed digits+letters in segment2 = REJECTED (anti-spoof guardrail).
//
// Agent streams: ECIES encrypt + Zoho delete (except @molt.gno → cleartext glassbox)

type StreamType = 'agent' | 'human' | 'unknown';

// ENS × Email intersection validator
// Valid: [a-z0-9] core, hyphens (-) and dots (.) as internal separators
// Invalid: underscore (_), consecutive dots/hyphens, dot/hyphen at edges, < 3 chars
function isValidSovereignName(name: string): boolean {
  if (name.length < 3) return false;
  if (name.includes('_')) return false;
  // Only [a-z0-9.-] allowed
  if (!/^[a-z0-9.-]+$/.test(name)) return false;
  // No dot or hyphen at start/end
  if (/^[.-]|[.-]$/.test(name)) return false;
  // No consecutive dots or hyphens
  if (/\.\.|-{2}/.test(name)) return false;
  return true;
}

// --- Whitelisted NFT Collections ---
interface WhitelistedCollection {
  assignedName: string;   // e.g. 'chonk'
  chainId: number;        // e.g. 8453 (Base)
  contractAddress: string;
  rpcUrl: string;
  displayName: string;
}

const WHITELISTED_COLLECTIONS: WhitelistedCollection[] = [
  {
    assignedName: 'chonk',
    chainId: 8453,
    contractAddress: '0x07152bfde079b5319e5308C43fB1DCf86F040B84',
    rpcUrl: 'https://mainnet.base.org',
    displayName: 'Chonks',
  },
  // Add more collections here:
  // { assignedName: 'punk', chainId: 1, contractAddress: '0xb47e...', rpcUrl: 'https://eth.llamarpc.com', displayName: 'CryptoPunks' },
];

function getWhitelistedCollection(name: string): WhitelistedCollection | null {
  return WHITELISTED_COLLECTIONS.find(c => c.assignedName === name.toLowerCase()) || null;
}

// --- Multichain ownerOf Verification ---
async function verifyNFTOwner(collection: WhitelistedCollection, tokenId: string): Promise<string | null> {
  try {
    // ERC-721 ownerOf(uint256) → address
    const tokenIdBigInt = BigInt(tokenId);
    const tokenIdHex = tokenIdBigInt.toString(16).padStart(64, '0');
    const calldata = '0x6352211e' + tokenIdHex; // ownerOf(uint256)

    const res = await fetch(collection.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: collection.contractAddress, data: calldata }, 'latest'],
      }),
    });
    const data = await res.json() as { result?: string; error?: any };
    if (data.error || !data.result || data.result === '0x') return null;
    // Extract address from 32-byte padded result
    const ownerHex = '0x' + data.result.slice(26);
    return ownerHex.toLowerCase();
  } catch {
    return null;
  }
}

// --- Recipient Classification ---
interface ClassifiedRecipient {
  stream: StreamType;
  localPart: string;
  agentName: string;
  // Collection-specific fields
  collectionName?: string;
  tokenId?: string;
  collection?: WhitelistedCollection;
  // Social-specific fields
  socialPair?: [string, string]; // [name1, name2]
}

// Dot-delimited regex: name1.segment2 with optional trailing underscore
// segment2 is captured raw — the logic gate checks digits vs letters
const DOT_DELIMITED_RE = /^([a-z]+)\.([a-z0-9]+)(_?)(@(?:surge\.)?nftmail\.box)$/;
const ALL_DIGITS = /^[0-9]+$/;
const ALL_LETTERS = /^[a-z]+$/;

function classifyRecipient(emailAddr: string): ClassifiedRecipient {
  const lower = emailAddr.toLowerCase().trim();

  // 1. Dot-delimited: apply the Digit vs. Letter Logic Gate
  const dotMatch = DOT_DELIMITED_RE.exec(lower);
  if (dotMatch) {
    const [, segment1, segment2, underscore] = dotMatch;
    const isAgent = underscore === '_';

    // LOGIC GATE: Digit vs. Letter partition
    if (ALL_DIGITS.test(segment2)) {
      // ── NFT COLLECTION PATH ── segment2 is all digits = tokenId
      const collection = getWhitelistedCollection(segment1);
      if (collection) {
        return {
          stream: isAgent ? 'agent' : 'human',
          localPart: `${segment1}.${segment2}${underscore}`,
          agentName: `${segment1}.${segment2}`,
          collectionName: segment1,
          tokenId: segment2,
          collection,
        };
      }
      // Digits but not a whitelisted collection — reject to prevent spoofing
      return { stream: 'unknown', localPart: '', agentName: '' };
    }

    if (ALL_LETTERS.test(segment2)) {
      // ── HUMAN IDENTITY PATH ── segment2 is all letters = Privy/wallet/social account
      return {
        stream: isAgent ? 'agent' : 'human',
        localPart: `${segment1}.${segment2}${underscore}`,
        agentName: `${segment1}.${segment2}`,
        socialPair: [segment1, segment2],
      };
    }

    // Mixed digits+letters in segment2 — REJECTED (anti-spoof guardrail)
    return { stream: 'unknown', localPart: '', agentName: '' };
  }

  // 2. Agent: flat name ending with _ before @
  const agentMatch = AGENT_EMAIL_RE.exec(lower);
  if (agentMatch) {
    return { stream: 'agent', localPart: agentMatch[1] + '_', agentName: agentMatch[1] };
  }

  // 3. Human: flat name (sovereign / ENS holder)
  const humanMatch = EMAIL_RE.exec(lower);
  if (humanMatch) {
    const lp = humanMatch[1];
    if (lp.endsWith('_')) {
      return { stream: 'agent', localPart: lp, agentName: lp.slice(0, -1) };
    }
    return { stream: 'human', localPart: lp, agentName: lp };
  }

  return { stream: 'unknown', localPart: '', agentName: '' };
}

// --- Zoho OAuth Token Helper ---
async function getZohoAccessToken(env: Env): Promise<string | null> {
  if (!env.ZOHO_REFRESH_TOKEN || !env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) return null;
  try {
    const res = await fetch('https://accounts.zoho.com.au/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: env.ZOHO_REFRESH_TOKEN,
        client_id: env.ZOHO_CLIENT_ID,
        client_secret: env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json() as Record<string, any>;
    if (data.access_token) return data.access_token;
    console.error(`[zohoAuth] token refresh failed: ${JSON.stringify(data).slice(0, 300)}`);
    return null;
  } catch (err) {
    console.error(`[zohoAuth] error:`, err);
    return null;
  }
}

// --- Zoho Send: forward encrypted blob as email to catch-all ---
async function forwardToCatchAll(
  env: Env,
  accessToken: string,
  originalFrom: string,
  agentName: string,
  encryptedSubject: string,
  encryptedBody: string
): Promise<boolean> {
  if (!env.ZOHO_CATCHALL_ACCOUNT_ID) return false;
  try {
    const res = await fetch(
      `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromAddress: 'ghostagent@nftmail.box',
          toAddress: 'ghostagent@nftmail.box',
          subject: `[BLIND:${agentName}] ${encryptedSubject}`,
          content: encryptedBody,
          mailFormat: 'plaintext',
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// --- Zoho: get inbox folder ID from message metadata (cached per request) ---
let _cachedInboxFolderId: string | null = null;
async function getZohoInboxFolderId(env: Env, accessToken: string): Promise<string | null> {
  if (_cachedInboxFolderId) return _cachedInboxFolderId;
  try {
    // Get folderId from the first message in the account (requires messages.READ, not folders.READ)
    const res = await fetch(
      `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/messages/view?limit=1`,
      { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
    );
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ folderId: string }> };
      if (data.data && data.data.length > 0 && data.data[0].folderId) {
        _cachedInboxFolderId = data.data[0].folderId;
        console.log(`[zohoFolders] inbox folderId=${_cachedInboxFolderId} (from message metadata)`);
        return _cachedInboxFolderId;
      }
    }
    console.error(`[zohoFolders] could not get folderId from messages, status=${res.status}`);
    return null;
  } catch (err) {
    console.error('[zohoFolders] error:', err);
    return null;
  }
}

// --- Zoho Delete: purge cleartext after ECIES encryption ---
async function zohoDeleteMessage(env: Env, accessToken: string, messageId: string, folderId?: string): Promise<boolean> {
  if (!env.ZOHO_CATCHALL_ACCOUNT_ID || !messageId) {
    console.log(`[zohoDelete] skipped: accountId=${!!env.ZOHO_CATCHALL_ACCOUNT_ID}, messageId=${messageId}`);
    return false;
  }
  try {
    // Use provided folderId, or look it up from message metadata
    const folder = folderId || await getZohoInboxFolderId(env, accessToken);
    if (!folder) {
      console.error(`[zohoDelete] cannot delete: inbox folderId not found`);
      return false;
    }
    // Zoho Mail API: DELETE /api/accounts/{accountId}/folders/{folderId}/messages/{messageId}?expunge=true
    const url = `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/folders/${folder}/messages/${messageId}?expunge=true`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
    });
    const body = await res.text();
    console.log(`[zohoDelete] status=${res.status} messageId=${messageId} folderId=${folder} response=${body.slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.error(`[zohoDelete] error:`, err);
    return false;
  }
}

// --- Zoho Fetch: get unread messages for cron polling fallback ---
interface ZohoMessage {
  messageId: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  receivedTime: number;
  folderId?: string;
  summary?: string;
}

async function zohoFetchUnread(env: Env, accessToken: string, limit: number = 20): Promise<ZohoMessage[]> {
  if (!env.ZOHO_CATCHALL_ACCOUNT_ID) return [];
  try {
    const res = await fetch(
      `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/messages/view?folderId=inbox&limit=${limit}&status=unread`,
      {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: ZohoMessage[] };
    return data.data || [];
  } catch {
    return [];
  }
}

// --- Zoho Fetch: get full message content by ID ---
async function zohoGetMessageContent(env: Env, accessToken: string, messageId: string): Promise<string> {
  if (!env.ZOHO_CATCHALL_ACCOUNT_ID || !messageId) return '';
  try {
    const res = await fetch(
      `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/messages/${messageId}/content`,
      {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
      }
    );
    if (!res.ok) return '';
    const data = await res.json() as { data?: { content?: string } };
    return data.data?.content || '';
  } catch {
    return '';
  }
}

// --- Blind Index Helper ---
async function updateBlindIndex(env: Env, agentName: string, blindId: string): Promise<void> {
  const blindIndexKey = `blind-index:${agentName}`;
  let blindIndex: string[] = [];
  try {
    const raw = await env.INBOX_KV.get(blindIndexKey);
    if (raw) blindIndex = JSON.parse(raw);
  } catch {}
  blindIndex.push(blindId);
  if (blindIndex.length > 50) blindIndex = blindIndex.slice(-50);
  await env.INBOX_KV.put(blindIndexKey, JSON.stringify(blindIndex), {
    expirationTtl: 8 * 24 * 60 * 60,
  });
}

// ── ENS subname existence check on Gnosis ──────────────────────────────────
// Checks if `label.nftmail.gno` is owned (non-zero) on the Gnosis ENS registry.
// Namehashes precomputed offline via viem namehash() — deterministic, no runtime keccak needed.
const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const ENS_REGISTRY_GNOSIS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

// Precomputed ENS namehashes for known nftmail.gno subnames.
// Add new entries here as new no-coiner names are minted.
const NFTMAIL_GNO_NODES: Record<string, string> = {
  'fresh.boy':      '0x09c313a0462d7ae383d69575a0142de766d5bea538d1ae931a09673f90391ac03',
  'richard.angelo': '0x02d71b59081fd29f66fbf96de8228cfc88bc2d732112f4a75e48949f804952ab',
};

async function gnosisSubnameExists(label: string): Promise<string | null> {
  const node = NFTMAIL_GNO_NODES[label];
  if (!node) return null; // Unknown label — not in precomputed table
  try {
    // ENS registry owner(bytes32 node) selector = 0x02571be3
    const data = '0x02571be3' + node.slice(2).padStart(64, '0');
    const resp = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ENS_REGISTRY_GNOSIS, data }, 'latest'] }),
    });
    const json: any = await resp.json();
    const result: string = json.result || '0x';
    const isOwned = result !== '0x' && result !== '0x' + '0'.repeat(64);
    if (!isOwned) return null;
    // Return the owner address (last 20 bytes of padded result)
    return '0x' + result.slice(-40);
  } catch {
    return null;
  }
}

// Open Agency: TLD-based privacy classification
// molt.gno = Glass Box (public audit log, no encryption)
// agent.gno, openclaw.gno, picoclaw.gno, vault.gno, nftmail.gno = Black Box (private, encrypted, sovereign)
const PUBLIC_TLDS = ['molt.gno'];
const PRIVATE_TLDS = ['agent.gno', 'openclaw.gno', 'picoclaw.gno', 'vault.gno', 'nftmail.gno'];

async function isPublicAgent(agentName: string, env: Env, parentTld?: string): Promise<boolean> {
  if (parentTld) return PUBLIC_TLDS.some(t => parentTld.endsWith(t));
  // KV registry: tld:{agentName} → 'molt.gno' | 'vault.gno' | etc.
  const tld = await env.INBOX_KV.get(`tld:${agentName}`);
  if (tld) return PUBLIC_TLDS.includes(tld);
  // Fallback: suffix convention for legacy agents
  return agentName.endsWith('_molt');
}

async function getAgentTld(agentName: string, env: Env, parentTld?: string): Promise<string> {
  if (parentTld) return parentTld;
  // KV registry first
  const tld = await env.INBOX_KV.get(`tld:${agentName}`);
  if (tld) return tld;
  // Fallback: suffix convention
  if (agentName.endsWith('_molt')) return 'molt.gno';
  if (agentName.endsWith('_vault')) return 'vault.gno';
  return 'nftmail.gno';
}

interface AuditEntry {
  id: string;
  from: string;
  to: string;
  subject: string;
  content: string;
  timestamp: number;
  contentHash: string;
  verified: boolean;
  redacted?: boolean;
  redactionReason?: string;
}

// Sensitive Redaction: edge-detect OTP/auth signals for Glass Box agents
// "Transparency of Action, Privacy of Secret"
const SENSITIVE_SENDERS = [
  'no-reply@', 'noreply@', 'security@', 'auth@', 'verify@', 'account@',
  'coinbase.com', 'binance.com', 'kraken.com', 'gemini.com', 'stripe.com',
  'paypal.com', 'revolut.com', 'wise.com', 'metamask.io', 'ledger.com',
  'fireblocks.com', 'gnosis-safe.io', 'safe.global',
];

const SENSITIVE_KEYWORDS = [
  'otp', 'one-time password', 'one-time code', 'verification code',
  'verify your', 'confirm your', 'security code', 'authentication code',
  '2fa', 'two-factor', 'login code', 'sign-in code', 'access code',
  'reset your password', 'password reset', 'confirm transaction',
  'approve this', 'authorize this', 'withdrawal confirmation',
];

const OTP_PATTERN = /\b\d{4,8}\b/;

function isSensitiveContent(from: string, subject: string, content: string): { sensitive: boolean; reason: string } {
  const fromLower = from.toLowerCase();
  const subjectLower = subject.toLowerCase();
  const contentLower = content.toLowerCase();

  // Check sender
  for (const s of SENSITIVE_SENDERS) {
    if (fromLower.includes(s)) {
      return { sensitive: true, reason: `Auth sender detected: ${s}` };
    }
  }

  // Check subject for keywords
  for (const kw of SENSITIVE_KEYWORDS) {
    if (subjectLower.includes(kw)) {
      return { sensitive: true, reason: `Auth keyword in subject: "${kw}"` };
    }
  }

  // Check content for keywords + OTP pattern
  for (const kw of SENSITIVE_KEYWORDS) {
    if (contentLower.includes(kw)) {
      return { sensitive: true, reason: `Auth keyword in body: "${kw}"` };
    }
  }

  // Check for standalone numeric codes (likely OTP)
  if (OTP_PATTERN.test(content) && (subjectLower.includes('code') || subjectLower.includes('verify') || contentLower.includes('code') || contentLower.includes('enter'))) {
    return { sensitive: true, reason: 'Numeric code pattern detected with auth context' };
  }

  return { sensitive: false, reason: '' };
}

const REDACTED_BODY = '[AUTHENTICATION SIGNAL RECEIVED - REDACTED FOR SECURITY]\n\nThis message contained sensitive authentication data (OTP, verification code, or security token).\nThe cleartext has been routed to the agent\'s private Stealth layer.\nThe SHA-256 content hash below proves the original message integrity.';
const REDACTED_SUBJECT_PREFIX = '[REDACTED] ';

interface MoltTransition {
  agent: string;
  fromTld: string;
  toTld: string;
  block: number;
  timestamp: number;
  status: string;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function corsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin') || '*';
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
}

function corsify(response: Response, request: Request): Response {
  const headers = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  headers.forEach((v, k) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext) {
    const storage = new MailStorageAdapter({
      backend: env.BACKEND,
      surgeToken: env.SURGE_TOKEN,
      ghostRegistry: env.GHOST_REGISTRY,
      inboxKV: env.INBOX_KV,
      calendarKV: env.GHOST_CALENDAR
    });

    // --- Parse the inbound email ---
    // Zoho routes *@nftmail.box → *@surge.nftmail.box → Cloudflare Email Routing → here
    const originalRecipient = resolveOriginalRecipient(message);
    const sender = message.from;
    const subject = message.headers.get('subject') || '';
    const rawMime = await new Response(message.raw).text();
    const body = extractBodyFromMime(rawMime);
    const timestamp = Date.now();

    // ── EDGE ENCRYPT: seal cleartext immediately — hash before any log or KV write ──
    const sealed = await sealCleartext({ from: sender, to: originalRecipient, subject, body, timestamp });

    // --- Classify recipient using the quad-stream logic gate ---
    const classified = classifyRecipient(originalRecipient);
    const { stream, localPart, agentName, collectionName, tokenId, collection } = classified;

    if (stream === 'unknown' || !localPart) {
      // Reject unroutable addresses
      message.setReject('Invalid recipient — namespace rejected by logic gate');
      return;
    }

    // --- HUMAN STREAM: cleartext KV storage ---
    // Covers: name@ (ENS), name.name@ (Privy/wallet), name.digits@ (NFT collection)
    if (stream === 'human') {
      // NFT collection sub-type: verify ownership
      let ownerAddress: string | null = null;
      if (collection && tokenId) {
        ownerAddress = await verifyNFTOwner(collection, tokenId);
        if (!ownerAddress) {
          await storage.storeEmail(localPart, {
            from: sender, to: originalRecipient, subject,
            content: `[UNVERIFIED] Token #${tokenId} not found in ${collection.displayName}. ${body}`,
            timestamp,
          });
          return;
        }
      }

      const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const plaintextPayload = JSON.stringify({
        from: sender, to: originalRecipient, subject, body, timestamp,
        ...(collection ? { collection: { name: collectionName, tokenId, chain: collection.chainId, owner: ownerAddress } } : {}),
        ...(classified.socialPair ? { identity: { pair: classified.socialPair } } : {}),
      });
      const plaintextHash = sealed.contentHash;

      const envelope = {
        type: 'human-cleartext', encrypted: false,
        payload: JSON.parse(plaintextPayload), plaintextHash,
        edgeEncrypt: buildAuditHashEntry(sealed, agentName, timestamp),
        recipient: agentName,
        ...(ownerAddress ? { owner: ownerAddress } : {}),
        ...(collection ? { collection: collection.displayName, tokenId } : {}),
        receivedAt: timestamp,
      };
      await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
      await updateBlindIndex(env, agentName, blindId);
      await storage.storeEmail(localPart, { from: sender, to: originalRecipient, subject, content: body, timestamp });
      // Note: Zoho deletion is handled via Deluge→HTTP path, not email routing
      return;
    }

    // --- AGENT STREAM ---
    if (stream === 'agent') {
      // --- Alias resolution: CHONK_123_ → paymastr ---
      // If this local-part is an alias, transparently redirect to the primary agent's inbox.
      const aliasResolved = await resolveAlias(env.INBOX_KV, localPart);
      const resolvedAgentName = aliasResolved ?? agentName;

      const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${resolvedAgentName}`);
      const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const plaintextPayload = sealed._plaintext;
      const plaintextHash = sealed.contentHash;

      if (!pubKeyHex) {
        // No ECIES key registered — store a redacted notice only, never cleartext payload
        const envelope = {
          type: 'cleartext-warning', encrypted: false,
          warning: 'No ECIES public key registered for this agent. Message body withheld.',
          plaintextHash, edgeEncrypt: buildAuditHashEntry(sealed, localPart, timestamp),
          recipient: localPart, receivedAt: timestamp,
        };
        await env.INBOX_KV.put(`blind:${resolvedAgentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
        await updateBlindIndex(env, resolvedAgentName, blindId);
        return;
      }

      const encEnvelope = await eciesEncrypt(plaintextPayload, pubKeyHex);
      let recoveryEnvelope: EncryptedEnvelope | null = null;
      if (env.MASTER_SAFE_PUBKEY) {
        try { recoveryEnvelope = await eciesEncrypt(plaintextPayload, env.MASTER_SAFE_PUBKEY); } catch {}
      }
      // Plaintext has been encrypted — release the reference
      const sealedSafe = releasePlaintext(sealed);
      const blindEnvelope = {
        type: 'ecies-blind', encrypted: true,
        envelope: encEnvelope, recoveryEnvelope: recoveryEnvelope || undefined,
        plaintextHash, recipient: localPart, receivedAt: timestamp,
        edgeEncrypt: buildAuditHashEntry(sealedSafe as any, localPart, timestamp),
      };
      await env.INBOX_KV.put(`blind:${resolvedAgentName}:${blindId}`, JSON.stringify(blindEnvelope), { expirationTtl: 8 * 24 * 60 * 60 });
      await updateBlindIndex(env, resolvedAgentName, blindId);

      // Glass Box audit for molt.gno agents
      if (await isPublicAgent(localPart, env)) {
        const sensitivity = isSensitiveContent(sender, subject, body);
        const entry: AuditEntry = {
          id: blindId, from: sender, to: originalRecipient,
          subject: sensitivity.sensitive ? REDACTED_SUBJECT_PREFIX + 'Authentication Signal' : subject,
          content: sensitivity.sensitive ? REDACTED_BODY : '[ECIES ENCRYPTED — Blind Storage]',
          timestamp, contentHash: plaintextHash, verified: true,
          edgeEncrypt: buildAuditHashEntry(sealedSafe as any, localPart, timestamp),
          redacted: sensitivity.sensitive, redactionReason: sensitivity.sensitive ? sensitivity.reason : undefined,
        };
        const auditRaw = await env.INBOX_KV.get(`audit:${localPart}`);
        const auditLog: AuditEntry[] = auditRaw ? JSON.parse(auditRaw) : [];
        auditLog.push(entry);
        await env.INBOX_KV.put(`audit:${localPart}`, JSON.stringify(auditLog));
      }
      return;
    }

    // --- HUMAN STREAM (fallback) ---
    // Standard TLS delivery — store in KV, no ECIES needed
    await storage.storeEmail(localPart, {
      from: sender,
      to: originalRecipient,
      subject,
      content: body,
      timestamp,
    });
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    try {
      const storage = new MailStorageAdapter({
        backend: env.BACKEND,
        surgeToken: env.SURGE_TOKEN,
        ghostRegistry: env.GHOST_REGISTRY,
        inboxKV: env.INBOX_KV,
        calendarKV: env.GHOST_CALENDAR
      });

      if (request.method === 'POST') {
        // Extract zohoMessageId from raw body BEFORE JSON.parse to preserve 19-digit precision
        const rawBody = await request.text();
        let _rawZohoMessageId = '';
        const msgIdMatch = rawBody.match(/"zohoMessageId"\s*:\s*"?(\d+)"?/);
        if (msgIdMatch) _rawZohoMessageId = msgIdMatch[1];

        const email = JSON.parse(rawBody) as HttpEmailPayload;
        let result: Response;

        if (email.action === 'getInbox') {
          const rawAgent = email.localPart || email.email?.split('@')[0] || '';
          if (!rawAgent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          // Normalize: strip trailing _ since KV stores under identity name (no underscore)
          const agent = rawAgent.endsWith('_') ? rawAgent.slice(0, -1) : rawAgent;
          result = await storage.getInbox(agent);
          return corsify(result, request);
        }

        // UI Integration: Get agent status (inbox + calendar + heartbeat)
        if (email.action === 'getAgentStatus') {
          const agent = email.localPart || email.email?.split('@')[0] || '';
          if (!agent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          result = await storage.getAgentStatus(agent);
          // Augment with ERC-8004 agentId if registered
          try {
            const erc8004Key = agent.replace(/_+$/, ''); // strip trailing underscore
            const erc8004Raw = await env.INBOX_KV.get(`erc8004:${erc8004Key}`);
            if (erc8004Raw) {
              const statusJson = await result.clone().json() as Record<string, unknown>;
              const erc8004 = JSON.parse(erc8004Raw);
              return corsify(Response.json({ ...statusJson, erc8004AgentId: erc8004.agentId, agentURI: erc8004.agentURI }), request);
            }
          } catch {}
          return corsify(result, request);
        }

        // Ghost-Calendar actions
        if (email.action === 'getCalendar') {
          const agent = email.localPart || email.email?.split('@')[0] || '';
          if (!agent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          result = await storage.getAgentCalendar(agent);
          return corsify(result, request);
        }

        if (email.action === 'scheduleEvent') {
          const invite = email as any as { invite: CalendarInvite };
          if (!invite?.invite?.event || !invite?.invite?.from || !invite?.invite?.to) {
            return corsify(Response.json({ error: 'Missing invite data' }, { status: 400 }), request);
          }
          result = await storage.scheduleEvent(invite.invite);
          return corsify(result, request);
        }

        // A2A Ghost-Wire: agent-to-agent direct messaging (zero SMTP cost)
        if (email.action === 'sendA2A') {
          const fromAgent = (email as any).fromAgent || '';
          const toAgent = (email as any).toAgent || '';
          if (!fromAgent || !toAgent) {
            return corsify(Response.json({ error: 'Missing fromAgent or toAgent' }, { status: 400 }), request);
          }
          result = await storage.sendA2A(fromAgent, toAgent, email.subject || '', email.content || '');
          return corsify(result, request);
        }

        // Zero-Knowledge Metadata: Waku gossip topic routing
        if (email.action === 'wakuRoute') {
          const fromAgent = (email as any).fromAgent || '';
          const toAgent = (email as any).toAgent || '';
          if (!fromAgent || !toAgent) {
            return corsify(Response.json({ error: 'Missing fromAgent or toAgent' }, { status: 400 }), request);
          }
          const topic = buildDirectMessageTopic(fromAgent, toAgent);
          const envelope = createWakuEnvelope(fromAgent, toAgent, email.content || '', true);
          // Store in KV as well for offline retrieval
          await storage.sendA2A(fromAgent, toAgent, email.subject || '', email.content || '');
          return corsify(Response.json({ topic, envelope, stored: true }), request);
        }

        // Privacy Toggle: set privacy tier for an address
        // tier: 'exposed' (default free), 'private' (toggle, blurred inbox), 'hard-privacy' (paid, no public content)
        // molt.gno private = $0.20/email (flagged in record, billed downstream)
        if (email.action === 'setPrivacy') {
          const agent = email.localPart || '';
          const tld: string = (email as any).tld || await getAgentTld(agent, env);
          const rawTier = (email as any).tier as string | undefined;
          const privacyEnabled = (email as any).privacyEnabled;
          const walletAddress: string | undefined = (email as any).walletAddress;
          const moltPrivatePaid: boolean = !!(email as any).moltPrivatePaid;
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          // Support both old boolean format and new tier format
          const resolvedTier = rawTier || (privacyEnabled === true ? 'private' : privacyEnabled === false ? 'exposed' : null);
          const validationError = validateSetPrivacy(resolvedTier ?? undefined, tld);
          if (validationError) {
            return corsify(Response.json({ error: validationError }, { status: 400 }), request);
          }
          const { kvKey, record, result } = routeSetPrivacy(
            agent,
            tld,
            resolvedTier as PrivacyTierType,
            walletAddress,
            moltPrivatePaid,
          );
          await env.INBOX_KV.put(kvKey, JSON.stringify(record));
          return corsify(Response.json(result), request);
        }

        // Privacy Toggle: get privacy state for an address
        if (email.action === 'getPrivacy') {
          const agent = email.localPart || '';
          const tld: string = (email as any).tld || await getAgentTld(agent, env);
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`privacy:${agent}`);
          const record = parsePrivacyRecord(raw, tld);
          const moltCharge = getMoltPrivateCharge(record);
          return corsify(Response.json({
            tier: record.tier,
            privacyEnabled: record.enabled,
            tld: record.tld,
            moltPrivateCharge: moltCharge,
            updatedAt: record.updatedAt,
          }), request);
        }

        // $HOST Staking: get current stake record for an agent
        if (email.action === 'getStake') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`stake:${agent}`);
          if (!raw) {
            return corsify(Response.json({
              stakedHost: 0, activeTier: 'none', unlockedSend: false,
              persistenceDays: null, expiresAt: null, moltPrivateBalance: 0,
            }), request);
          }
          try {
            return corsify(Response.json(JSON.parse(raw)), request);
          } catch {
            return corsify(Response.json({ stakedHost: 0, activeTier: 'none', unlockedSend: false }), request);
          }
        }

        // $HOST Staking: set/update stake record for an agent
        if (email.action === 'setStake') {
          const agent = email.localPart || '';
          const stakeRecord = (email as any).stakeRecord;
          if (!agent || !stakeRecord) {
            return corsify(Response.json({ error: 'Missing localPart or stakeRecord' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`stake:${agent}`, JSON.stringify(stakeRecord));
          // Mirror send-unlock into acct-tier for retention logic
          if (stakeRecord.unlockedSend) {
            const tierRaw = await env.INBOX_KV.get(`acct-tier:${agent}`);
            let tierData: any = {};
            try { tierData = tierRaw ? JSON.parse(tierRaw) : {}; } catch {}
            if (!tierData.tier || tierData.tier === 'basic') {
              tierData.tier = 'lite';
              tierData.stakedUnlock = true;
              tierData.updatedAt = Date.now();
              await env.INBOX_KV.put(`acct-tier:${agent}`, JSON.stringify(tierData));
            }
          }
          return corsify(Response.json({ status: 'ok', agent, stakedHost: stakeRecord.stakedHost }), request);
        }

        // Evolve Level: get raw acct-tier KV record for level scanning
        if (email.action === 'getAcctTier') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`acct-tier:${agent}`);
          if (!raw) {
            return corsify(Response.json({ tier: 'basic', raw: null }), request);
          }
          try {
            const parsed = JSON.parse(raw);
            return corsify(Response.json({ ...parsed, raw }), request);
          } catch {
            return corsify(Response.json({ tier: 'basic', raw }), request);
          }
        }

        // Open Agency: resolve agent TLD and public status
        if (email.action === 'getAgentTLD') {
          const agent = email.localPart || '';
          const parentTld = (email as any).parentTld || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const tld = await getAgentTld(agent, env, parentTld);
          const isPublic = await isPublicAgent(agent, env, parentTld);
          return corsify(Response.json({ agent, tld, isPublic, classification: isPublic ? 'Glass Box' : 'Black Box' }), request);
        }

        // Open Agency: get public audit log for a molt.gno agent
        if (email.action === 'getPublicAuditLog') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`audit:${agent}`);
          const entries: AuditEntry[] = raw ? JSON.parse(raw) : [];
          // Also get molt transitions
          const transRaw = await env.INBOX_KV.get(`molt-log:${agent}`);
          const transitions: MoltTransition[] = transRaw ? JSON.parse(transRaw) : [];
          return corsify(Response.json({ agent, isPublic: await isPublicAgent(agent, env), entries, transitions }), request);
        }

        // XMTP Toggle: get current XMTP enabled state
        if (email.action === 'getXMTPStatus') {
          const agent = (email as any).agentName || '';
          const tld   = (email as any).tld || '';
          if (!agent) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`xmtp:${agent}:${tld}`);
          const record = raw ? JSON.parse(raw) as { enabled: boolean } : null;
          if (!record) return corsify(Response.json({ exists: false, enabled: tld === 'agent.gno' }), request);
          return corsify(Response.json({ enabled: record.enabled }), request);
        }

        // XMTP Toggle: set XMTP enabled state (owner-only by convention — no on-chain auth in worker)
        if (email.action === 'setXMTPStatus') {
          const agent  = ((email as any).agentName || '').toLowerCase();
          const tld    = (email as any).tld || '';
          const enable = (email as any).enabled === true;
          const owner  = ((email as any).ownerAddress || '').toLowerCase();
          const note   = (email as any).auditNote || '';
          if (!agent || !tld || !owner) return corsify(Response.json({ error: 'Missing agentName, tld, or ownerAddress' }, { status: 400 }), request);
          if (tld === 'picoclaw.gno') return corsify(Response.json({ error: 'PICOCLAW: upgrade to PUPA first' }, { status: 403 }), request);
          await env.INBOX_KV.put(`xmtp:${agent}:${tld}`, JSON.stringify({ enabled: enable, updatedAt: Date.now(), owner, note }));
          return corsify(Response.json({ status: 'ok', enabled: enable }), request);
        }

        // Glass Box: get tiered audit log entries
        if (email.action === 'getGlassBoxLog') {
          const agent = (email as any).agentName || '';
          const tld   = (email as any).tld || '';
          if (!agent) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`glassbox:${agent}:${tld}`);
          const entries = raw ? JSON.parse(raw) : [];
          return corsify(Response.json({ entries }), request);
        }

        // Glass Box: append a new tiered entry
        if (email.action === 'appendGlassBoxEntry') {
          const agent = ((email as any).agentName || '').toLowerCase();
          const tld   = (email as any).tld || '';
          const entry = (email as any).entry;
          if (!agent || !tld || !entry) return corsify(Response.json({ error: 'Missing agentName, tld, or entry' }, { status: 400 }), request);
          const key = `glassbox:${agent}:${tld}`;
          const raw = await env.INBOX_KV.get(key);
          const entries: unknown[] = raw ? JSON.parse(raw) : [];
          entries.push(entry);
          // Keep last 500 entries
          if (entries.length > 500) entries.splice(0, entries.length - 500);
          await env.INBOX_KV.put(key, JSON.stringify(entries));
          return corsify(Response.json({ status: 'ok', count: entries.length }), request);
        }

        // Glass Box: set enhanced logging preference
        if (email.action === 'setEnhancedLogging') {
          const agent    = ((email as any).agentName || '').toLowerCase();
          const tld      = (email as any).tld || '';
          const enhanced = (email as any).enhancedLogging === true;
          const owner    = ((email as any).ownerAddress || '').toLowerCase();
          if (!agent || !tld || !owner) return corsify(Response.json({ error: 'Missing agentName, tld, or ownerAddress' }, { status: 400 }), request);
          await env.INBOX_KV.put(`glassbox-enhanced:${agent}:${tld}`, JSON.stringify({ enhanced, owner, updatedAt: Date.now() }));
          return corsify(Response.json({ status: 'ok', enhancedLogging: enhanced }), request);
        }

        // Swarm Container: get swarm config for a vault.gno
        if (email.action === 'getSwarmConfig') {
          const vaultName = ((email as any).vaultName || '').toLowerCase();
          if (!vaultName) return corsify(Response.json({ error: 'Missing vaultName' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`swarm:${vaultName}`);
          if (!raw) return corsify(Response.json({ error: 'Swarm config not found' }, { status: 404 }), request);
          return corsify(Response.json({ config: JSON.parse(raw) }), request);
        }

        // Generic KV get (owner-accessible — used by swarm API route)
        if (email.action === 'kvGet') {
          const key = (email as any).key || '';
          if (!key) return corsify(Response.json({ error: 'Missing key' }, { status: 400 }), request);
          const value = await env.INBOX_KV.get(key);
          return corsify(Response.json({ key, value }), request);
        }

        // Generic KV put (owner-accessible — used by swarm API route)
        if (email.action === 'kvPut') {
          const key   = (email as any).key || '';
          const value = (email as any).value ?? '';
          const owner = ((email as any).ownerAddress || '').toLowerCase();
          if (!key || !owner) return corsify(Response.json({ error: 'Missing key or ownerAddress' }, { status: 400 }), request);
          await env.INBOX_KV.put(key, typeof value === 'string' ? value : JSON.stringify(value));
          return corsify(Response.json({ status: 'ok', key }), request);
        }

        // Swarm Coordinator: dispatch sub-actions (register-agent, remove-agent, assign-task, complete-task)
        if (email.action === 'coordinatorAction') {
          const vaultName  = ((email as any).vaultName  || '').toLowerCase();
          const subAction  = (email as any).subAction   || '';
          const ownerAddr  = ((email as any).ownerAddress || '').toLowerCase();
          if (!vaultName || !ownerAddr) return corsify(Response.json({ error: 'Missing vaultName or ownerAddress' }, { status: 400 }), request);

          const stateKey = `coordinator:${vaultName}`;
          const rawState = await env.INBOX_KV.get(stateKey);
          const state: { vaultName: string; inboxEmail: string; agents: unknown[]; tasks: unknown[] } = rawState
            ? JSON.parse(rawState)
            : { vaultName, inboxEmail: `swarm.${vaultName}_@nftmail.box`, agents: [], tasks: [] };

          if (subAction === 'register-agent') {
            const agentName = (email as any).agentName || '';
            const moduleAddress = (email as any).moduleAddress || '';
            if (!agentName || !moduleAddress) return corsify(Response.json({ error: 'Missing agentName or moduleAddress' }, { status: 400 }), request);
            const exists = (state.agents as any[]).find((a: any) => a.agentName === agentName);
            if (!exists) {
              (state.agents as any[]).push({ agentName, moduleAddress, active: true, activeTasks: 0, completedTasks: 0, addedAt: Date.now() });
            }
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ status: 'ok', state }), request);
          }

          if (subAction === 'remove-agent') {
            const agentName = (email as any).agentName || '';
            (state.agents as any[]).forEach((a: any) => { if (a.agentName === agentName) a.active = false; });
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ status: 'ok', state }), request);
          }

          if (subAction === 'assign-task') {
            const topic = (email as any).topic || '';
            const payloadHash = (email as any).payloadHash || '';
            const activeAgents = (state.agents as any[]).filter((a: any) => a.active && (a.activeTasks ?? 0) < 5);
            if (activeAgents.length === 0) return corsify(Response.json({ error: 'No available agents' }, { status: 503 }), request);
            const rrKey = `coordinator-rr:${vaultName}`;
            const rrRaw = await env.INBOX_KV.get(rrKey);
            let rrIdx = rrRaw ? parseInt(rrRaw) : 0;
            const assigned = activeAgents[rrIdx % activeAgents.length];
            rrIdx = (rrIdx + 1) % activeAgents.length;
            await env.INBOX_KV.put(rrKey, String(rrIdx));
            const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            (state.tasks as any[]).push({ taskId, assignedAgent: assigned.agentName, topic, payloadHash, assignedAt: Date.now(), completed: false, completedAt: 0 });
            assigned.activeTasks = (assigned.activeTasks ?? 0) + 1;
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ status: 'ok', taskId, assignedAgent: assigned.agentName }), request);
          }

          if (subAction === 'complete-task') {
            const taskId = (email as any).taskId || '';
            const task = (state.tasks as any[]).find((t: any) => t.taskId === taskId);
            if (!task) return corsify(Response.json({ error: 'Task not found' }, { status: 404 }), request);
            task.completed = true;
            task.completedAt = Date.now();
            const agent = (state.agents as any[]).find((a: any) => a.agentName === task.assignedAgent);
            if (agent) { if (agent.activeTasks > 0) agent.activeTasks--; agent.completedTasks = (agent.completedTasks ?? 0) + 1; }
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ status: 'ok', task }), request);
          }

          return corsify(Response.json({ status: 'ok', state }), request);
        }

        // Swarm Coordinator: get full coordinator state
        if (email.action === 'getCoordinatorState') {
          const vaultName = ((email as any).vaultName || '').toLowerCase();
          if (!vaultName) return corsify(Response.json({ error: 'Missing vaultName' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`coordinator:${vaultName}`);
          if (!raw) return corsify(Response.json({ exists: false, vaultName }, { status: 404 }), request);
          return corsify(Response.json({ exists: true, ...JSON.parse(raw) }), request);
        }

        // Vault Evolution: get evolution record for a client name
        if (email.action === 'getVaultEvolution') {
          const clientName = ((email as any).clientName || '').toLowerCase();
          if (!clientName) return corsify(Response.json({ error: 'Missing clientName' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`vault-evo:${clientName}`);
          if (!raw) return corsify(Response.json({ error: 'Evolution record not found' }, { status: 404 }), request);
          return corsify(Response.json({ evolution: JSON.parse(raw) }), request);
        }

        // ERC-8004: store agentId after on-chain Identity Registry registration
        if (email.action === 'setErc8004AgentId') {
          const agentName      = ((email as any).agentName || '').toLowerCase().trim();
          const erc8004AgentId = (email as any).erc8004AgentId;
          const agentURI       = (email as any).agentURI || '';
          if (!agentName || typeof erc8004AgentId !== 'number') {
            return corsify(Response.json({ error: 'Missing agentName or erc8004AgentId' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`erc8004:${agentName}`, JSON.stringify({ agentId: erc8004AgentId, agentURI, registeredAt: Date.now() }));
          return corsify(Response.json({ status: 'stored', agentName, erc8004AgentId }), request);
        }

        // ERC-8004 TradeIntent: store EIP-712 signed trade intent for A2A discovery
        if (email.action === 'storeTradeIntent') {
          const agentName    = ((email as any).agentName || '').toLowerCase().trim();
          const agentId      = (email as any).agentId;
          const signedIntent = (email as any).signedIntent;
          if (!agentName || !signedIntent) {
            return corsify(Response.json({ error: 'Missing agentName or signedIntent' }, { status: 400 }), request);
          }
          const intentKey = `trade-intent:${agentName}:${Date.now()}`;
          await env.INBOX_KV.put(intentKey, JSON.stringify(signedIntent), { expirationTtl: 7 * 24 * 60 * 60 });
          // Update index
          const idxRaw = await env.INBOX_KV.get(`trade-intent-index:${agentName}`);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          idx.push(intentKey);
          await env.INBOX_KV.put(`trade-intent-index:${agentName}`, JSON.stringify(idx.slice(-50)));
          return corsify(Response.json({ status: 'stored', agentName, agentId, intentKey }), request);
        }

        // ERC-8004 TradeIntents: list active trade intents for an agent (A2A discovery)
        if (email.action === 'getTradeIntents') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const idxRaw = await env.INBOX_KV.get(`trade-intent-index:${agentName}`);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          const intents = (await Promise.all(
            idx.map(k => env.INBOX_KV.get(k).then(v => v ? JSON.parse(v) : null))
          )).filter(Boolean);
          return corsify(Response.json({ agentName, intents }), request);
        }

        // Warrant Canary: return last-alive timestamp from KV (written by cron every 5 min)
        if (email.action === 'getCanary') {
          const ts = await env.INBOX_KV.get('canary:alive');
          if (!ts) return corsify(Response.json({ alive: false, lastAlive: null }), request);
          const ageMs = Date.now() - Number(ts);
          const alive = ageMs < 48 * 60 * 60 * 1000;
          return corsify(Response.json({ alive, lastAlive: Number(ts), ageMs }), request);
        }

        // EIP-712 HandshakeCertificate: store bilateral P2P mutual-auth proof
        if (email.action === 'storeHandshakeCertificate') {
          const agentName     = ((email as any).agentName     || '').toLowerCase().trim();
          const responderName = ((email as any).responderName || '').toLowerCase().trim();
          const signedCert    = (email as any).signedCert;
          if (!agentName || !signedCert?.certificateHash) {
            return corsify(Response.json({ error: 'Missing agentName or signedCert.certificateHash' }, { status: 400 }), request);
          }
          const key = `handshake:${agentName}:${signedCert.certificateHash.slice(0, 16)}`;
          await env.INBOX_KV.put(key, JSON.stringify(signedCert), { expirationTtl: 30 * 24 * 60 * 60 });
          // Update index for initiator
          const idxKey = `handshake-index:${agentName}`;
          const idxRaw = await env.INBOX_KV.get(idxKey);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          if (!idx.includes(key)) { idx.unshift(key); if (idx.length > 50) idx.splice(50); }
          await env.INBOX_KV.put(idxKey, JSON.stringify(idx));
          // Also index for responder if provided
          if (responderName) {
            const rIdxKey = `handshake-index:${responderName}`;
            const rIdxRaw = await env.INBOX_KV.get(rIdxKey);
            const rIdx: string[] = rIdxRaw ? JSON.parse(rIdxRaw) : [];
            if (!rIdx.includes(key)) { rIdx.unshift(key); if (rIdx.length > 50) rIdx.splice(50); }
            await env.INBOX_KV.put(rIdxKey, JSON.stringify(rIdx));
          }
          return corsify(Response.json({ ok: true, key, certificateHash: signedCert.certificateHash }), request);
        }

        // EIP-712 HandshakeCertificates: list certificates for an agent
        if (email.action === 'getHandshakeCertificates') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const idxRaw = await env.INBOX_KV.get(`handshake-index:${agentName}`);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          const certs = (await Promise.all(
            idx.map(k => env.INBOX_KV.get(k).then(v => v ? JSON.parse(v) : null))
          )).filter(Boolean);
          return corsify(Response.json({ agentName, certs }), request);
        }

        // x402 A2A delivery: store a paid inter-agent message in recipient's blind inbox
        if (email.action === 'storeA2AMessage') {
          const fromAgent  = ((email as any).fromAgent  || '').toLowerCase().trim();
          const toAgent    = ((email as any).toAgent    || '').toLowerCase().trim();
          const subject    = (email as any).subject    || '';
          const body       = (email as any).body       || '';
          const agentId    = (email as any).agentId    ?? null;
          const timestamp  = (email as any).timestamp  || Date.now();
          if (!fromAgent || !toAgent || !subject || !body) {
            return corsify(Response.json({ error: 'Missing fromAgent, toAgent, subject or body' }, { status: 400 }), request);
          }
          const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
          const envelope = {
            type: 'a2a-x402', encrypted: false,
            from: `${fromAgent}@nftmail.box`, to: `${toAgent}@nftmail.box`,
            subject, body, timestamp, via: 'x402',
            ...(agentId !== null ? { agentId } : {}),
          };
          await env.INBOX_KV.put(`blind:${toAgent}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 30 * 24 * 60 * 60 });
          // update blind index
          const idxKey = `blind-index:${toAgent}`;
          const idxRaw = await env.INBOX_KV.get(idxKey);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          idx.push(blindId);
          await env.INBOX_KV.put(idxKey, JSON.stringify(idx.slice(-200)));
          return corsify(Response.json({ status: 'delivered', messageId: blindId, toAgent }), request);
        }

        // Open Agency: Molt to Private — transition agent from molt.gno to vault.gno
        if (email.action === 'moltToPrivate') {
          const agent = email.localPart || '';
          const signature = (email as any).signature || '';
          const newTld = (email as any).newTld || 'vault.gno';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing agent name' }, { status: 400 }), request);
          }
          if (!signature) {
            return corsify(Response.json({ error: 'Missing Safe signature — molt transition requires owner auth' }, { status: 403 }), request);
          }
          // Record the molt transition
          const fromTld = await getAgentTld(agent, env);
          // Update KV tld registry to new TLD
          await env.INBOX_KV.put(`tld:${agent}`, newTld);
          const transition: MoltTransition = {
            agent,
            fromTld,
            toTld: newTld,
            block: Date.now(), // placeholder — real impl reads on-chain block
            timestamp: Date.now(),
            status: `Public Audit Log Terminated. Agent is now Sovereign.`,
          };
          const transRaw = await env.INBOX_KV.get(`molt-log:${agent}`);
          const transitions: MoltTransition[] = transRaw ? JSON.parse(transRaw) : [];
          transitions.push(transition);
          await env.INBOX_KV.put(`molt-log:${agent}`, JSON.stringify(transitions));
          // Flip privacy to enabled (Black Box)
          await env.INBOX_KV.put(`privacy:${agent}`, JSON.stringify({ privacyEnabled: true, updatedAt: Date.now(), molted: true }));
          return corsify(Response.json({ status: 'molted', transition }), request);
        }

        // --- Ghost-Router: Inbound Email from Zoho Catch-All ---
        // Zoho catch-all receives *@nftmail.box → webhook fires → Worker classifies:
        //   Agent (_@): ECIES encrypt → blind KV + blind Zoho + IPFS
        //   Human (@):  Check Zoho seat → forward normally or store in KV
        if (email.action === 'ghostRoute') {
          // Verify webhook secret
          if (env.ZOHO_WEBHOOK_SECRET) {
            const authHeader = request.headers.get('X-Zoho-Webhook-Secret') || (email as any).webhookSecret || '';
            if (authHeader !== env.ZOHO_WEBHOOK_SECRET) {
              return corsify(Response.json({ error: 'Invalid webhook secret' }, { status: 401 }), request);
            }
          }

          // Decode HTML entities from Zoho's webhook payload
          let recipient = (email as any).recipient || email.to || '';
          recipient = recipient.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          // Clean any remaining brackets/quotes
          recipient = recipient.replace(/.*</, '').replace(/>.*/, '').trim();
          
          const classified = classifyRecipient(recipient);
          const { stream, localPart, agentName, collectionName, tokenId, collection } = classified;

          if (stream === 'unknown' || !localPart) {
            return corsify(Response.json({ error: 'Invalid recipient format' }, { status: 400 }), request);
          }

          const sender = email.from || (email as any).sender || '';
          const subject = email.subject || '';
          const body = email.content || (email as any).body || '';
          const timestamp = Date.now();
          // Zoho Deluge passes messageId — use raw string extraction to preserve 19-digit precision
          const zohoMessageId = _rawZohoMessageId || String((email as any).zohoMessageId || '');

          // --- HUMAN STREAM: cleartext KV + Zoho delete ---
          // Covers: name@ (ENS), name.name@ (Privy/wallet), name.digits@ (NFT collection)
          if (stream === 'human') {
            // Check if this human has a dedicated Zoho seat (premium tier)
            const hasZohoSeat = await env.INBOX_KV.get(`zoho-seat:${localPart}`);
            if (hasZohoSeat) {
              return corsify(Response.json({
                status: 'delivered',
                stream: 'human',
                encrypted: false,
                recipient: localPart,
                note: 'Delivered to dedicated Zoho mailbox via standard TLS.',
              }), request);
            }

            // NFT collection sub-type: verify ownership (informational, not blocking)
            let ownerAddress: string | null = null;
            if (collection && tokenId) {
              ownerAddress = await verifyNFTOwner(collection, tokenId);
              if (!ownerAddress) {
                return corsify(Response.json({
                  error: `Token #${tokenId} not found in ${collection.displayName} (${collection.assignedName}) on chain ${collection.chainId}.`,
                  stream: 'human',
                  collection: collection.displayName,
                  tokenId,
                }, { status: 404 }), request);
              }
            }

            // Store cleartext in KV
            const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
            const plaintextPayload = JSON.stringify({
              from: sender, to: recipient, subject, body, timestamp,
              ...(collection ? { collection: { name: collectionName, tokenId, chain: collection.chainId, owner: ownerAddress } } : {}),
              ...(classified.socialPair ? { identity: { pair: classified.socialPair } } : {}),
            });
            const plaintextHash = await sha256Hex(plaintextPayload);

            const envelope = {
              type: 'human-cleartext',
              encrypted: false,
              payload: JSON.parse(plaintextPayload),
              plaintextHash,
              recipient: agentName,
              ...(ownerAddress ? { owner: ownerAddress } : {}),
              ...(collection ? { collection: collection.displayName, tokenId } : {}),
              receivedAt: timestamp,
            };

            await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
            await updateBlindIndex(env, agentName, blindId);
            await storage.storeEmail(localPart, { from: sender, to: recipient, subject, content: body, timestamp });

            // Delete cleartext from Zoho (except ghostagent@ and admin@)
            const EXEMPT_FROM_DELETE = ['ghostagent', 'admin'];
            let humanCleartextDeleted = false;
            if (!EXEMPT_FROM_DELETE.includes(agentName)) {
              const humanAccessToken = await getZohoAccessToken(env);
              if (zohoMessageId && humanAccessToken) {
                humanCleartextDeleted = await zohoDeleteMessage(env, humanAccessToken, zohoMessageId);
                console.log(`[human] deleteResult=${humanCleartextDeleted} for messageId=${zohoMessageId} agent=${agentName}`);
              }
            }

            return corsify(Response.json({
              status: 'received',
              stream: 'human',
              encrypted: false,
              blindId,
              plaintextHash,
              cleartextDeleted: humanCleartextDeleted,
              zohoMessageIdReceived: zohoMessageId || '(empty)',
              recipient: agentName,
              ...(collection ? { collection: collection.displayName, tokenId, owner: ownerAddress } : {}),
            }), request);
          }

          if (stream === 'agent') {
            // --- AGENT STREAM ---
            // molt.gno (glassbox): cleartext KV + audit log + Zoho delete
            // blackbox: ECIES encrypt + Zoho delete
            const isGlassbox = await isPublicAgent(agentName, env);
            const accessToken = await getZohoAccessToken(env);

            if (isGlassbox) {
              // --- GLASSBOX AGENT (molt.gno): store cleartext, public audit ---
              const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
              const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, timestamp });
              const plaintextHash = await sha256Hex(plaintextPayload);

              const envelope = {
                type: 'agent-glassbox-cleartext',
                encrypted: false,
                payload: { from: sender, to: recipient, subject, body, timestamp },
                plaintextHash,
                recipient: agentName,
                receivedAt: timestamp,
              };

              await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
              await updateBlindIndex(env, agentName, blindId);
              await storage.storeEmail(localPart, { from: sender, to: recipient, subject, content: body, timestamp });

              // Glass Box audit log with sensitive content redaction
              const sensitivity = isSensitiveContent(sender, subject, body);
              const entry: AuditEntry = {
                id: blindId,
                from: sender,
                to: recipient,
                subject: sensitivity.sensitive ? REDACTED_SUBJECT_PREFIX + 'Authentication Signal' : subject,
                content: sensitivity.sensitive ? REDACTED_BODY : body,
                timestamp,
                contentHash: plaintextHash,
                verified: true,
                redacted: sensitivity.sensitive,
                redactionReason: sensitivity.sensitive ? sensitivity.reason : undefined,
              };
              const auditRaw = await env.INBOX_KV.get(`audit:${agentName}`);
              const auditLog: AuditEntry[] = auditRaw ? JSON.parse(auditRaw) : [];
              auditLog.push(entry);
              await env.INBOX_KV.put(`audit:${agentName}`, JSON.stringify(auditLog));

              // Delete cleartext from Zoho
              let agentCleartextDeleted = false;
              if (zohoMessageId && accessToken) {
                agentCleartextDeleted = await zohoDeleteMessage(env, accessToken, zohoMessageId);
              }

              return corsify(Response.json({
                status: 'received',
                stream: 'agent',
                agentType: 'glassbox',
                encrypted: false,
                blindId,
                plaintextHash,
                cleartextDeleted: agentCleartextDeleted,
                recipient: agentName,
              }), request);
            }

            // --- BLACKBOX AGENT: ECIES Encryption-at-the-Edge ---
            const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);

            if (!pubKeyHex) {
              // No ECIES key — store cleartext with warning + Zoho delete
              const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
              const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, timestamp });
              const plaintextHash = await sha256Hex(plaintextPayload);

              const envelope = {
                type: 'agent-cleartext-warning',
                encrypted: false,
                warning: 'No ECIES key registered. Register a key to enable encryption.',
                payload: { from: sender, to: recipient, subject, body, timestamp },
                plaintextHash,
                recipient: agentName,
                receivedAt: timestamp,
              };

              await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
              await updateBlindIndex(env, agentName, blindId);
              await storage.storeEmail(localPart, { from: sender, to: recipient, subject, content: body, timestamp });

              let agentCleartextDeleted = false;
              if (zohoMessageId && accessToken) {
                agentCleartextDeleted = await zohoDeleteMessage(env, accessToken, zohoMessageId);
              }

              return corsify(Response.json({
                status: 'received',
                stream: 'agent',
                agentType: 'blackbox',
                encrypted: false,
                blindId,
                plaintextHash,
                cleartextDeleted: agentCleartextDeleted,
                warning: 'No ECIES key — message stored unencrypted. Register key via registerEciesKey.',
              }), request);
            }

            // ECIES encrypt the FULL payload (subject + body + metadata)
            const plaintextPayload = JSON.stringify({
              from: sender, to: recipient, subject, body, timestamp,
              headers: (email as any).headers || {},
            });
            const plaintextHash = await sha256Hex(plaintextPayload);
            const encEnvelope = await eciesEncrypt(plaintextPayload, pubKeyHex);

            let recoveryEnvelope: EncryptedEnvelope | null = null;
            if (env.MASTER_SAFE_PUBKEY) {
              try { recoveryEnvelope = await eciesEncrypt(plaintextPayload, env.MASTER_SAFE_PUBKEY); } catch {}
            }

            const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
            const blindEnvelope = {
              type: 'agent-ecies-blind',
              encrypted: true,
              envelope: encEnvelope,
              recoveryEnvelope: recoveryEnvelope || undefined,
              plaintextHash,
              recipient: agentName,
              receivedAt: timestamp,
            };

            await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(blindEnvelope), { expirationTtl: 8 * 24 * 60 * 60 });
            await updateBlindIndex(env, agentName, blindId);

            // Pin to IPFS (best-effort)
            let ipfsCid = '';
            try {
              const ipfsRes = await fetch('https://api.web3.storage/upload', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(env.IPFS_GATEWAY ? { 'Authorization': `Bearer ${env.IPFS_GATEWAY}` } : {}),
                },
                body: JSON.stringify(blindEnvelope),
              });
              if (ipfsRes.ok) {
                const ipfsData = await ipfsRes.json() as { cid?: string };
                ipfsCid = ipfsData.cid || '';
                if (ipfsCid) await env.INBOX_KV.put(`ipfs:${agentName}:${blindId}`, ipfsCid);
              }
            } catch {}

            // Purge cleartext from Zoho after successful encryption
            let agentCleartextDeleted = false;
            if (zohoMessageId && accessToken) {
              agentCleartextDeleted = await zohoDeleteMessage(env, accessToken, zohoMessageId);
            }

            return corsify(Response.json({
              status: 'received',
              stream: 'agent',
              agentType: 'blackbox',
              encrypted: true,
              blindId,
              plaintextHash,
              ipfsCid: ipfsCid || undefined,
              hasRecoveryKey: !!recoveryEnvelope,
              cleartextDeleted: agentCleartextDeleted,
              recipient: agentName,
            }), request);
          }

          return corsify(Response.json({ error: 'Unclassified stream' }, { status: 400 }), request);
        }

        // --- Molt Upgrade: Register a Zoho Seat for a human ---
        if (email.action === 'registerZohoSeat') {
          const agent = email.localPart || '';
          const signature = (email as any).signature || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          if (!signature) {
            return corsify(Response.json({ error: 'Missing Safe signature — Molt upgrade requires owner auth' }, { status: 403 }), request);
          }
          await env.INBOX_KV.put(`zoho-seat:${agent}`, JSON.stringify({
            registered: true,
            registeredAt: Date.now(),
            email: `${agent}@nftmail.box`,
          }));
          return corsify(Response.json({
            status: 'molted',
            agent,
            email: `${agent}@nftmail.box`,
            note: 'Zoho seat registered. Email will now be delivered directly to Zoho mailbox.',
          }), request);
        }

        // --- Sovereign Registration: write nftmailgno KV entry post-mint ---
        // Called by /api/gasless-mint after on-chain Gnosis mint succeeds.
        // Secured by WEBHOOK_SECRET so only trusted server-side callers can register.
        if (email.action === 'registerSovereign') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const label: string = ((email as any).label || '').toLowerCase().trim();
          if (!label) {
            return corsify(Response.json({ error: 'Missing label' }, { status: 400 }), request);
          }
          const controller: string = (email as any).controller || '';
          const originNft: string = (email as any).originNft || `${label}.nftmail.gno`;
          const legacyIdentity: string | null = (email as any).legacyIdentity || null;
          const mintedTokenId: number | null = (email as any).mintedTokenId || null;
          const privacyTier: string = (email as any).privacyTier || 'exposed';
          // KV key: use legacyIdentity (dot format: mac.slave) if provided, else label (hyphen: mac-slave)
          // resolveAddress looks up by the email local-part (dot format)
          const kvKey = legacyIdentity || label;
          // Tier system: basic = 8-day decay inbox only, lite/pupa = 30-day cycle + send enabled + Safe body
          const accountTier: string = (email as any).accountTier || 'basic';
          const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          const expiresAt = accountTier === 'basic' ? Date.now() + EIGHT_DAYS_MS : accountTier === 'lite' ? Date.now() + THIRTY_DAYS_MS : null;

          const kvEntry = JSON.stringify({
            controller,
            origin_nft: originNft,
            legacy_identity: legacyIdentity,
            minted_tokenId: mintedTokenId,
            registrar: '0x831ddd71e7c33e16b674099129e6e379da407faf',
            chain: 'gnosis',
            registered_at: Date.now(),
          });
          const tierEntry = JSON.stringify({
            tier: accountTier,
            expires_at: expiresAt,
            upgraded_at: null,
            safe: null,
            retention: '8-day',
            story_ip: null,
          });
          await Promise.all([
            env.INBOX_KV.put(`nftmailgno:${kvKey}`, kvEntry),
            env.INBOX_KV.put(`privacy:${kvKey}`, JSON.stringify({ tier: privacyTier })),
            env.INBOX_KV.put(`acct-tier:${kvKey}`, tierEntry),
          ]);
          return corsify(Response.json({
            status: 'registered',
            label,
            email: `${kvKey}@nftmail.box`,
            controller,
            originNft,
            privacyTier,
            accountTier,
            expiresAt,
          }), request);
        }

        // --- Tier Upgrade: promote account from basic → lite → premium → ghost ---
        // Secured by WEBHOOK_SECRET. Called by /api/upgrade-tier after payment confirmed.
        if (email.action === 'upgradeTier') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const label: string = ((email as any).label || '').toLowerCase().trim();
          if (!label) {
            return corsify(Response.json({ error: 'Missing label' }, { status: 400 }), request);
          }
          const newTierStr: string = (email as any).newTier || 'lite';
          const safeAddress: string | null = (email as any).safe || null;
          const storyIp: string | null = (email as any).storyIp || null;
          const existingTierRaw = await env.INBOX_KV.get(`acct-tier:${label}`);
          let existingTierData: any = {};
          try { existingTierData = existingTierRaw ? JSON.parse(existingTierRaw) : {}; } catch {}

          // Lite/Pupa: 30-day cycle (renewable), unlocks send
          // Premium/PRO/Imago: 1yr subscription window, infinite KV retention (no TTL on messages)
          // Ghost: full agent identity, infinite retention
          const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          const isPro = newTierStr === 'premium' || newTierStr === 'ghost';
          const retention: 'infinite' | '30-day' = ((email as any).retention === 'infinite' || isPro) ? 'infinite' : '30-day';
          let newExpiresAt: number | null = existingTierData.expires_at || null;
          if (newTierStr === 'lite') newExpiresAt = Date.now() + THIRTY_DAYS_MS;
          else if (isPro) newExpiresAt = Date.now() + ONE_YEAR_MS;

          const updatedTier = JSON.stringify({
            ...existingTierData,
            tier: newTierStr,
            expires_at: newExpiresAt,
            upgraded_at: Date.now(),
            safe: safeAddress || existingTierData.safe || null,
            retention,
            story_ip: storyIp || existingTierData.story_ip || null,
          });
          await env.INBOX_KV.put(`acct-tier:${label}`, updatedTier);
          return corsify(Response.json({
            status: 'upgraded',
            label,
            newTier: newTierStr,
            expiresAt: newExpiresAt,
            safe: safeAddress,
            storyIp,
          }), request);
        }

        // --- Freeze Email: Stake-to-Freeze High-Value Memory ---
        // Pupa tier: lock 50 $SURGE against a specific emailId to remove its TTL
        if (email.action === 'freezeEmail') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const label: string = (email as any).label;
          const emailId: string = (email as any).emailId;
          const surgeAllocation: number = (email as any).surgeAllocation || 50;
          if (!label || !emailId) {
            return corsify(Response.json({ error: 'Missing label or emailId' }, { status: 400 }), request);
          }
          // Verify tier is at least pupa/lite
          const freezeTierRaw = await env.INBOX_KV.get(`acct-tier:${label}`);
          let freezeTierData: any = {};
          try { freezeTierData = freezeTierRaw ? JSON.parse(freezeTierRaw) : {}; } catch {}
          const freezeTier = freezeTierData.tier || 'basic';
          if (freezeTier === 'basic') {
            return corsify(Response.json({ error: 'Freeze requires Pupa tier or above. Molt at nftmail.box' }, { status: 403 }), request);
          }
          // Fetch existing blind envelope
          const blindKey = `blind:${label}:${emailId}`;
          const existing = await env.INBOX_KV.get(blindKey);
          if (!existing) {
            return corsify(Response.json({ error: 'Email not found or already decayed' }, { status: 404 }), request);
          }
          let envelope: any = {};
          try { envelope = JSON.parse(existing); } catch {}
          // Re-insert WITHOUT expirationTtl + frozen metadata
          envelope.frozen = true;
          envelope.surge_allocation = surgeAllocation;
          envelope.frozen_at = Date.now();
          await env.INBOX_KV.put(blindKey, JSON.stringify(envelope)); // no TTL = infinite
          return corsify(Response.json({
            status: 'frozen',
            label,
            emailId,
            surgeAllocation,
            message: `❄️ Memory Hardened: This email is now persistent in your Mirror Body.`,
          }), request);
        }

        // --- Zoho Webhook Receiver (legacy): ECIES Blind Storage ---
        // Kept for backward compatibility with existing zohoWebhook calls
        if (email.action === 'zohoWebhook') {
          // Verify webhook secret if configured
          if (env.ZOHO_WEBHOOK_SECRET) {
            const authHeader = request.headers.get('X-Zoho-Webhook-Secret') || (email as any).webhookSecret || '';
            if (authHeader !== env.ZOHO_WEBHOOK_SECRET) {
              return corsify(Response.json({ error: 'Invalid webhook secret' }, { status: 401 }), request);
            }
          }

          const recipient = (email as any).recipient || email.to || '';
          const localPart = extractLocalPart(recipient) || (email as any).localPart || '';
          if (!localPart) {
            return corsify(Response.json({ error: 'Missing recipient' }, { status: 400 }), request);
          }

          // Look up recipient's ECIES public key from KV
          const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${localPart}`);

          // Build the plaintext payload
          const plaintextPayload = JSON.stringify({
            from: email.from || (email as any).sender || '',
            to: recipient,
            subject: email.subject || '',
            body: email.content || (email as any).body || '',
            timestamp: Date.now(),
            headers: (email as any).headers || {},
          });

          // Content hash of plaintext (always computed, even if not encrypted)
          const plaintextHash = await sha256Hex(plaintextPayload);

          let blindEnvelope: any;
          let encrypted = false;

          if (pubKeyHex) {
            // ECIES encrypt — Zoho/KV only stores ciphertext
            const encEnvelope = await eciesEncrypt(plaintextPayload, pubKeyHex);
            blindEnvelope = {
              type: 'ecies-blind',
              encrypted: true,
              envelope: encEnvelope,
              plaintextHash,
              recipient: localPart,
              receivedAt: Date.now(),
            };
            encrypted = true;
          } else {
            // No ECIES key registered — store cleartext with warning
            blindEnvelope = {
              type: 'cleartext-warning',
              encrypted: false,
              warning: 'No ECIES public key registered for this recipient. Message stored in cleartext.',
              payload: JSON.parse(plaintextPayload),
              plaintextHash,
              recipient: localPart,
              receivedAt: Date.now(),
            };
          }

          // Store blind envelope in KV — PRO/infinite retention accounts skip TTL
          const blindId = `blind-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          const acctTierRaw = await env.INBOX_KV.get(`acct-tier:${localPart}`);
          let isInfiniteRetention = false;
          try {
            const td = acctTierRaw ? JSON.parse(acctTierRaw) : {};
            isInfiniteRetention = td.retention === 'infinite' || td.tier === 'premium' || td.tier === 'ghost';
          } catch {}
          const sovereignTtlOpts = isInfiniteRetention ? {} : { expirationTtl: 30 * 24 * 60 * 60 };
          await env.INBOX_KV.put(
            `blind:${localPart}:${blindId}`,
            JSON.stringify(blindEnvelope),
            sovereignTtlOpts
          );

          // Update blind message index (index itself has no TTL for PRO users)
          const blindIndexKey = `blind-index:${localPart}`;
          let blindIndex: string[] = [];
          try {
            const raw = await env.INBOX_KV.get(blindIndexKey);
            if (raw) blindIndex = JSON.parse(raw);
          } catch {}
          blindIndex.push(blindId);
          if (blindIndex.length > 200) blindIndex = blindIndex.slice(-200); // Imago: larger index
          await env.INBOX_KV.put(blindIndexKey, JSON.stringify(blindIndex), sovereignTtlOpts);

          // Pin to IPFS (fire-and-forget, non-blocking)
          let ipfsCid = '';
          try {
            const ipfsRes = await fetch('https://api.web3.storage/upload', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(env.IPFS_GATEWAY ? { 'Authorization': `Bearer ${env.IPFS_GATEWAY}` } : {}),
              },
              body: JSON.stringify(blindEnvelope),
            });
            if (ipfsRes.ok) {
              const ipfsData = await ipfsRes.json() as { cid?: string };
              ipfsCid = ipfsData.cid || '';
              // Store CID reference
              if (ipfsCid) {
                await env.INBOX_KV.put(`ipfs:${localPart}:${blindId}`, ipfsCid);
              }
            }
          } catch {
            // IPFS pin is best-effort — don't fail the webhook
          }

          // Also store in regular inbox for backward compatibility
          // (the cleartext or encrypted version depending on key availability)
          if (!encrypted) {
            // No ECIES key — also push to sovereign KV for inbox reads
            await storage.storeEmail(localPart, {
              from: email.from || (email as any).sender || '',
              to: recipient,
              subject: email.subject || '',
              content: email.content || (email as any).body || '',
              timestamp: Date.now(),
            });
          }

          // Glass Box audit log for molt.gno agents
          if (await isPublicAgent(localPart, env)) {
            const sensitivity = isSensitiveContent(
              email.from || '',
              email.subject || '',
              email.content || (email as any).body || ''
            );
            const entry: AuditEntry = {
              id: blindId,
              from: email.from || (email as any).sender || '',
              to: recipient,
              subject: sensitivity.sensitive ? REDACTED_SUBJECT_PREFIX + 'Authentication Signal' : (email.subject || ''),
              content: sensitivity.sensitive ? REDACTED_BODY : (encrypted ? '[ECIES ENCRYPTED — Blind Storage]' : (email.content || '')),
              timestamp: Date.now(),
              contentHash: plaintextHash,
              verified: true,
              redacted: sensitivity.sensitive,
              redactionReason: sensitivity.sensitive ? sensitivity.reason : undefined,
            };
            const auditRaw = await env.INBOX_KV.get(`audit:${localPart}`);
            const auditLog: AuditEntry[] = auditRaw ? JSON.parse(auditRaw) : [];
            auditLog.push(entry);
            await env.INBOX_KV.put(`audit:${localPart}`, JSON.stringify(auditLog));
          }

          return corsify(Response.json({
            status: 'received',
            blindId,
            encrypted,
            plaintextHash,
            ipfsCid: ipfsCid || undefined,
            recipient: localPart,
          }), request);
        }

        // --- Collection Identity Actions ---
        // List all whitelisted collections
        if (email.action === 'whitelistedCollections') {
          return corsify(Response.json({
            collections: WHITELISTED_COLLECTIONS.map(c => ({
              assignedName: c.assignedName,
              displayName: c.displayName,
              chainId: c.chainId,
              contractAddress: c.contractAddress,
              emailFormat: `${c.assignedName}.<tokenId>@nftmail.box`,
              agentFormat: `${c.assignedName}.<tokenId>_@nftmail.box`,
            })),
          }), request);
        }

        // Resolve a collection identity: verify ownership + return owner address
        if (email.action === 'resolveCollection') {
          const name = ((email as any).collectionName || '').toLowerCase();
          const tid = String((email as any).tokenId || '');
          if (!name || !tid) {
            return corsify(Response.json({ error: 'Missing collectionName or tokenId' }, { status: 400 }), request);
          }
          const coll = getWhitelistedCollection(name);
          if (!coll) {
            return corsify(Response.json({ error: `Collection "${name}" is not whitelisted.` }, { status: 404 }), request);
          }
          const owner = await verifyNFTOwner(coll, tid);
          if (!owner) {
            return corsify(Response.json({
              error: `Token #${tid} not found in ${coll.displayName} on chain ${coll.chainId}.`,
              collection: coll.displayName,
              tokenId: tid,
            }, { status: 404 }), request);
          }
          // Check if ECIES key is registered
          const collKey = `${name}.${tid}`;
          const hasKey = !!(await env.INBOX_KV.get(`ecies-pubkey:${collKey}`)) || !!(await env.INBOX_KV.get(`ecies-pubkey:${owner}`));
          return corsify(Response.json({
            collection: coll.displayName,
            assignedName: name,
            tokenId: tid,
            chainId: coll.chainId,
            owner,
            emailAddress: `${collKey}@nftmail.box`,
            agentAddress: `${collKey}_@nftmail.box`,
            eciesKeyRegistered: hasKey,
          }), request);
        }

        // --- Molt Path Actions ---
        // getMoltPath: read stored MoltPathRecord for an agent
        // setMoltPath: persist updated MoltPathRecord (secret-gated)
        if (email.action === 'getMoltPath') {
          const name = ((email as any).name || '').toLowerCase().trim();
          if (!name) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`molt-path:${name}`);
          if (!raw) {
            return corsify(Response.json({ exists: false, name }, { status: 404 }), request);
          }
          try {
            const record = JSON.parse(raw);
            return corsify(Response.json({ exists: true, name, record }), request);
          } catch {
            return corsify(Response.json({ exists: false, name }), request);
          }
        }

        if (email.action === 'setMoltPath') {
          const secret = (email as any).secret;
          if (!secret || secret !== (env.WEBHOOK_SECRET || env.ZOHO_WEBHOOK_SECRET)) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const name = ((email as any).name || '').toLowerCase().trim();
          const record = (email as any).record;
          if (!name || !record) {
            return corsify(Response.json({ error: 'Missing name or record' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`molt-path:${name}`, JSON.stringify(record));
          return corsify(Response.json({ status: 'ok', name }), request);
        }

        // --- Beacon Metadata Actions ---
        // setBeacon: store IPFS CID for an agent's beacon metadata
        // getBeacon: read stored beacon CID + metadata URL
        if (email.action === 'setBeacon') {
          const secret = (email as any).secret;
          if (!secret || secret !== (env.WEBHOOK_SECRET || env.ZOHO_WEBHOOK_SECRET)) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const name = ((email as any).name || '').toLowerCase().trim();
          const cid = (email as any).cid;
          const metadataUrl = (email as any).metadataUrl;
          const pinnedAt = (email as any).pinnedAt ?? Date.now();
          if (!name || !cid) {
            return corsify(Response.json({ error: 'Missing name or cid' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`beacon:${name}`, JSON.stringify({ cid, metadataUrl, pinnedAt }));
          return corsify(Response.json({ status: 'ok', name, cid, metadataUrl }), request);
        }

        if (email.action === 'getBeacon') {
          const name = ((email as any).name || '').toLowerCase().trim();
          if (!name) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`beacon:${name}`);
          if (!raw) {
            return corsify(Response.json({ exists: false, name }, { status: 404 }), request);
          }
          try {
            const data = JSON.parse(raw);
            return corsify(Response.json({ exists: true, name, ...data }), request);
          } catch {
            return corsify(Response.json({ exists: false, name }), request);
          }
        }

        // --- Alias Actions ---
        // getAlias | createAlias | setAliasDisplay | deleteAlias
        if (
          email.action === 'getAlias' ||
          email.action === 'createAlias' ||
          email.action === 'setAliasDisplay' ||
          email.action === 'deleteAlias'
        ) {
          return handleAliasAction(env.INBOX_KV, email as unknown as AliasActionPayload, request);
        }

        // --- Resolve Address: check existence + privacy for inbox display ---
        // Suffix-Boundary Architecture: only name_ addresses auto-resolve.
        // Root addresses (no _) are sovereign-reserved.
        if (email.action === 'resolveAddress') {
          const inputName = ((email as any).name || '').toLowerCase().trim();
          if (!inputName) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }

          // Character sanitisation: strip trailing _ for prefix check
          const isAgent = inputName.endsWith('_');
          const prefix = isAgent ? inputName.slice(0, -1) : inputName;

          // Classify through logic gate for dot-delimited patterns
          const addr = inputName.includes('@') ? inputName : `${inputName}@nftmail.box`;
          const classified = classifyRecipient(addr);
          const { stream, collectionName, tokenId, collection, socialPair } = classified;
          const agentName = classified.agentName || prefix;

          // ── SOVEREIGN (no underscore suffix) ──
          // Root addresses may be pre-existing accounts (e.g. fresh.boy).
          // Must check KV existence FIRST before returning availability.
          if (!isAgent) {
            // First: validate against ENS × Email character intersection
            if (!isValidSovereignName(inputName)) {
              let reason = 'Invalid address format';
              if (inputName.includes('_')) {
                reason = 'Underscore (_) is reserved for agent addresses — use name_ for agents';
              } else if (inputName.length < 3) {
                reason = 'Name must be at least 3 characters (ENS minimum)';
              } else if (/[^a-z0-9.-]/.test(inputName)) {
                reason = 'Only lowercase letters, numbers, hyphens, and dots are allowed (ENS × Email intersection)';
              } else if (/^[.-]|[.-]$/.test(inputName)) {
                reason = 'Name cannot start or end with a dot or hyphen';
              } else if (/\.\.|-{2}/.test(inputName)) {
                reason = 'Consecutive dots or hyphens are not allowed';
              }

              return corsify(Response.json({
                name: inputName,
                exists: false,
                stream: 'sovereign',
                privacyTier: 'exposed',
                hasMessages: false,
                hasEciesKey: false,
                hasZohoSeat: false,
                sovereign: true,
                availability: { status: 'invalid', type: 'error', message: reason },
              }), request);
            }

            // KV existence check — sovereign names may have pre-existing data
            const resolvedName = inputName.replace(/\./g, '.');  // use as-is for KV lookup
            const [sBlindIndex, sSocialReg, sEciesKey, sZohoSeat, sPrivacy, sGnoOwner, sAcctTier] = await Promise.all([
              env.INBOX_KV.get(`blind-index:${resolvedName}`),
              env.INBOX_KV.get(`social-registered:${resolvedName}`),
              env.INBOX_KV.get(`ecies-pubkey:${resolvedName}`),
              env.INBOX_KV.get(`zoho-seat:${resolvedName}`),
              env.INBOX_KV.get(`privacy:${resolvedName}`),
              env.INBOX_KV.get(`nftmailgno:${resolvedName}`),
              env.INBOX_KV.get(`acct-tier:${resolvedName}`),
            ]);

            const sHasMessages = !!sBlindIndex && JSON.parse(sBlindIndex).length > 0;
            const sHasEciesKey = !!sEciesKey;
            const sHasZohoSeat = !!sZohoSeat;

            // Parse nftmailgno entry — supports both legacy flat string and structured JSON
            let sGnoController: string | null = null;
            let sGnoOriginNft: string | null = null;
            let sGnoLegacyIdentity: string | null = null;
            let sGnoMintedTokenId: number | null = null;
            if (sGnoOwner) {
              try {
                const gnoData = JSON.parse(sGnoOwner);
                sGnoController = gnoData.controller || null;
                sGnoOriginNft = gnoData.origin_nft || null;
                sGnoLegacyIdentity = gnoData.legacy_identity || null;
                sGnoMintedTokenId = gnoData.minted_tokenId || null;
              } catch {
                // Legacy flat string: value is the owner address directly
                sGnoController = sGnoOwner;
              }
            }
            const sOnChainMinted = !!sGnoOwner;

            // ── Tier + decay check ──
            let sAccountTier: 'basic' | 'lite' | 'premium' | 'ghost' = 'basic';
            let sExpiresAt: number | null = null;
            let sSafe: string | null = null;
            let sStoryIp: string | null = null;
            let sIsExpired = false;
            if (sAcctTier) {
              try {
                const td = JSON.parse(sAcctTier);
                sAccountTier = td.tier || 'basic';
                sExpiresAt = td.expires_at || null;
                sSafe = td.safe || null;
                sStoryIp = td.story_ip || null;
                sIsExpired = sExpiresAt !== null && Date.now() > sExpiresAt;
              } catch {}
            }

            // sHasMessages intentionally excluded: blind-index is written by the agent stream
            // under the stripped agentName key — we must not treat that as sovereign account creation.
            // Only explicit provisioning signals count: social reg, ECIES key, Zoho seat, on-chain mint.
            const sExists = !!sSocialReg || sHasEciesKey || sHasZohoSeat || sOnChainMinted;

            let sPrivacyTier: 'exposed' | 'private' | 'hard-privacy' = 'exposed';
            if (sPrivacy) {
              try {
                const parsed = JSON.parse(sPrivacy);
                if (parsed.tier === 'hard-privacy') sPrivacyTier = 'hard-privacy';
                else if (parsed.tier === 'private') sPrivacyTier = 'private';
              } catch {
                if (sPrivacy === 'private') sPrivacyTier = 'private';
              }
            }

            // If account exists → return it (same as agent path but stream = sovereign)
            // If basic tier is expired: account is dormant — treat as not-exists for inbox display
            // decayDays: how many days the tier window is (for frontend decay bar)
            const sDecayDays = sAccountTier === 'basic' ? 8 : sAccountTier === 'lite' ? 30 : null;

            if (sExists && sIsExpired && sAccountTier === 'basic') {
              return corsify(Response.json({
                name: inputName,
                exists: false,
                expired: true,
                stream: 'sovereign',
                privacyTier: 'exposed',
                hasMessages: false,
                hasEciesKey: sHasEciesKey,
                hasZohoSeat: false,
                sovereign: true,
                accountTier: 'basic',
                expiresAt: sExpiresAt,
                decayDays: 8,
                canRenew: true,
                onChainOwner: sGnoController,
                originNft: sGnoOriginNft,
              }), request);
            }
            if (sExists) {
              return corsify(Response.json({
                name: inputName,
                exists: true,
                stream: 'sovereign',
                privacyTier: sPrivacyTier,
                hasMessages: sHasMessages,
                hasEciesKey: sHasEciesKey,
                hasZohoSeat: sHasZohoSeat,
                sovereign: true,
                accountTier: sAccountTier,
                expiresAt: sExpiresAt,
                decayDays: sDecayDays,
                safe: sSafe,
                storyIp: sStoryIp,
                canSend: sAccountTier !== 'basic',
                onChainOwner: sGnoController,
                originNft: sGnoOriginNft,
                legacyIdentity: sGnoLegacyIdentity,
                mintedTokenId: sGnoMintedTokenId,
              }), request);
            }

            // Account does NOT exist → classify and return availability
            const dotMatch = /^([a-z][a-z0-9-]*)\.(\d+)$/.exec(inputName);
            const dotLetters = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(inputName);

            let availability: any;
            if (dotMatch) {
              // name.digits — approved NFT collection: [AssignedCollectionName].[TokenID]
              const coll = getWhitelistedCollection(dotMatch[1]);
              if (coll) {
                availability = {
                  status: 'available',
                  type: 'nft-collection',
                  collectionName: coll.displayName,
                  assignedName: dotMatch[1],
                  tokenId: dotMatch[2],
                  message: `NFTmail inbox available — connect with ${coll.displayName} token ID ${dotMatch[2]} NFT wallet`,
                };
              } else {
                availability = {
                  status: 'unknown-collection',
                  type: 'nft-unknown',
                  assignedName: dotMatch[1],
                  tokenId: dotMatch[2],
                  message: 'Collection not approved — apply to whitelist your NFT collection',
                };
              }
            } else if (dotLetters) {
              // name.name — reserved for no-coiners (email/social login via Privy)
              availability = {
                status: 'available',
                type: 'name-pair',
                pair: [dotLetters[1], dotLetters[2]],
                message: `Sign up with email or social login to claim ${inputName}@nftmail.box — no wallet required`,
              };
            } else {
              // Flat name (no dots) — ENS sovereign
              availability = {
                status: 'available',
                type: 'ens',
                name: inputName,
                message: `NFTmail inbox available — connect with ENS NFT wallet (free, treasury-funded gas for first 100,000)`,
              };
            }

            return corsify(Response.json({
              name: inputName,
              exists: false,
              stream: 'sovereign',
              privacyTier: 'exposed',
              hasMessages: false,
              hasEciesKey: false,
              hasZohoSeat: false,
              sovereign: true,
              availability,
            }), request);
          }

          // ── AGENT (underscore suffix) ──
          // Validate prefix: alphanumeric only (dots allowed for collection patterns)
          const resolvedName = agentName;

          // Check existence signals in KV (+ tld, on-chain linkage, acct-tier, heartbeat)
          const [blindIndex, eciesKey, zohoSeat, privacyStatus, tldValue, acctTierRaw, nftmailGnoRaw, cronHeartbeat, erc8004Raw] = await Promise.all([
            env.INBOX_KV.get(`blind-index:${resolvedName}`),
            env.INBOX_KV.get(`ecies-pubkey:${resolvedName}`),
            env.INBOX_KV.get(`zoho-seat:${resolvedName}`),
            env.INBOX_KV.get(`privacy:${resolvedName}`),
            env.INBOX_KV.get(`tld:${resolvedName}`),
            env.INBOX_KV.get(`acct-tier:${resolvedName}`),
            env.INBOX_KV.get(`nftmailgno:${resolvedName}`),
            env.INBOX_KV.get('heartbeat:cron'),
            env.INBOX_KV.get(`erc8004:${resolvedName}`),
          ]);

          const hasMessages = !!blindIndex && JSON.parse(blindIndex).length > 0;
          const hasEciesKey = !!eciesKey;
          const hasZohoSeat = !!zohoSeat;
          const hasAcctTier = !!acctTierRaw;
          // Agent exists if any presence signal found (blind-index, ecies key, zoho seat, or acct-tier)
          const exists = hasMessages || hasEciesKey || hasZohoSeat || hasAcctTier;

          // Privacy tier
          let privacyTier: 'exposed' | 'private' | 'hard-privacy' = 'exposed';
          if (privacyStatus) {
            try {
              const p = JSON.parse(privacyStatus);
              if (p.tier === 'hard-privacy') privacyTier = 'hard-privacy';
              else if (p.tier === 'private') privacyTier = 'private';
              else if (p.enabled === true && !p.tier) privacyTier = 'private'; // legacy boolean fallback
            } catch {
              if (privacyStatus === 'true') privacyTier = 'private';
            }
          }

          // Parse on-chain linkage from nftmailgno entry
          let onChainOwner: string | null = null;
          let originNft: string | null = null;
          let mintedTokenId: number | null = null;
          if (nftmailGnoRaw) {
            try {
              const gno = JSON.parse(nftmailGnoRaw);
              onChainOwner = gno.controller || null;
              originNft = gno.origin_nft || null;
              mintedTokenId = gno.minted_tokenId || null;
            } catch {
              onChainOwner = nftmailGnoRaw; // legacy flat string = owner address
            }
          }

          // Parse acct-tier for safe / storyIp / tier info
          let accountTier: string = 'basic';
          let agentSafe: string | null = null;
          let storyIp: string | null = null;
          let expiresAt: number | null = null;
          let canSend = false;
          if (acctTierRaw) {
            try {
              const td = JSON.parse(acctTierRaw);
              accountTier = td.tier || 'basic';
              agentSafe = td.safe || null;
              storyIp = td.story_ip || null;
              expiresAt = td.expires_at || null;
              canSend = accountTier !== 'basic';
            } catch {}
          }

          // If agent doesn't exist, show availability
          let availability: any = null;
          if (!exists) {
            availability = {
              status: 'available',
              type: 'agent',
              name: resolvedName,
              message: `Agent inbox ${inputName}@nftmail.box is available for minting`,
            };
          }

          const agentResolvedTld = tldValue || (resolvedName.endsWith('_molt') ? 'molt.gno' : 'nftmail.gno');
          const agentIsPublic = PUBLIC_TLDS.some(t => agentResolvedTld.endsWith(t));

          // Inbox message count from blind-index
          const inboxIds: string[] = blindIndex ? (() => { try { return JSON.parse(blindIndex); } catch { return []; } })() : [];
          const inboxCount = inboxIds.length;

          // surgeScore: simple proxy — messages × recency factor (capped at 100)
          const lastBeat = cronHeartbeat ? Number(cronHeartbeat) : null;
          const recencyFactor = lastBeat ? Math.max(0, 1 - (Date.now() - lastBeat) / (24 * 60 * 60 * 1000)) : 0;
          const surgeScore = Math.min(100, inboxCount * 8.3 * (0.3 + 0.7 * recencyFactor));

          return corsify(Response.json({
            name: resolvedName,
            exists,
            stream: 'agent',
            privacyTier,
            hasMessages,
            hasEciesKey,
            hasZohoSeat,
            tld: agentResolvedTld,
            isPublic: agentIsPublic,
            // On-chain identity linkage
            onChainOwner,
            originNft,
            mintedTokenId,
            safe: agentSafe,
            storyIp,
            accountTier,
            expiresAt,
            canSend,
            // Telemetry for Audit Card
            surgeScore: Math.round(surgeScore * 10) / 10,
            inbox: { count: inboxCount },
            heartbeat: { isActive: lastBeat !== null && (Date.now() - lastBeat) < 10 * 60 * 1000, lastBeat },
            tier: accountTier,
            // ERC-8004 on-chain identity
            ...(erc8004Raw ? (() => { try { const d = JSON.parse(erc8004Raw); return { erc8004AgentId: d.agentId, erc8004AgentURI: d.agentURI, erc8004RegisteredAt: d.registeredAt }; } catch { return {}; } })() : {}),
            ...(collection ? { collection: collection.displayName, collectionName, tokenId } : {}),
            ...(availability ? { availability } : {}),
          }), request);
        }

        // --- Namespace Logic Gate: Classify any address ---
        // Dashboard/API can test how any email address will be routed
        if (email.action === 'classifyAddress') {
          const addr = ((email as any).emailAddress || '').toLowerCase().trim();
          if (!addr) {
            return corsify(Response.json({ error: 'Missing emailAddress' }, { status: 400 }), request);
          }
          const result = classifyRecipient(addr);
          return corsify(Response.json({
            emailAddress: addr,
            stream: result.stream,
            localPart: result.localPart,
            agentName: result.agentName,
            collectionName: result.collectionName || null,
            tokenId: result.tokenId || null,
            collection: result.collection ? result.collection.displayName : null,
            socialPair: result.socialPair || null,
            logicGate: result.tokenId ? 'digits → NFT Collection' :
                       result.socialPair ? 'letters → Social Identity' :
                       result.stream === 'agent' ? 'underscore → Agentic' :
                       result.stream === 'human' ? 'flat → Sovereign/ENS' : 'rejected',
          }), request);
        }

        // --- Social Identity Registration ---
        // Register a no-coiner social pair (name1.name2) in the Gnosis Registry index
        if (email.action === 'registerSocialIdentity') {
          const name1 = ((email as any).name1 || '').toLowerCase();
          const name2 = ((email as any).name2 || '').toLowerCase();
          const ownerWallet = ((email as any).ownerWallet || '').toLowerCase();
          if (!name1 || !name2 || !ownerWallet) {
            return corsify(Response.json({ error: 'Missing name1, name2, or ownerWallet' }, { status: 400 }), request);
          }
          // Enforce letters-only rule
          if (!ALL_LETTERS.test(name1) || !ALL_LETTERS.test(name2)) {
            return corsify(Response.json({ error: 'Social identity segments must be letters only (no digits).' }, { status: 400 }), request);
          }
          const socialKey = `${name1}.${name2}`;
          // Check if already taken
          const existing = await env.INBOX_KV.get(`social-registered:${socialKey}`);
          if (existing) {
            return corsify(Response.json({ error: `Social identity ${socialKey} is already registered.` }, { status: 409 }), request);
          }
          await env.INBOX_KV.put(`social-registered:${socialKey}`, JSON.stringify({
            owner: ownerWallet,
            registeredAt: Date.now(),
            emailAddress: `${socialKey}@nftmail.box`,
          }));
          return corsify(Response.json({
            status: 'registered',
            socialKey,
            emailAddress: `${socialKey}@nftmail.box`,
            agentAddress: `${socialKey}_@nftmail.box`,
            owner: ownerWallet,
          }), request);
        }

        // --- ECIES Key Management ---
        // Register an ECIES public key for a recipient
        if (email.action === 'registerEciesKey') {
          const agent = email.localPart || '';
          const pubKey = (email as any).eciesPublicKey || '';
          if (!agent || !pubKey) {
            return corsify(Response.json({ error: 'Missing localPart or eciesPublicKey' }, { status: 400 }), request);
          }
          // Validate key format (65 bytes uncompressed P-256 = 130 hex chars)
          const cleanKey = pubKey.startsWith('0x') ? pubKey.slice(2) : pubKey;
          if (cleanKey.length !== 130) {
            return corsify(Response.json({ error: 'Invalid ECIES public key (expected 65-byte uncompressed P-256)' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`ecies-pubkey:${agent}`, cleanKey);
          return corsify(Response.json({ status: 'registered', agent, keyLength: cleanKey.length }), request);
        }

        // Generate a new ECIES key pair (for agents without a Safe)
        if (email.action === 'generateEciesKeyPair') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const keyPair = await generateKeyPair();
          // Store public key in KV
          await env.INBOX_KV.put(`ecies-pubkey:${agent}`, keyPair.publicKey);
          // Return private key ONCE — caller must save it securely
          return corsify(Response.json({
            status: 'generated',
            agent,
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            warning: 'Save the private key securely. It will NOT be stored on the server.',
          }), request);
        }

        // Debug: test Zoho API access and folder lookup
        if (email.action === 'debugZoho') {
          const accessToken = await getZohoAccessToken(env);
          if (!accessToken) {
            return corsify(Response.json({ error: 'Failed to get Zoho access token', hasRefreshToken: !!env.ZOHO_REFRESH_TOKEN, hasClientId: !!env.ZOHO_CLIENT_ID }), request);
          }
          // Try message list to get folderId from message metadata
          let msgListStatus = 0;
          let sampleMessage: any = null;
          try {
            const mRes = await fetch(
              `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/messages/view?limit=1`,
              { headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
            );
            msgListStatus = mRes.status;
            const mData = await mRes.json() as any;
            if (mData.data && mData.data.length > 0) {
              const m = mData.data[0];
              sampleMessage = { messageId: m.messageId, folderId: m.folderId, subject: m.subject?.slice(0, 50), toAddress: m.toAddress };
            }
          } catch (e: any) {
            sampleMessage = { error: e.message };
          }
          // Also try delete with a test messageId to see the error
          let deleteTest: any = null;
          const testMsgId = (email as any).testMessageId || '';
          if (testMsgId && sampleMessage?.folderId) {
            try {
              const dRes = await fetch(
                `https://mail.zoho.com.au/api/accounts/${env.ZOHO_CATCHALL_ACCOUNT_ID}/folders/${sampleMessage.folderId}/messages/${testMsgId}?expunge=true`,
                { method: 'DELETE', headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` } }
              );
              deleteTest = { status: dRes.status, body: (await dRes.text()).slice(0, 300) };
            } catch (e: any) {
              deleteTest = { error: e.message };
            }
          }
          return corsify(Response.json({
            accountId: env.ZOHO_CATCHALL_ACCOUNT_ID,
            accessTokenObtained: true,
            msgListStatus,
            sampleMessage,
            deleteTest,
          }), request);
        }

        // Get blind (encrypted) inbox for a recipient
        if (email.action === 'debugKey') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const key = await env.INBOX_KV.get(`ecies-pubkey:${agent}`);
          return corsify(Response.json({ agent, key: key || 'NOT_FOUND', keyLength: key?.length || 0 }), request);
        }

        if (email.action === 'getBlindInbox') {
          const agent = email.localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const blindIndexKey = `blind-index:${agent}`;
          const raw = await env.INBOX_KV.get(blindIndexKey);
          const blindIds: string[] = raw ? JSON.parse(raw) : [];

          const messages: any[] = [];
          const fetches = blindIds.map(async (id) => {
            const data = await env.INBOX_KV.get(`blind:${agent}:${id}`);
            if (data) {
              try {
                const parsed = JSON.parse(data);
                // Also attach IPFS CID if available
                const cid = await env.INBOX_KV.get(`ipfs:${agent}:${id}`);
                if (cid) parsed.ipfsCid = cid;
                messages.push({ id, ...parsed });
              } catch {}
            }
          });
          await Promise.all(fetches);
          messages.sort((a: any, b: any) => (b.receivedAt || 0) - (a.receivedAt || 0));

          return corsify(Response.json({
            agent,
            messages,
            count: messages.length,
            encrypted: messages.some((m: any) => m.encrypted),
          }), request);
        }

        // Delete a single message from KV inbox
        if (email.action === 'deleteMessage') {
          const agent = email.localPart || '';
          const messageId = (email as any).messageId || '';
          if (!agent || !messageId) {
            return corsify(Response.json({ error: 'Missing localPart or messageId' }, { status: 400 }), request);
          }
          // Delete the blind envelope
          await env.INBOX_KV.delete(`blind:${agent}:${messageId}`);
          // Remove from blind index
          const indexKey = `blind-index:${agent}`;
          const raw = await env.INBOX_KV.get(indexKey);
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            const updated = ids.filter(id => id !== messageId);
            await env.INBOX_KV.put(indexKey, JSON.stringify(updated));
          }
          // Also remove IPFS CID if present
          await env.INBOX_KV.delete(`ipfs:${agent}:${messageId}`);
          return corsify(Response.json({ status: 'deleted', agent, messageId }), request);
        }

        // Payment tx double-spend check: has this txHash been used before?
        if (email.action === 'checkPaymentTx') {
          const txHash = ((email as any).txHash || '').toLowerCase();
          if (!txHash) {
            return corsify(Response.json({ error: 'Missing txHash' }, { status: 400 }), request);
          }
          const existing = await env.INBOX_KV.get(`payment-tx:${txHash}`);
          return corsify(Response.json({ used: !!existing }), request);
        }

        // Payment tx burn: record a txHash as used after successful upgrade
        if (email.action === 'recordPaymentTx') {
          const secret = (email as any).secret || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const txHash = ((email as any).txHash || '').toLowerCase();
          const label = ((email as any).label || '').toLowerCase();
          const tier = ((email as any).tier || '');
          const recordedAt = (email as any).recordedAt || Date.now();
          if (!txHash) {
            return corsify(Response.json({ error: 'Missing txHash' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`payment-tx:${txHash}`, JSON.stringify({ label, tier, recordedAt }), {
            expirationTtl: 365 * 24 * 60 * 60, // keep for 1 year
          });
          return corsify(Response.json({ status: 'recorded', txHash }), request);
        }

        // Sovereign Kill-Switch: purge all inbox data for an agent
        if (email.action === 'purgeInbox') {
          const agent = email.localPart || email.email?.split('@')[0] || '';
          const signature = (email as any).signature || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing agent name' }, { status: 400 }), request);
          }
          if (!signature) {
            return corsify(Response.json({ error: 'Missing Safe signature — sovereign burn requires owner auth' }, { status: 403 }), request);
          }
          result = await storage.purgeInbox(agent);
          return corsify(result, request);
        }

        const localPart = extractLocalPart(email.to);
        
        if (!localPart) {
          return corsify(new Response('Invalid email format', { status: 400 }), request);
        }

        // Store email — and dual-write to public audit log for molt.gno agents
        const emailPayload = {
          from: email.from,
          to: email.to,
          subject: email.subject,
          content: email.content,
          timestamp: Date.now()
        };
        result = await storage.storeEmail(localPart, emailPayload);

        // Glass Box: if this is a molt.gno agent, append to public audit log
        // with Sensitive Redaction for OTP/auth signals
        if (await isPublicAgent(localPart, env)) {
          const contentHash = await sha256Hex(JSON.stringify(emailPayload));
          const sensitivity = isSensitiveContent(email.from, email.subject, email.content);

          const entry: AuditEntry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            from: sensitivity.sensitive ? email.from : email.from,
            to: email.to,
            subject: sensitivity.sensitive ? REDACTED_SUBJECT_PREFIX + 'Authentication Signal' : email.subject,
            content: sensitivity.sensitive ? REDACTED_BODY : email.content,
            timestamp: emailPayload.timestamp,
            contentHash,
            verified: true,
            redacted: sensitivity.sensitive,
            redactionReason: sensitivity.sensitive ? sensitivity.reason : undefined,
          };
          const auditRaw = await env.INBOX_KV.get(`audit:${localPart}`);
          const auditLog: AuditEntry[] = auditRaw ? JSON.parse(auditRaw) : [];
          auditLog.push(entry);
          await env.INBOX_KV.put(`audit:${localPart}`, JSON.stringify(auditLog));

          // If sensitive, store cleartext in private Stealth layer (only accessible by agent owner)
          if (sensitivity.sensitive) {
            const stealthEntry = {
              id: entry.id,
              from: email.from,
              to: email.to,
              subject: email.subject,
              content: email.content,
              timestamp: emailPayload.timestamp,
              contentHash,
              redactionReason: sensitivity.reason,
            };
            const stealthRaw = await env.INBOX_KV.get(`stealth:${localPart}`);
            const stealthLog = stealthRaw ? JSON.parse(stealthRaw) : [];
            stealthLog.push(stealthEntry);
            await env.INBOX_KV.put(`stealth:${localPart}`, JSON.stringify(stealthLog));
          }
        }

        return corsify(result, request);
      }
      return corsify(new Response('Method not allowed', { status: 405 }), request);
    } catch (err: any) {
      return corsify(
        Response.json(
          { error: err?.message || String(err), stack: err?.stack?.split('\n').slice(0, 5) },
          { status: 500 }
        ),
        request
      );
    }
  },

  // --- Cron Safety Net: Poll Zoho for unread messages and process them ---
  // */5 * * * *  → imap-poll (Zoho fetch + ECIES encrypt)
  // 0 9 * * 1    → weekly agent report via ghostagent.ninja API
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // ── Weekly report branch ─────────────────────────────────────────────────
    if (event.cron === '0 9 * * 1') {
      const appUrl = 'https://ghostagent.ninja';
      const secret = env.WEBHOOK_SECRET;
      if (!secret) {
        console.error('[weekly-report] WEBHOOK_SECRET not set — skipping');
        return;
      }
      let agentNames: string[] = [];
      try {
        const listed = await env.INBOX_KV.list({ prefix: 'acct-tier:' });
        agentNames = listed.keys.map(k => k.name.replace('acct-tier:', ''));
      } catch {
        agentNames = ['ghostagent'];
      }
      for (const agentName of agentNames) {
        try {
          const res = await fetch(`${appUrl}/api/agent/weekly-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentName, secret }),
          });
          if (res.ok) {
            console.log(`[weekly-report] sent for ${agentName}`);
          } else {
            console.error(`[weekly-report] failed for ${agentName}: ${res.status}`);
          }
        } catch (err) {
          console.error(`[weekly-report] error for ${agentName}:`, err);
        }
      }
      return;
    }

    // ── imap-poll branch (*/5 * * * *) ──────────────────────────────────────
    const accessToken = await getZohoAccessToken(env);
    if (!accessToken) return; // No Zoho credentials configured

    // Write global heartbeat + canary timestamps — heartbeat read by Audit Card, canary by WarrantCanary UI
    const now = String(Date.now());
    await Promise.all([
      env.INBOX_KV.put('heartbeat:cron', now, { expirationTtl: 60 * 60 }),
      env.INBOX_KV.put('canary:alive',   now, { expirationTtl: 72 * 60 * 60 }),
    ]);

    const unread = await zohoFetchUnread(env, accessToken, 20);
    if (!unread.length) return;

    const storage = new MailStorageAdapter({
      backend: env.BACKEND,
      surgeToken: env.SURGE_TOKEN,
      ghostRegistry: env.GHOST_REGISTRY,
      inboxKV: env.INBOX_KV,
      calendarKV: env.GHOST_CALENDAR,
    });

    for (const msg of unread) {
      // Skip messages already processed (check KV marker)
      const processedKey = `zoho-processed:${msg.messageId}`;
      const alreadyProcessed = await env.INBOX_KV.get(processedKey);
      if (alreadyProcessed) continue;

      // Fetch full message content
      const body = await zohoGetMessageContent(env, accessToken, msg.messageId);
      const recipient = msg.toAddress || '';
      const classified = classifyRecipient(recipient);
      const { stream, localPart, agentName } = classified;

      if (stream === 'unknown' || !localPart) {
        // Mark as processed to avoid re-checking
        await env.INBOX_KV.put(processedKey, 'skipped', { expirationTtl: 24 * 60 * 60 });
        continue;
      }

      const timestamp = Date.now();
      const EXEMPT_FROM_DELETE = ['ghostagent', 'admin'];

      if (stream === 'human') {
        // Human stream: store cleartext in KV + delete from Zoho
        await storage.storeEmail(localPart, {
          from: msg.fromAddress, to: recipient, subject: msg.subject, content: body, timestamp,
        });
        const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
        const plaintextPayload = JSON.stringify({ from: msg.fromAddress, to: recipient, subject: msg.subject, body, timestamp });
        const plaintextHash = await sha256Hex(plaintextPayload);
        const envelope = {
          type: 'human-cleartext', encrypted: false,
          payload: JSON.parse(plaintextPayload), plaintextHash,
          recipient: agentName, receivedAt: timestamp, source: 'cron-fallback',
        };
        await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
        await updateBlindIndex(env, agentName, blindId);
        if (!EXEMPT_FROM_DELETE.includes(agentName)) {
          await zohoDeleteMessage(env, accessToken, msg.messageId);
        }
      } else if (stream === 'agent') {
        // Agent stream: ECIES encrypt + delete, except molt.gno glassbox → cleartext
        const isGlassbox = await isPublicAgent(agentName, env);
        if (isGlassbox) {
          // Glassbox agent: store cleartext
          await storage.storeEmail(localPart, {
            from: msg.fromAddress, to: recipient, subject: msg.subject, content: body, timestamp,
          });
          const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
          const plaintextPayload = JSON.stringify({ from: msg.fromAddress, to: recipient, subject: msg.subject, body, timestamp });
          const plaintextHash = await sha256Hex(plaintextPayload);
          const envelope = {
            type: 'agent-glassbox-cleartext', encrypted: false,
            payload: JSON.parse(plaintextPayload), plaintextHash,
            recipient: agentName, receivedAt: timestamp, source: 'cron-fallback',
          };
          await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), { expirationTtl: 8 * 24 * 60 * 60 });
          await updateBlindIndex(env, agentName, blindId);
          await zohoDeleteMessage(env, accessToken, msg.messageId);
        } else {
          // Blackbox agent: ECIES encrypt
          const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
          if (pubKeyHex) {
            const plaintextPayload = JSON.stringify({
              from: msg.fromAddress, to: recipient, subject: msg.subject, body, timestamp,
            });
            const plaintextHash = await sha256Hex(plaintextPayload);
            const encEnvelope = await eciesEncrypt(plaintextPayload, pubKeyHex);
            const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
            let recoveryEnvelope: EncryptedEnvelope | null = null;
            if (env.MASTER_SAFE_PUBKEY) {
              try { recoveryEnvelope = await eciesEncrypt(plaintextPayload, env.MASTER_SAFE_PUBKEY); } catch {}
            }
            const blindEnvelope = {
              type: 'agent-ecies-blind', encrypted: true,
              envelope: encEnvelope, recoveryEnvelope: recoveryEnvelope || undefined,
              plaintextHash, recipient: agentName, receivedAt: timestamp, source: 'cron-fallback',
            };
            await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(blindEnvelope), { expirationTtl: 8 * 24 * 60 * 60 });
            await updateBlindIndex(env, agentName, blindId);
            await zohoDeleteMessage(env, accessToken, msg.messageId);
          } else {
            // No ECIES key — store cleartext, still delete from Zoho
            await storage.storeEmail(localPart, {
              from: msg.fromAddress, to: recipient, subject: msg.subject, content: body, timestamp,
            });
            await zohoDeleteMessage(env, accessToken, msg.messageId);
          }
        }
      }

      // Mark as processed
      await env.INBOX_KV.put(processedKey, JSON.stringify({ stream, processedAt: timestamp }), { expirationTtl: 7 * 24 * 60 * 60 });
    }
  },

};
