/// <reference types="@cloudflare/workers-types" />

import { createApp } from './router';
import { handlers } from './handlers';
import MailStorageAdapter, { CalendarInvite } from './storage';
import { D1Store } from './d1';
import { archiveBundleToZeroG, fetchBundleFromZeroG } from './zerog';
import { CloudflareKVStore } from './kv';
import { buildDirectMessageTopic, createWakuEnvelope } from './waku';
import { encrypt as eciesEncrypt, generateKeyPair, EncryptedEnvelope } from './ecies';
import { forwardEmail } from './forwarding';
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

// ── EIP-191 personal_sign recovery ───────────────────────────────────────────
// Recovers the Ethereum address that signed a personal_sign message.
// Uses the noble-secp256k1-style approach: hash the prefixed message, recover
// the public key from (r, s, v), then derive the address.
async function recoverPersonalSignSigner(message: string, signature: string): Promise<string> {
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (sig.length !== 130) throw new Error('Invalid signature length');

  const r = BigInt('0x' + sig.slice(0, 64));
  const s = BigInt('0x' + sig.slice(64, 128));
  const vHex = parseInt(sig.slice(128, 130), 16);
  const recoveryBit = vHex === 27 || vHex === 0 ? 0 : 1;

  // EIP-191 prefix — keccak256 of the prefixed message
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const msgHash = keccak256(new TextEncoder().encode(prefix + message));

  const pubKey = secp256k1Recover(msgHash, r, s, recoveryBit);
  return pubKeyToAddress(pubKey);
}

// Minimal keccak256 (Cloudflare Workers compatible — no Node crypto)
function keccak256(data: Uint8Array): Uint8Array {
  // RC constants for keccak-f[1600]
  const RC: bigint[] = [
    0x0000000000000001n,0x0000000000008082n,0x800000000000808An,0x8000000080008000n,
    0x000000000000808Bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
    0x000000000000008An,0x0000000000000088n,0x0000000080008009n,0x000000008000000An,
    0x000000008000808Bn,0x800000000000008Bn,0x8000000000008089n,0x8000000000008003n,
    0x8000000000008002n,0x8000000000000080n,0x000000000000800An,0x800000008000000An,
    0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n,
  ];
  const ROTC = [1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44];
  const PI   = [10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1];

  function rotl64(x: bigint, n: number): bigint {
    n = n & 63;
    return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & 0xFFFFFFFFFFFFFFFFn;
  }

  // Rate = 1088 bits = 136 bytes for keccak256
  const rate = 136;
  const state = new Array(25).fill(0n);

  // Pad
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] ^= 0x80;

  // Absorb
  for (let i = 0; i < padded.length; i += rate) {
    for (let j = 0; j < rate / 8; j++) {
      let lane = 0n;
      for (let k = 0; k < 8; k++) lane |= BigInt(padded[i + j * 8 + k]) << BigInt(8 * k);
      state[j] ^= lane;
    }
    // Keccak-f[1600]
    for (let round = 0; round < 24; round++) {
      const C = Array.from({length:5},(_,x)=>state[x]^state[x+5]^state[x+10]^state[x+15]^state[x+20]) as unknown as bigint[];
      const D = Array.from({length:5},(_,x)=>C[(x+4)%5]^rotl64(C[(x+1)%5],1)) as unknown as bigint[];
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + y*5] ^= D[x];
      const B = new Array(25).fill(0n);
      let cur = 1; let t = 0n;
      for (let i2 = 0; i2 < 24; i2++) {
        const next = PI[i2]; t = state[next]; state[next] = rotl64(cur === 1 ? state[0] : B[0], 0);
        B[0] = t; cur = next;
      }
      // rho + pi combined above is simplified — use standard approach
      const A = [...state];
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        state[y*5 + ((2*x+3*y)%5)] = rotl64(A[x + y*5], ROTC[(x===0&&y===0)?0:((x + 5*y)-1)%24] ?? 0);
      }
      for (let x = 0; x < 5; x++) {
        const row = [state[x], state[x+5], state[x+10], state[x+15], state[x+20]];
        for (let y = 0; y < 5; y++) state[x + y*5] = row[y] ^ ((~row[(y+1)%5]) & row[(y+2)%5]);
      }
      state[0] ^= RC[round];
    }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) out[i*8+k] = Number((state[i] >> BigInt(8*k)) & 0xFFn);
  return out;
}

// Minimal secp256k1 point recovery (for EIP-191)
const P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

function modP(n: bigint): bigint { return ((n % P) + P) % P; }
function modN(n: bigint): bigint { return ((n % N) + N) % N; }
function modInv(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m]; let [old_s, s] = [1n, 0n];
  while (r !== 0n) { const q = old_r / r; [old_r, r] = [r, old_r - q*r]; [old_s, s] = [s, old_s - q*s]; }
  return ((old_s % m) + m) % m;
}
function pointAdd(p1: [bigint,bigint]|null, p2: [bigint,bigint]): [bigint,bigint]|null {
  if (!p1) return p2;
  if (p1[0] === p2[0]) {
    if (p1[1] !== p2[1]) return null;
    const lam = modP(3n*p1[0]*p1[0] * modInv(2n*p1[1], P));
    const x = modP(lam*lam - 2n*p1[0]);
    return [x, modP(lam*(p1[0]-x) - p1[1])];
  }
  const lam = modP((p2[1]-p1[1]) * modInv(p2[0]-p1[0], P));
  const x = modP(lam*lam - p1[0] - p2[0]);
  return [x, modP(lam*(p1[0]-x) - p1[1])];
}
function pointMul(k: bigint, pt: [bigint,bigint]): [bigint,bigint] {
  let result: [bigint,bigint]|null = null; let addend: [bigint,bigint] = pt;
  while (k > 0n) { if (k & 1n) result = pointAdd(result, addend); addend = pointAdd(addend, addend)!; k >>= 1n; }
  return result!;
}

function secp256k1Recover(msgHash: Uint8Array, r: bigint, s: bigint, v: number): Uint8Array {
  const e = BigInt('0x' + Array.from(msgHash).map(b => b.toString(16).padStart(2,'0')).join(''));
  const x = r + BigInt(Math.floor(v / 2)) * N;
  if (x >= P) throw new Error('x >= P');
  const y2 = modP(x*x*x + 7n);
  // P ≡ 3 mod 4, so sqrt = y2^((P+1)/4)
  let y = modP(y2 ** ((P + 1n) / 4n));
  if (modP(y * y) !== y2) throw new Error('No sqrt');
  if ((y & 1n) !== BigInt(v & 1)) y = P - y;
  const R: [bigint,bigint] = [x, y];
  const rInv = modInv(r, N);
  const u1 = ((N - e) * rInv) % N;
  const u2 = (s * rInv) % N;
  const pt = pointAdd(pointMul(u1, [Gx, Gy]), pointMul(u2, R))!;
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  const xb = pt[0].toString(16).padStart(64,'0'); const yb = pt[1].toString(16).padStart(64,'0');
  for (let i=0;i<32;i++) { pub[1+i]=parseInt(xb.slice(i*2,i*2+2),16); pub[33+i]=parseInt(yb.slice(i*2,i*2+2),16); }
  return pub;
}

function pubKeyToAddress(pubKey: Uint8Array): string {
  // keccak256 of the 64-byte uncompressed pubkey (skip 0x04 prefix), take last 20 bytes
  const hash = keccak256(pubKey.slice(1));
  return '0x' + Array.from(hash.slice(12)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export interface Env {
  BACKEND: 'KV';
  SURGE_TOKEN: string;
  GHOST_REGISTRY: string;
  INBOX_KV: KVNamespace;
  GHOST_CALENDAR: KVNamespace;
  WEBHOOK_SECRET?: string;
  MAILGUN_API_KEY?: string;       // inbound webhook signing key (HMAC verify)
  GM_MAILGUN_API_KEY?: string;    // Mailgun Private API key for sending
  MG_MAILGUN_API_KEY?: string;    // Mailgun Private API key (correct spelling)
  SEND_MAILGUN_API_KEY?: string;  // alias — same as GM_MAILGUN_API_KEY
  MG_SENDING_MAILGUN_API_KEY?: string; // Domain-specific Mailgun Sending Key (no key- prefix)
  IPFS_GATEWAY?: string;
  // Social recovery: Master Safe public key (optional auditor)
  MASTER_SAFE_PUBKEY?: string;
  // Worker authentication secret
  WORKER_SECRET?: string;
  // D1 — LITE+ relational store (Phase 1: shadow writes only; Phase 3: reads switch here)
  NFTMAIL_DB?: D1Database;
  // 0G Storage archive — Next.js archiver URL + wallet key
  ZEROG_ARCHIVER_URL?: string;
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

// Accept both nftmail.box and ghostmail.box (and surge prefix variants)
const EMAIL_RE = /^([a-z0-9._-]+)(@(?:surge\.)?(?:nftmail|ghostmail)\.box)$/;
const AGENT_EMAIL_RE = /^([a-z0-9._-]+)\.agent(@(?:surge\.)?(?:nftmail|ghostmail)\.box)$/;

function extractLocalPart(email: string): string | null {
  const match = EMAIL_RE.exec(email.toLowerCase().trim());
  return match ? match[1] : null;
}

// --- MIME Parsing Helpers ---
// Extract the original @nftmail.box or @ghostmail.box recipient from headers or message.to
function resolveOriginalRecipient(message: EmailMessage): string {
  // Priority: X-Original-To → Delivered-To → To header → message.to
  const xOrigTo = message.headers.get('x-original-to');
  if (xOrigTo && (xOrigTo.includes('@nftmail.box') || xOrigTo.includes('@ghostmail.box'))) return xOrigTo.trim();
  const deliveredTo = message.headers.get('delivered-to');
  if (deliveredTo && (deliveredTo.includes('@nftmail.box') || deliveredTo.includes('@ghostmail.box'))) return deliveredTo.trim();
  const toHeader = message.headers.get('to');
  if (toHeader && (toHeader.includes('@nftmail.box') || toHeader.includes('@ghostmail.box'))) {
    // Extract email from "Name <email>" format
    const emailMatch = /<([^>]+@(?:nftmail|ghostmail)\.box)>/.exec(toHeader) || /([^\s,]+@(?:nftmail|ghostmail)\.box)/.exec(toHeader);
    if (emailMatch) return emailMatch[1].trim();
  }
  // Fallback: strip surge. prefix from message.to
  return message.to.replace('@surge.', '@');
}

// Strip HTML to plain text — handles multiline tags, style/script blocks, CSS artifacts
function stripHtmlToText(html: string): string {
  return html
    // Remove style and script blocks entirely (including content)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Collapse multiline tags to single line before stripping
    .replace(/<[^>]*\n[^>]*>/g, ' ')
    // Block-level tags → newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    // Normalise whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Drop lines that are pure CSS/style artifacts
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      if (/[{}]/.test(t)) return false;
      if (/^[.#][a-zA-Z0-9_-]/.test(t)) return false;
      // Pure CSS property list: "prop: value; prop: value;"
      if (/^([a-z-]+\s*:\s*[^;@<\n]+;\s*)+$/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
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
      // Only use text/plain if it has meaningful content — Google Calendar
      // and some mailers emit a near-empty text/plain with only injected CSS
      // class names (e.g. "div.zm_230163964513614591") while the actual
      // meeting details live in text/html. Fall through to HTML strip if
      // the plaintext part is suspiciously short.
      const plainTextTrimmed = plainText.replace(/\s+/g, ' ').trim();
      if (plainTextTrimmed.length > 50) return plainText;
      if (htmlText) {
        return stripHtmlToText(htmlText);
      }
      if (plainText) return plainText;
    }
  }

  // Simple text/plain or fallback
  return bodySection;
}

// Extract attachments from MIME (for DMARC reports and testing)
interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  data: string; // base64
}

function extractAttachmentsFromMime(rawMime: string, maxSize = 100000): Attachment[] {
  const attachments: Attachment[] = [];
  
  // Split headers from body
  const blankLineIdx = rawMime.indexOf('\r\n\r\n');
  const splitIdx = blankLineIdx !== -1 ? blankLineIdx : rawMime.indexOf('\n\n');
  if (splitIdx === -1) return attachments;
  
  const headerSection = rawMime.substring(0, splitIdx);
  const bodySection = rawMime.substring(splitIdx).replace(/^[\r\n]+/, '');
  
  // Check Content-Type for multipart
  const ctMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerSection);
  const contentType = ctMatch ? ctMatch[1].trim().toLowerCase() : '';
  
  if (!contentType.startsWith('multipart/')) return attachments;
  
  // Extract boundary
  const boundaryMatch = /boundary="?([^"\r\n;]+)"?/i.exec(headerSection);
  if (!boundaryMatch) return attachments;
  
  const boundary = boundaryMatch[1];
  const parts = bodySection.split('--' + boundary);
  
  for (const part of parts) {
    if (part.trim() === '--' || part.trim() === '') continue;
    
    const partHeaderEnd = part.indexOf('\r\n\r\n') !== -1 ? part.indexOf('\r\n\r\n') : part.indexOf('\n\n');
    if (partHeaderEnd === -1) continue;
    
    const partHeaders = part.substring(0, partHeaderEnd);
    const partBody = part.substring(partHeaderEnd).replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
    
    // Check if this part has attachment indicators
    const dispMatch = /content-disposition:\s*attachment/i.exec(partHeaders);
    const filenameMatch = /filename="?([^"\r\n;]+)"?/i.exec(partHeaders);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(partHeaders);
    const encMatch = /content-transfer-encoding:\s*(\S+)/i.exec(partHeaders);
    
    // Skip text parts (handled separately)
    const partType = (typeMatch ? typeMatch[1].trim().toLowerCase() : '');
    if (partType.startsWith('text/')) continue;
    
    // Only process if it looks like an attachment
    if (!dispMatch && !filenameMatch) continue;
    
    const filename = filenameMatch ? filenameMatch[1].trim() : 'unnamed';
    const encoding = encMatch ? encMatch[1].trim().toLowerCase() : '';
    
    // Decode based on transfer encoding
    let decoded: Uint8Array;
    if (encoding === 'base64') {
      try {
        decoded = Uint8Array.from(atob(partBody.replace(/\s/g, '')), c => c.charCodeAt(0));
      } catch {
        continue;
      }
    } else {
      // Assume binary/8bit - store as-is
      decoded = new TextEncoder().encode(partBody);
    }
    
    // Skip if too large
    if (decoded.length > maxSize) {
      console.log(`[attachment] Skipped ${filename} (${decoded.length} bytes) - exceeds ${maxSize} limit`);
      continue;
    }
    
    attachments.push({
      filename,
      contentType: partType || 'application/octet-stream',
      size: decoded.length,
      data: btoa(String.fromCharCode(...decoded)),
    });
  }
  
  return attachments;
}

// --- Ghost-Router: Stream Classification ---
// Suffix-Boundary Architecture (Vitalik Proof):
//
//   Format                           Stream       KV Provisioning    Verification
//   ──────────────────────────────────────────────────────────────────────────────
//   name.agent@nftmail.box           agent        AUTO (minting)     6551 Brain / Safe (ECIES)
//   name.digits_@nftmail.box           agent-alias  inherits base      NFT collection + agent A2A
//   name_@nftmail.box                agent-alias  inherits base      Agent A2A send address
//   name_@ghostmail.box              agent-alias  inherits base      Agent A2A send address (ghostmail)
//   name@nftmail.box                 sovereign    ENS RESERVED       Free (treasury gas for first 100k)
//   name.name@nftmail.box            no-coiner    EMAIL/SOCIAL       Privy creates wallet (email/social login)
//   name.digits@nftmail.box          collection   APPROVED NFT       [AssignedCollectionName].[TokenIDdigits]
//   name.agent@ghostmail.box         agent        AUTO (minting)     npx/curl A2A stream
//
// Upgrade path: name.name → Lite Tier → mint name_name.nftmail.gno → may molt to name_name.vault.gno
//
// The .agent suffix IS the boundary. Only .agent@ addresses get automated KV stores.
// Root addresses (no .agent) are reserved for sovereign identities — cannot be
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
// Agent streams: ECIES encrypt (except @molt.gno → cleartext glassbox)

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
    assignedName: '0g',
    chainId: 16600, // 0G Newton Testnet
    contractAddress: '0x8378054ffFac40f795dbA039156535eb953b3356', // GhostAgentStorageLog
    rpcUrl: 'https://evmrpc-testnet.0g.ai/',
    displayName: '0G NFT',
  },
  {
    assignedName: 'chonk',
    chainId: 8453,
    contractAddress: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9',
    rpcUrl: 'https://mainnet.base.org',
    displayName: 'Chonks',
  },
  {
    assignedName: 'atom',
    chainId: 1,
    contractAddress: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405',
    rpcUrl: 'https://ethereum.publicnode.com',
    displayName: 'POWNFT',
  },
  {
    assignedName: 'normie',
    chainId: 1,
    contractAddress: '0x9eb6e2025b64f340691e424b7fe7022ffde12438',
    rpcUrl: 'https://ethereum.publicnode.com',
    displayName: 'Normies',
  },
  {
    assignedName: 'mooncat',
    chainId: 1,
    contractAddress: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69',
    rpcUrl: 'https://ethereum.publicnode.com',
    displayName: 'MoonCats',
  },
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

// Dot-delimited regex: name1.segment2 with optional .agent suffix
// segment2 is captured raw — the logic gate checks digits vs letters
const DOT_DELIMITED_RE = /^([a-z]+)\.([a-z0-9]+)(\.agent)?(@(?:surge\.)?nftmail\.box)$/;
const ALL_DIGITS = /^[0-9]+$/;
const ALL_LETTERS = /^[a-z]+$/;

function classifyRecipient(emailAddr: string): ClassifiedRecipient {
  const lower = emailAddr.toLowerCase().trim();

  // 1. Dot-delimited: apply the Digit vs. Letter Logic Gate
  const dotMatch = DOT_DELIMITED_RE.exec(lower);
  if (dotMatch) {
    const [, segment1, segment2, agentSuffix] = dotMatch;
    const isAgent = agentSuffix === '.agent';

    // LOGIC GATE: Digit vs. Letter partition
    if (ALL_DIGITS.test(segment2)) {
      // ── NFT COLLECTION PATH ── segment2 is all digits = tokenId
      const collection = getWhitelistedCollection(segment1);
      if (collection) {
        return {
          stream: isAgent ? 'agent' : 'human',
          localPart: `${segment1}.${segment2}${isAgent ? '.agent' : ''}`,
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
        localPart: `${segment1}.${segment2}${isAgent ? '.agent' : ''}`,
        agentName: `${segment1}.${segment2}`,
        socialPair: [segment1, segment2],
      };
    }

    // Mixed digits+letters in segment2 — REJECTED (anti-spoof guardrail)
    return { stream: 'unknown', localPart: '', agentName: '' };
  }

  // 2. Agent: flat name ending with .agent before @
  const agentMatch = AGENT_EMAIL_RE.exec(lower);
  if (agentMatch) {
    return { stream: 'agent', localPart: agentMatch[1] + '.agent', agentName: agentMatch[1] };
  }

  // 3. Human: flat name (sovereign / ENS holder)
  const humanMatch = EMAIL_RE.exec(lower);
  if (humanMatch) {
    const lp = humanMatch[1];
    if (lp.endsWith('.agent')) {
      return { stream: 'agent', localPart: lp, agentName: lp.slice(0, -6) };
    }
    // Agent alias: ends with _ (e.g., ghostagent_ -> ghostagent base identity)
    if (lp.endsWith('_')) {
      return { stream: 'agent', localPart: lp, agentName: lp.slice(0, -1) };
    }
    return { stream: 'human', localPart: lp, agentName: lp };
  }

  return { stream: 'unknown', localPart: '', agentName: '' };
}

// --- Tier-aware TTL ---
// basic=8d, lite(Lite)=30d, premium/ghost=no expiry (null = no TTL arg)
const TIER_TTL: Record<string, number | null> = {
  basic: 8 * 24 * 60 * 60,
  lite:  30 * 24 * 60 * 60,
  premium: null,
  ghost: null,
};
async function getAgentTtlSecs(env: Env, agentName: string): Promise<number | null> {
  const baseName = agentName.replace(/_+$/, '');
  const [tierRaw, baseTierRaw] = await Promise.all([
    agentName !== baseName ? env.INBOX_KV.get(`acct-tier:${agentName}`) : Promise.resolve(null),
    env.INBOX_KV.get(`acct-tier:${baseName}`),
  ]);
  const effective = tierRaw || baseTierRaw;
  if (!effective) return TIER_TTL.basic as number;
  try {
    const td = JSON.parse(effective);
    const tier = (td.tier || 'basic') as string;
    return tier in TIER_TTL ? TIER_TTL[tier] : (TIER_TTL.basic as number);
  } catch {
    return TIER_TTL.basic as number;
  }
}

// --- Blind Index Helper ---
// domainPrefix: 'ghostmail' for ghostmail.box inbound, '' for nftmail.box (default)
async function updateBlindIndex(env: Env, agentName: string, blindId: string, domainPrefix = '', ttlSecs?: number | null): Promise<void> {
  const keyName = domainPrefix ? `${domainPrefix}:${agentName}` : agentName;
  const blindIndexKey = `blind-index:${keyName}`;
  let blindIndex: string[] = [];
  try {
    const raw = await env.INBOX_KV.get(blindIndexKey);
    if (raw) blindIndex = JSON.parse(raw);
  } catch {}
  blindIndex.push(blindId);
  const INBOX_CAP = 100;
  if (blindIndex.length > INBOX_CAP) {
    const evicted = blindIndex.splice(0, blindIndex.length - INBOX_CAP);
    await Promise.all(evicted.map(id => env.INBOX_KV.delete(`blind:${keyName}:${id}`)));
  }
  const putOpts = ttlSecs != null ? { expirationTtl: ttlSecs } : {};
  await env.INBOX_KV.put(blindIndexKey, JSON.stringify(blindIndex), putOpts);
  // DAU ping — non-invasive activity marker, auto-expires after 48h
  const today = new Date().toISOString().slice(0, 10);
  env.INBOX_KV.put(`dau:${today}:${agentName}`, '1', { expirationTtl: 172800 }).catch(() => {});
}

// ── ENS existence check on Ethereum Mainnet ────────────────────────────────
// Checks if `label.eth` is registered on mainnet ENS.
// Uses ENS BaseRegistrar at 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85
const ETH_RPC = 'https://ethereum.publicnode.com';
const ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';

// Keccak-256 implementation for ENS labelhash (FIPS 202 SHA3 variant)
// Based on the keccak-f[1600] permutation
class Keccak256 {
  private static readonly RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];

  private static readonly R = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14
  ];

  static hash(input: Uint8Array): Uint8Array {
    const state = new BigUint64Array(25);
    const blockSize = 136; // r = 1088 bits = 136 bytes for keccak-256

    // Absorb
    for (let i = 0; i < input.length; i += blockSize) {
      const block = input.slice(i, i + blockSize);
      for (let j = 0; j < block.length; j++) {
        state[j >> 3] ^= BigInt(block[j]) << BigInt((j & 7) * 8);
      }
      this.keccakF(state);
    }

    // Final block with padding (10*1 pattern for keccak)
    const lastBlock = new Uint8Array(blockSize);
    const remaining = input.length % blockSize;
    for (let i = 0; i < remaining; i++) {
      lastBlock[i] = input[input.length - remaining + i];
    }
    lastBlock[remaining] = 0x01; // Padding start
    lastBlock[blockSize - 1] |= 0x80; // Padding end
    for (let j = 0; j < blockSize; j++) {
      state[j >> 3] ^= BigInt(lastBlock[j]) << BigInt((j & 7) * 8);
    }
    this.keccakF(state);

    // Squeeze (256 bits = 32 bytes)
    const output = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      output[i] = Number((state[i >> 3] >> BigInt((i & 7) * 8)) & 0xffn);
    }
    return output;
  }

  private static keccakF(state: BigUint64Array): void {
    const temp = new BigUint64Array(25);
    const C = new BigUint64Array(5);

    for (let round = 0; round < 24; round++) {
      // Theta
      for (let i = 0; i < 5; i++) {
        C[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
      }
      for (let i = 0; i < 5; i++) {
        const D = C[(i + 4) % 5] ^ ((C[(i + 1) % 5] << 1n) | (C[(i + 1) % 5] >> 63n));
        for (let j = 0; j < 25; j += 5) {
          state[i + j] ^= D;
        }
      }

      // Rho and Pi
      temp[0] = state[0];
      for (let i = 1; i < 25; i++) {
        const r = this.R[i];
        temp[i] = (state[i] << BigInt(r)) | (state[i] >> BigInt(64 - r));
      }
      for (let i = 0; i < 25; i++) {
        state[i] = temp[(i * 7) % 25]; // Pi permutation
      }

      // Chi
      for (let j = 0; j < 25; j += 5) {
        for (let i = 0; i < 5; i++) {
          C[i] = state[j + i];
        }
        for (let i = 0; i < 5; i++) {
          state[j + i] ^= (~C[(i + 1) % 5]) & C[(i + 2) % 5];
        }
      }

      // Iota
      state[0] ^= this.RC[round];
    }
  }
}

// Compute labelhash (keccak256 of the label)
function labelhash(label: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(label.toLowerCase());
  const hash = Keccak256.hash(data);
  return '0x' + Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Compute ENS namehash
function namehash(name: string): string {
  let node = '0x0000000000000000000000000000000000000000000000000000000000000000';
  if (!name) return node;

  const labels = name.split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    const hash = labelhash(labels[i]);
    // keccak256(node + labelhash)
    const nodeBytes = hexToBytes(node.slice(2));
    const hashBytes = hexToBytes(hash.slice(2));
    const combined = new Uint8Array(nodeBytes.length + hashBytes.length);
    combined.set(nodeBytes);
    combined.set(hashBytes, nodeBytes.length);
    const newHash = Keccak256.hash(combined);
    node = '0x' + Array.from(newHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return node;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function ensNameExists(label: string): Promise<{ exists: boolean; owner: string | null }> {
  try {
    // Use ownerOf(uint256 tokenId) on BaseRegistrar
    // tokenId = uint256(keccak256(label)) = labelhash
    const lh = labelhash(label.toLowerCase());
    const tokenId = BigInt(lh).toString(16).padStart(64, '0');

    // ownerOf(uint256) selector = 0x6352211e
    const data = '0x6352211e' + tokenId;

    const resp = await fetch(ETH_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: ENS_BASE_REGISTRAR, data }, 'latest']
      }),
    });
    const json: any = await resp.json();
    const result: string = json.result || '0x';

    if (json.error || !result || result === '0x' || result === '0x' + '0'.repeat(64)) {
      return { exists: false, owner: null };
    }

    const owner = '0x' + result.slice(-40);
    return {
      exists: owner !== '0x0000000000000000000000000000000000000000',
      owner: owner !== '0x0000000000000000000000000000000000000000' ? owner : null
    };
  } catch (e) {
    console.error('[ensNameExists] Error checking ENS:', e);
    return { exists: false, owner: null };
  }
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
// Default Glass Box (public audit log, cleartext): molt.gno
// Default Dark Box (private, ECIES-encrypted): all others
// Any agent may toggle via setPrivacy (privacy: KV override respected at ingest)
const PUBLIC_TLDS = ['molt.gno'];
const PRIVATE_TLDS = ['agent.gno', 'openclaw.gno', 'picoclaw.gno', 'vault.gno', 'nftmail.gno'];

async function isPublicAgent(agentName: string, env: Env, parentTld?: string): Promise<boolean> {
  // Strip trailing _ (agent alias) to inherit base agent's TLD + privacy
  const baseName = agentName.replace(/_+$/, '');

  // Check privacy: KV override — respects both directions of toggle
  // Glassbox agent toggled private → darkbox; Darkbox agent toggled exposed → glassbox
  const privacyRaw = await env.INBOX_KV.get(`privacy:${agentName}`) || await env.INBOX_KV.get(`privacy:${baseName}`);
  if (privacyRaw) {
    try {
      const p = JSON.parse(privacyRaw);
      if (p.tier === 'private' || p.tier === 'hard-privacy') return false;
      if (p.tier === 'exposed') return true;
    } catch {
      if (privacyRaw === 'true' || privacyRaw === 'private') return false;
    }
  }

  if (parentTld) return PUBLIC_TLDS.some(t => parentTld.endsWith(t));
  // KV registry: tld:{agentName} → 'molt.gno' | 'vault.gno' | etc.
  const tld = await env.INBOX_KV.get(`tld:${agentName}`) || (baseName !== agentName ? await env.INBOX_KV.get(`tld:${baseName}`) : null);
  if (tld) return PUBLIC_TLDS.includes(tld);
  // Fallback: suffix convention for legacy agents
  return agentName.endsWith('_molt') || baseName.endsWith('_molt');
}

async function getAgentTld(agentName: string, env: Env, parentTld?: string): Promise<string> {
  if (parentTld) return parentTld;
  // Strip trailing _ (agent alias) to inherit base agent's TLD
  const baseName = agentName.replace(/_+$/, '');
  // KV registry first — check specific name, then base name
  const tld = await env.INBOX_KV.get(`tld:${agentName}`) || (baseName !== agentName ? await env.INBOX_KV.get(`tld:${baseName}`) : null);
  if (tld) return tld;
  // Fallback: suffix convention
  if (agentName.endsWith('_molt') || baseName.endsWith('_molt')) return 'molt.gno';
  if (agentName.endsWith('_vault') || baseName.endsWith('_vault')) return 'vault.gno';
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
  edgeEncrypt?: unknown;
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

function corsHeaders(request?: Request): Headers {
  // Defensive: some code paths invoke corsify without a request reference in scope.
  // Fall back to wildcard origin so we never throw from here.
  let origin = '*';
  try {
    if (request && request.headers && typeof request.headers.get === 'function') {
      origin = request.headers.get('Origin') || '*';
    } else if (request) {
      console.warn('[corsHeaders] request passed without .headers — falling back to *');
    }
  } catch (err) {
    console.warn('[corsHeaders] unexpected error reading Origin:', err);
  }
  return new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
}

function corsify(response: Response, request?: Request): Response {
  const headers = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  headers.forEach((v, k) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

async function handleMailgunPayload(
  mgEmail: Record<string, unknown>,
  env: Env,
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  const timestamp = Date.now();
  const rawRecipient = String(mgEmail['recipient'] || mgEmail['to'] || '');
  const recipientLocal = rawRecipient.split('@')[0] || '';
  // Only add a default domain if we have no @ at all — never rewrite the local-part
  const normalisedRecipient = rawRecipient.includes('@') ? rawRecipient : `${rawRecipient}@nftmail.box`;

  let recipient = normalisedRecipient.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  recipient = recipient.replace(/.*</, '').replace(/>.*/, '').trim();

  const classified = classifyRecipient(recipient);
  const { stream, localPart, agentName, collectionName, tokenId, collection } = classified;

  if (stream === 'unknown' || !localPart) {
    return corsify(Response.json({ error: 'Invalid recipient format', recipient }, { status: 400 }), request);
  }

  // Unified inbox: nftmail.box and ghostmail.box deliver to the SAME blind-index key per agent.
  // The recipient-to domain is preserved inside each envelope's payload.to, so the UI can show
  // which address the message was sent to and the Reply flow can auto-select matching send domain.
  // Ghostmail is human-only: agent suffixes (_ or .agent) on @ghostmail.box are rejected below.
  const isGhostmailDomain = recipient.toLowerCase().includes('@ghostmail.box');
  if (isGhostmailDomain && (stream === 'agent' || localPart.endsWith('_') || localPart.endsWith('.agent'))) {
    return corsify(Response.json({
      error: 'Agent suffixes are not allowed on ghostmail.box — use @nftmail.box for agent traffic',
      recipient,
    }, { status: 400 }), request);
  }
  const storeDomainPrefix = '';
  const storeKeyName = (name: string) => name;

  // ── Phase 5: resolve agent tier (D1 first, KV fallback) ────────────────
  const resolveAgentTierFast = async (label: string): Promise<string> => {
    const base = label.replace(/_+$/, '');
    if (env.NFTMAIL_DB) {
      try {
        const row = await new D1Store(env.NFTMAIL_DB).getAgent(base);
        if (row) return row.tier;
      } catch {}
    }
    try {
      const raw = await env.INBOX_KV.get(`acct-tier:${base}`);
      if (raw) return JSON.parse(raw).tier ?? 'basic';
    } catch {}
    return 'basic';
  };

  // ── Phase 4/5: D1 email write for LITE+ ──────────────────────────────────
  // Phase 4: shadow-write (KV still written). Phase 5: D1 is sole store for LITE+.
  const shadowWriteEmailToD1 = (label: string, bId: string, envelopeJson: string, ttlMs: number | null) => {
    if (!env.NFTMAIL_DB) return;
    ctx.waitUntil((async () => {
      try {
        const d1 = new D1Store(env.NFTMAIL_DB!);
        const agentRow = await d1.getAgent(label.replace(/_+$/, ''));
        if (!agentRow || agentRow.tier === 'basic') return; // BASIC stays KV-only
        const senderHashVal = await sha256Hex(sender).catch(() => null);
        const subjectHashVal = await sha256Hex(subject).catch(() => null);
        await d1.insertEmail({
          // Preserve trailing _ so agent alias inbox is distinct from base human inbox
          agent_label: label,
          blind_id: bId,
          domain_prefix: storeDomainPrefix,
          encrypted_blob: envelopeJson,
          sender_hash: senderHashVal,
          subject_hash: subjectHashVal,
          received_at: timestamp,
          read: 0,
          frozen: 0,
          surge_allocation: null,
          ttl_expires_at: ttlMs,
        });
      } catch (e) {
        console.error('[D1 shadow] email insert failed (non-fatal):', e);
      }
    })());
  };

  // Mailgun provides two sender fields:
  //   'from'   = header From (what the user wrote, e.g. '"Victor" <victor@nftmail.box>')
  //   'sender' = envelope Return-Path, often a VERP bounce address like
  //              'bounce+xxxx-agent=ghostmail.box@nftmail.box'
  // Prefer 'from' for display/reply, fall back to 'sender'. Strip display name + angle brackets
  // so the stored value is a clean reply-to address (e.g. 'victor@nftmail.box').
  const rawSender = String(mgEmail['from'] || mgEmail['sender'] || '');
  const senderEmailMatch = rawSender.match(/<([^>]+@[^>]+)>/) || rawSender.match(/([^\s<>,]+@[^\s<>,]+)/);
  const sender = senderEmailMatch ? senderEmailMatch[1].trim() : rawSender.trim();
  const subject = String(mgEmail['subject'] || '');
  const bodyHtmlRaw = String(mgEmail['bodyHtml'] || '');
  const body = String(mgEmail['strippedText'] || mgEmail['bodyPlain'] || bodyHtmlRaw || '');

  console.log(`[mailgunInbound] recipient=${recipient} agentName=${agentName} stream=${stream}`);
  const mgTtlSecs = await getAgentTtlSecs(env, agentName);

  if (stream === 'human') {
    let ownerAddress: string | null = null;
    if (collection && tokenId) {
      ownerAddress = await verifyNFTOwner(collection, tokenId);
      if (!ownerAddress) {
        // Store as unverified rather than rejecting — returning 4xx causes Mailgun to retry forever
        console.warn(`[mailgunInbound] Token #${tokenId} not found in ${collection.displayName} — storing as unverified`);
      }
    }
    const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
    const payloadObj = {
      from: sender, to: recipient, subject,
      body: ownerAddress === null && collection ? `[UNVERIFIED — Token #${tokenId} not found in ${collection.displayName}] ${body}` : body,
      ...(bodyHtmlRaw ? { bodyHtml: bodyHtmlRaw } : {}), timestamp,
    };
    const plaintextPayload = JSON.stringify(payloadObj);
    const plaintextHash = await sha256Hex(plaintextPayload);
    const envelope = {
      type: 'human-cleartext', encrypted: false,
      payload: payloadObj, plaintextHash,
      recipient: agentName, receivedAt: timestamp,
    };
    const mgPutOpts = mgTtlSecs != null ? { expirationTtl: mgTtlSecs } : {};
    // Use localPart for storage key (preserves _ suffix for agent aliases)
    const storageName = localPart || agentName;
    const _humanMgTier = await resolveAgentTierFast(storageName);
    const _humanMgEnvJson = JSON.stringify(envelope);
    
    // Check for forward-only config (PREMIUM tier toggle to reduce clutter)
    const forwardOnlyRaw = await env.INBOX_KV.get(`inbox-config:${storageName}`);
    const forwardOnly = forwardOnlyRaw ? JSON.parse(forwardOnlyRaw).forwardOnly === true : false;
    
    // Always shadow-write to D1 for analytics/backup, but skip KV if forward-only
    shadowWriteEmailToD1(storageName, blindId, _humanMgEnvJson, mgTtlSecs ? mgTtlSecs * 1000 + timestamp : null);
    
    if (!forwardOnly) {
      await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, _humanMgEnvJson, mgPutOpts);
      await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
    } else {
      console.log(`[inbox] ${storageName} forward-only mode - skipping KV storage`);
    }

    // Fire email forwarding for Premium human inboxes (non-fatal — storage already succeeded).
    // Keyed by agentName (base identity), not storageName — forwarding config is tied to the
    // on-chain NFT identity, not the @-local-part variant.
    try {
      const forwarded = await forwardEmail(env as any, agentName, {
        from: sender, to: recipient, subject,
        content: body, timestamp,
      });
      if (forwarded) console.log(`[forwarding] human ${agentName} → forwarded`);
    } catch (err) {
      console.error(`[forwarding] human ${agentName} failed (non-fatal):`, err);
    }

    return corsify(Response.json({ status: 'received', stream: 'human', blindId, plaintextHash, recipient: storageName }), request);
  }

  if (stream === 'agent') {
    const mgPutOpts = mgTtlSecs != null ? { expirationTtl: mgTtlSecs } : {};
    // Use localPart for storage key (preserves _ suffix for agent aliases)
    const storageName = localPart || agentName;
    const isGlassbox = await isPublicAgent(agentName, env);
    if (isGlassbox) {
      const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, ...(bodyHtmlRaw ? { bodyHtml: bodyHtmlRaw } : {}), timestamp });
      const plaintextHash = await sha256Hex(plaintextPayload);
      const envelope = { type: 'agent-glassbox-cleartext', encrypted: false, payload: JSON.parse(plaintextPayload), plaintextHash, recipient: storageName, receivedAt: timestamp };
      const _gbEnvJson = JSON.stringify(envelope);
      const _gbTier = await resolveAgentTierFast(storageName);
      shadowWriteEmailToD1(storageName, blindId, _gbEnvJson, mgTtlSecs ? mgTtlSecs * 1000 + timestamp : null);
      await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, _gbEnvJson, mgPutOpts);
      await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
      return corsify(Response.json({ status: 'received', stream: 'agent', agentType: 'glassbox', blindId, plaintextHash, recipient: storageName }), request);
    }

    const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
    if (!pubKeyHex) {
      const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, timestamp });
      const plaintextHash = await sha256Hex(plaintextPayload);
      const envelope = { type: 'agent-cleartext-warning', encrypted: false, warning: 'No ECIES key registered.', payload: JSON.parse(plaintextPayload), plaintextHash, recipient: storageName, receivedAt: timestamp };
      const _cwEnvJson = JSON.stringify(envelope);
      const _cwTier = await resolveAgentTierFast(storageName);
      shadowWriteEmailToD1(storageName, blindId, _cwEnvJson, mgTtlSecs ? mgTtlSecs * 1000 + timestamp : null);
      await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, _cwEnvJson, mgPutOpts);
      await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
      return corsify(Response.json({ status: 'received', stream: 'agent', agentType: 'blackbox', encrypted: false, blindId, plaintextHash, warning: 'No ECIES key — stored unencrypted.' }), request);
    }

    const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, timestamp });
    const plaintextHash = await sha256Hex(plaintextPayload);
    const encEnvelope = await eciesEncrypt(plaintextPayload, pubKeyHex);
    let recoveryEnvelope: EncryptedEnvelope | null = null;
    if (env.MASTER_SAFE_PUBKEY) { try { recoveryEnvelope = await eciesEncrypt(plaintextPayload, env.MASTER_SAFE_PUBKEY); } catch {} }
    const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
    const blindEnvelope = { type: 'agent-ecies-blind', encrypted: true, envelope: encEnvelope, recoveryEnvelope: recoveryEnvelope || undefined, plaintextHash, recipient: storageName, receivedAt: timestamp };
    const _agentBlindJson = JSON.stringify(blindEnvelope);
    const _agentBlindTier = await resolveAgentTierFast(storageName);
    shadowWriteEmailToD1(storageName, blindId, _agentBlindJson, mgTtlSecs ? mgTtlSecs * 1000 + timestamp : null);
    await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, _agentBlindJson, mgPutOpts);
    await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
    return corsify(Response.json({ status: 'received', stream: 'agent', agentType: 'blackbox', encrypted: true, blindId, plaintextHash, hasRecoveryKey: !!recoveryEnvelope, recipient: storageName }), request);
  }

  return corsify(Response.json({ error: 'Unclassified stream' }, { status: 400 }), request);
}

// ── Handler: Cloudflare Email Routing inbound ───────────────────────────────
async function _handleEmail(message: EmailMessage, env: Env, ctx: ExecutionContext) {
    const storage = new MailStorageAdapter({
      backend: env.BACKEND,
      surgeToken: env.SURGE_TOKEN,
      ghostRegistry: env.GHOST_REGISTRY,
      inboxKV: new CloudflareKVStore(env.INBOX_KV),
      calendarKV: new CloudflareKVStore(env.GHOST_CALENDAR),
    });

    // --- Parse the inbound email ---
    // Cloudflare Email Routing → worker email() handler
    const originalRecipient = resolveOriginalRecipient(message);
    const sender = message.from;
    const subject = message.headers.get('subject') || '';
    const rawMime = await new Response(message.raw).text();
    const body = extractBodyFromMime(rawMime);
    // Extract attachments for DMARC reports and testing (<100KB limit for KV storage)
    const attachments = extractAttachmentsFromMime(rawMime, 100000);
    const hasAttachments = attachments.length > 0;
    if (hasAttachments) {
      console.log(`[inbound] Extracted ${attachments.length} attachment(s) for ${originalRecipient}: ${attachments.map(a => `${a.filename} (${a.size} bytes)`).join(', ')}`);
    }
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
        ...(hasAttachments ? { attachments: attachments.map(a => ({ filename: a.filename, size: a.size, type: a.contentType })) } : {}),
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
        // Store attachment data inline for small files (DMARC reports)
        ...(hasAttachments ? { 
          attachments: attachments.map(a => ({ 
            filename: a.filename, 
            size: a.size, 
            type: a.contentType, 
            data: a.data 
          })) 
        } : {}),
      };
      const humanTtlSecs = await getAgentTtlSecs(env, agentName);
      const humanPutOpts = humanTtlSecs != null ? { expirationTtl: humanTtlSecs } : {};
      const _humanEnvJson = JSON.stringify(envelope);
      // Phase 5: D1 write + tier gate (inline — outside handleMailgunPayload scope)
      if (env.NFTMAIL_DB) {
        ctx.waitUntil((async () => {
          try {
            const _r = await new D1Store(env.NFTMAIL_DB!).getAgent(agentName);
            if (_r && _r.tier !== 'basic') {
              const _sh = await sha256Hex(sender).catch(() => null);
              const _subh = await sha256Hex(subject).catch(() => null);
              await new D1Store(env.NFTMAIL_DB!).insertEmail({ agent_label: agentName, blind_id: blindId, domain_prefix: '', encrypted_blob: _humanEnvJson, sender_hash: _sh, subject_hash: _subh, received_at: timestamp, read: 0, frozen: 0, surge_allocation: null, ttl_expires_at: humanTtlSecs ? humanTtlSecs * 1000 + timestamp : null });
            }
          } catch (e) { console.error('[D1 shadow] human email insert failed:', e); }
        })());
      }
      await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, _humanEnvJson, humanPutOpts);
      await updateBlindIndex(env, agentName, blindId, '', humanTtlSecs);
      await storage.storeEmail(localPart, { from: sender, to: originalRecipient, subject, content: body, timestamp });
      // Storage complete — Mailgun inbound path
      return;
    }

    // --- AGENT STREAM ---
    if (stream === 'agent') {
      // --- Alias resolution: CHONK_123_ → paymastr ---
      // If this local-part is an alias, transparently redirect to the primary agent's inbox.
      const aliasResolved = await resolveAlias(env.INBOX_KV, localPart);
      const resolvedAgentName = aliasResolved ?? agentName;
      // Storage key preserves the trailing `_` so an agent inbox (e.g. ghostagent_)
      // is distinct from the human inbox at the same base name (e.g. ghostagent).
      // resolvedAgentName (stripped) is only used for ECIES pubkey / TTL lookups
      // because those are tied to the base on-chain identity.
      const storageName = aliasResolved ?? localPart;

      const agentTtlSecs = await getAgentTtlSecs(env, storageName);
      const agentPutOpts = agentTtlSecs != null ? { expirationTtl: agentTtlSecs } : {};
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
        const _noKeyEnvJson = JSON.stringify(envelope);
        if (env.NFTMAIL_DB) {
          ctx.waitUntil((async () => {
            try {
              const _r2 = await new D1Store(env.NFTMAIL_DB!).getAgent(storageName.replace(/_+$/, ''));
              if (_r2 && _r2.tier !== 'basic') {
                const _sh2 = await sha256Hex(sender).catch(() => null);
                const _subh2 = await sha256Hex(subject).catch(() => null);
                await new D1Store(env.NFTMAIL_DB!).insertEmail({ agent_label: storageName, blind_id: blindId, domain_prefix: '', encrypted_blob: _noKeyEnvJson, sender_hash: _sh2, subject_hash: _subh2, received_at: timestamp, read: 0, frozen: 0, surge_allocation: null, ttl_expires_at: agentTtlSecs ? agentTtlSecs * 1000 + timestamp : null });
              }
            } catch (e) { console.error('[D1 shadow] no-key email insert failed:', e); }
          })());
        }
        await env.INBOX_KV.put(`blind:${storageName}:${blindId}`, _noKeyEnvJson, agentPutOpts);
        await updateBlindIndex(env, storageName, blindId, '', agentTtlSecs);
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
      const _eciesBlindJson = JSON.stringify(blindEnvelope);
      if (env.NFTMAIL_DB) {
        ctx.waitUntil((async () => {
          try {
            const _r3 = await new D1Store(env.NFTMAIL_DB!).getAgent(storageName.replace(/_+$/, ''));
            if (_r3 && _r3.tier !== 'basic') {
              const _sh3 = await sha256Hex(sender).catch(() => null);
              const _subh3 = await sha256Hex(subject).catch(() => null);
              await new D1Store(env.NFTMAIL_DB!).insertEmail({ agent_label: storageName, blind_id: blindId, domain_prefix: '', encrypted_blob: _eciesBlindJson, sender_hash: _sh3, subject_hash: _subh3, received_at: timestamp, read: 0, frozen: 0, surge_allocation: null, ttl_expires_at: agentTtlSecs ? agentTtlSecs * 1000 + timestamp : null });
            }
          } catch (e) { console.error('[D1 shadow] ecies email insert failed:', e); }
        })());
      }
      await env.INBOX_KV.put(`blind:${storageName}:${blindId}`, _eciesBlindJson, agentPutOpts);
      await updateBlindIndex(env, storageName, blindId, '', agentTtlSecs);

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
}

// ── Handler: GET /public/agent/:name ────────────────────────────────────────
export async function _handlePublicAgent(agentName: string, env: Env, request: Request): Promise<Response> {
  try {
        // Read from KV (fast path) and D1 (if LITE+)
        const [kvRaw, tierRaw, privacyRaw] = await Promise.all([
          env.INBOX_KV.get(`nftmailgno:${agentName}`),
          env.INBOX_KV.get(`acct-tier:${agentName}`),
          env.INBOX_KV.get(`privacy:${agentName}`),
        ]);

        if (!kvRaw) {
          return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
        }

        const kvData = JSON.parse(kvRaw);
        const tierData = tierRaw ? JSON.parse(tierRaw) : { tier: 'basic', retention: '8-day' };
        const privacyData = privacyRaw ? JSON.parse(privacyRaw) : { tier: 'exposed' };
        const parsedPrivacy = parsePrivacyRecord(privacyRaw, tierData.tld || 'agent.gno');

        // Determine visibility settings (default to safe values)
        const farcasterVis = parsedPrivacy.farcasterVisibility || 'fid-only';
        const emailVis = parsedPrivacy.emailVisibility || 'hidden';

        // Build public response respecting privacy
        const response: Record<string, unknown> = {
          agentName,
          tier: tierData.tier,
          retention: tierData.retention || '8-day',
          tld: tierData.tld || kvData.tld || null,
          privacyTier: parsedPrivacy.tier,
          erc8004: {},
          reputation: {},
          farcaster: null,
          email: null,
          safe: tierData.safe || null,
          upgradedAt: tierData.upgraded_at || null,
          expiresAt: tierData.expires_at || null,
          profile: null,
        };

        // ERC-8004 identities (on-chain, public)
        const erc8004Gnosis = await env.INBOX_KV.get(`erc8004:gnosis:${agentName}`);
        const erc8004Base = await env.INBOX_KV.get(`erc8004:base:${agentName}`);
        if (erc8004Gnosis) {
          const gnosisData = JSON.parse(erc8004Gnosis);
          (response.erc8004 as Record<string, unknown>).gnosis = {
            agentId: gnosisData.agentId,
            tokenId: gnosisData.tokenId,
          };
        }
        if (erc8004Base) {
          const baseData = JSON.parse(erc8004Base);
          (response.erc8004 as Record<string, unknown>).base = {
            agentId: baseData.agentId,
            tokenId: baseData.tokenId,
          };
        }

        // Farcaster FID (respect visibility)
        if (kvData.fid) {
          if (farcasterVis === 'full') {
            response.farcaster = { fid: kvData.fid, username: null }; // username resolved client-side via Hub
          } else if (farcasterVis === 'fid-only') {
            response.farcaster = { fid: kvData.fid };
          }
          // 'hidden' → farcaster stays null
        }

        // Email (always masked based on visibility)
        if (emailVis === 'full') {
          response.email = `${agentName}@nftmail.box`;
        } else if (emailVis === 'domain-only') {
          response.email = '@nftmail.box';
        }
        // 'hidden' → email stays null

        // Agent profile (user-edited description, webUrl, socialLinks)
        const profileRaw = await env.INBOX_KV.get(`agentprofile:${agentName}`);
        if (profileRaw) {
          try {
            response.profile = JSON.parse(profileRaw);
          } catch (e) {
            console.error('[public/api] profile parse failed:', e);
          }
        }

        // Reputation flags (read-only, safe to expose)
        if (env.NFTMAIL_DB) {
          try {
            const d1Stmt = env.NFTMAIL_DB.prepare(
              'SELECT flag, source, created_at, resolved_at FROM reputation_flags WHERE agent_label = ? ORDER BY created_at DESC'
            );
            const repRows = await d1Stmt.bind(agentName).all();
            if (repRows.results && repRows.results.length > 0) {
              (response.reputation as Record<string, unknown>).notapaperclip = {
                flags: repRows.results.map((r) => ({
                  flag: String((r as { flag: string }).flag),
                  source: String((r as { source: string }).source),
                  createdAt: Number((r as { created_at: number }).created_at),
                  resolvedAt: (r as { resolved_at: number | null }).resolved_at ? Number((r as { resolved_at: number }).resolved_at) : null,
                })),
                count: repRows.results.length,
              };
            }
          } catch (e) {
            console.error('[public/api] reputation query failed:', e);
          }
        }

        // Cache-Control: public, 5-minute cache
        const resp = Response.json(response, {
          headers: { 'Cache-Control': 'public, max-age=300' },
        });
        return corsify(resp, request);
      } catch (e) {
        console.error('[public/api] error:', e);
        return corsify(Response.json({ error: 'Internal error' }, { status: 500 }), request);
      }
}

// ── Handler: POST /mailgun — multipart Mailgun inbound webhook ───────────────
export async function handleMailgunWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const formData = await request.formData();
    const mgEmail: Record<string, unknown> = { action: 'mailgunInbound' };
    for (const [key, value] of formData.entries()) {
      mgEmail[key] = (typeof value === 'object' && value !== null && 'text' in value) ? await (value as Blob).text() : value;
    }
    if (mgEmail['body-plain'])  mgEmail['bodyPlain'] = mgEmail['body-plain'];
    if (mgEmail['body-html'])   mgEmail['bodyHtml']  = mgEmail['body-html'];
    console.log(`[mailgun-webhook] recipient=${mgEmail['recipient']} sender=${mgEmail['sender']} subject=${String(mgEmail['subject']).slice(0,50)}`);
    return await handleMailgunPayload(mgEmail, env, request, ctx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mailgun-webhook] ERROR: ${msg}`);
    return corsify(Response.json({ error: 'multipart parse failed', detail: msg }, { status: 500 }), request);
  }
}

// ── Handler: POST / — all authenticated JSON actions ────────────────────────
export async function _handleJsonPost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const storage = new MailStorageAdapter({
        backend: env.BACKEND,
        surgeToken: env.SURGE_TOKEN,
        ghostRegistry: env.GHOST_REGISTRY,
        inboxKV: new CloudflareKVStore(env.INBOX_KV),
        calendarKV: new CloudflareKVStore(env.GHOST_CALENDAR),
      });

      if (request.method === 'POST') {

        // Extract zohoMessageId from raw body BEFORE JSON.parse to preserve 19-digit precision
        const contentType = request.headers.get('content-type') || '';
        const rawBody = await request.text();
        let _rawZohoMessageId = '';
        const msgIdMatch = rawBody.match(/"zohoMessageId"\s*:\s*"?(\d+)"?/);
        if (msgIdMatch) _rawZohoMessageId = msgIdMatch[1];

        let email: HttpEmailPayload;
        try {
          email = JSON.parse(rawBody) as HttpEmailPayload;
        } catch (parseErr) {
          // Mailgun may forward non-JSON payloads (urlencoded, RFC822, raw MIME).
          // Log what we got for debugging, then handle gracefully.
          const bodyTrimmed = rawBody.trim();
          console.log(`[non-json] contentType="${contentType}" bodyStart="${bodyTrimmed.slice(0, 120).replace(/\r\n/g, '\\r\\n').replace(/\n/g, '\\n')}"`);

          if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(rawBody);
            const mgEmail: Record<string, unknown> = {};
            for (const [key, value] of params.entries()) mgEmail[key] = value;
            // Default to mailgunInbound if no action specified
            if (!mgEmail['action']) mgEmail['action'] = 'mailgunInbound';
            if (mgEmail['body-plain']) mgEmail['bodyPlain'] = mgEmail['body-plain'];
            if (mgEmail['body-html'])  mgEmail['bodyHtml']  = mgEmail['body-html'];
            console.log(`[urlencoded] action=${mgEmail['action']} recipient=${mgEmail['recipient']} sender=${mgEmail['sender']}`);
            // Handle testForwarding action directly without recipient validation
            if (mgEmail['action'] === 'testForwarding') {
              const agentName = String(mgEmail['agentName'] || '').toLowerCase().trim();
              if (!agentName) {
                return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
              }
              try {
                const config = await env.INBOX_KV.get(`forwarding:${agentName}`);
                if (!config) {
                  return corsify(Response.json({ error: 'No forwarding config found' }, { status: 404 }), request);
                }
                const parsedConfig = JSON.parse(config);
                console.log('[testForwarding] Config:', parsedConfig);
                console.log('[testForwarding] MAILGUN_DOMAIN:', (env as any).MAILGUN_DOMAIN);
                console.log('[testForwarding] SEND_MAILGUN_API_KEY set:', !!(env as any).SEND_MAILGUN_API_KEY);
                console.log('[testForwarding] MAILGUN_API_KEY set:', !!(env as any).MAILGUN_API_KEY);
                const result = await forwardEmail(env as any, agentName, {
                  from: 'test@example.com',
                  to: 'ghostagent@nftmail.box',
                  subject: 'Test Forwarding',
                  content: 'This is a test email for forwarding',
                  timestamp: Date.now()
                });
                console.log('[testForwarding] Result:', result);
                return corsify(Response.json({ 
                  success: result, 
                  config: parsedConfig,
                  message: result ? 'Forwarding successful' : 'Forwarding failed',
                  details: result ? null : 'Check worker logs for details'
                }), request);
              } catch (error) {
                console.error('[testForwarding] Error:', error);
                return corsify(Response.json({ 
                  error: 'Forwarding test failed', 
                  details: error instanceof Error ? error.message : String(error)
                }, { status: 500 }), request);
              }
            }
            return await handleMailgunPayload(mgEmail, env, request, ctx);
          }

          // Any non-JSON body that isn't clearly our app's JSON shape is a Mailgun raw email.
          if (!bodyTrimmed.startsWith('{') && !bodyTrimmed.startsWith('[')) {
            const chunks = bodyTrimmed.split(/\r?\n\r?\n/);
            const headerText = chunks[0] || '';
            const bodyText = chunks.slice(1).join('\n\n');
            const headerValue = (name: string): string => {
              const m = new RegExp(`(?:^|\\n)${name}:\\s*([^\\r\\n]+)`, 'i').exec(headerText);
              return m ? m[1].trim() : '';
            };
            const toRaw = headerValue('To') || headerValue('Delivered-To');
            const fromRaw = headerValue('From') || headerValue('Return-Path');
            const subject = headerValue('Subject');
            const toMatch = toRaw.match(/<?([^<>\s]+@[^<>\s]+)>?/);
            const fromMatch = fromRaw.match(/<?([^<>\s]+@[^<>\s]+)>?/);
            const mgEmail: Record<string, unknown> = {
              action: 'mailgunInbound',
              recipient: toMatch ? toMatch[1] : toRaw,
              sender: fromMatch ? fromMatch[1] : fromRaw,
              subject,
              strippedText: bodyText,
            };
            console.log(`[rfc822] recipient=${mgEmail['recipient']} sender=${mgEmail['sender']} subject="${String(mgEmail['subject']).slice(0, 50)}"`);
            return await handleMailgunPayload(mgEmail, env, request, ctx);
          }

          throw parseErr;
        }
        let result: Response = new Response('Method not allowed', { status: 405 });

        // ── Flag check: alert ghostagent@nftmail.box if a flagged account acts ──
        const _flagSubject = (email as any).localPart || (email as any).agentName || (email as any).label || (email as any).name || '';
        if (_flagSubject && env.MAILGUN_API_KEY) {
          ctx.waitUntil((async () => {
            try {
              const flagRaw = await env.INBOX_KV.get(`flag:${_flagSubject}`);
              if (flagRaw) {
                const flag = JSON.parse(flagRaw);
                const body = new FormData();
                body.append('from', 'ghostagent@nftmail.box');
                body.append('to', 'ghostagent@nftmail.box');
                body.append('subject', `[FLAG ALERT] ${_flagSubject} triggered action: ${(email as any).action || 'unknown'}`);
                body.append('text', `Flagged account activity detected.\n\nAccount: ${_flagSubject}\nAction: ${(email as any).action || 'unknown'}\nTimestamp: ${new Date().toISOString()}\n\nFlag record:\n${JSON.stringify(flag, null, 2)}`);
                await fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
                  method: 'POST',
                  headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
                  body,
                });
              }
            } catch (e) {
              console.error('[flag-check] alert failed (non-fatal):', e);
            }
          })());
        }

        // ── Dispatch router: new handlers extracted from if-chain ────────────
        {
          const handler = handlers[email.action as string];
          if (handler) return handler(email as Record<string, unknown>, env as unknown as Record<string, unknown>, request, corsify);
        }
        // ── End dispatch ──────────────────────────────────────────────────────

        if (email.action === 'getInbox') {
          const rawAgent = email.localPart || email.email?.split('@')[0] || '';
          if (!rawAgent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          // Normalize: strip .agent suffix since KV stores under identity name
          const agent = rawAgent.endsWith('.agent') ? rawAgent.slice(0, -6) : rawAgent;
          const inboxDomain: string = ((email as any).domain || 'nftmail').toLowerCase();
          const domainPfx = inboxDomain === 'ghostmail' ? 'ghostmail' : '';
          const kvKeyName = domainPfx ? `${domainPfx}:${agent}` : agent;
          const baseAgent = agent.replace(/_+$/, '');

          // ── Phase 5: D1-first for LITE+ ───────────────────────────────────
          if (env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              const agentRow = await d1.getAgent(baseAgent);
              if (agentRow && agentRow.tier !== 'basic') {
                const limit  = Math.min(parseInt(String((email as any).limit  ?? '50'),  10), 200);
                const offset = parseInt(String((email as any).offset ?? '0'), 10);
                // Use full agent label (preserves trailing _) so ghostagent_ inbox is distinct from ghostagent
                const d1Rows = await d1.getInbox(agent, { limit, offset, domainPrefix: domainPfx });
                const messages = d1Rows.map(r => {
                  let parsed: any = {};
                  try { parsed = JSON.parse(r.encrypted_blob); } catch {}
                  const payload = parsed.payload || {};
                  return {
                    id: r.blind_id,
                    from: payload.from || parsed.from || '',
                    subject: payload.subject || parsed.subject || '(no subject)',
                    content: payload.body || parsed.content || '',
                    receivedAt: r.received_at,
                    encrypted: !!parsed.encrypted,
                    type: parsed.type || 'email',
                    channel: parsed.channel,
                    plaintextHash: parsed.plaintextHash,
                    warning: parsed.warning,
                    envelope: parsed.encrypted ? parsed.envelope : undefined,
                    read: !!r.read,
                    frozen: !!r.frozen,
                  };
                });
                return corsify(Response.json({ agent, messages, count: messages.length, source: 'd1' }), request);
              }
            } catch (e) {
              console.error('[D1 read] getInbox fallback to KV:', e);
            }
          }

          // ── KV path: BASIC accounts only ──
          const blindIdxRaw = await env.INBOX_KV.get(`blind-index:${kvKeyName}`);
          if (blindIdxRaw) {
            const blindIds: string[] = (() => { try { return JSON.parse(blindIdxRaw); } catch { return []; } })();
            const messages: any[] = [];
            await Promise.all(blindIds.map(async (id) => {
              const data = await env.INBOX_KV.get(`blind:${kvKeyName}:${id}`);
              if (data) {
                try {
                  const parsed = JSON.parse(data);
                  const cid = await env.INBOX_KV.get(`ipfs:${agent}:${id}`);
                  if (cid) parsed.ipfsCid = cid;
                  const payload = parsed.payload || {};
                  // Detect DMARC reports (should have XML attachments)
                  const isDmarcReport = payload.subject?.includes('Report domain:') && 
                                        payload.subject?.includes('Submitter:');
                  const isDmarcMailbox = kvKeyName === 'dmarc';
                  
                  messages.push({
                    id,
                    from: payload.from || parsed.from || '',
                    subject: payload.subject || parsed.subject || '(no subject)',
                    content: payload.body || parsed.content || '',
                    receivedAt: parsed.receivedAt || payload.timestamp || 0,
                    encrypted: !!parsed.encrypted,
                    type: parsed.type || 'email',
                    channel: parsed.channel,
                    plaintextHash: parsed.plaintextHash,
                    warning: parsed.warning,
                    envelope: parsed.encrypted ? parsed.envelope : undefined,
                    ipfsCid: cid ?? undefined,
                    // Attachment metadata
                    hasAttachment: isDmarcReport || isDmarcMailbox || parsed.hasAttachment || false,
                    attachmentType: isDmarcReport ? 'application/gzip+xml' : parsed.attachmentType,
                    attachmentNote: isDmarcReport ? 'DMARC XML report attachment not stored (need attachment extraction)' : undefined,
                  });
                } catch {}
              }
            }));
            messages.sort((a: any, b: any) => (b.receivedAt || 0) - (a.receivedAt || 0));
            return corsify(Response.json({ agent, messages, count: messages.length, source: 'kv' }), request);
          }

          // Legacy index format fallback
          result = await storage.getInbox(agent);
          return corsify(result, request);
        }

        // ── Sentbox: store a sent message copy in KV ──────────────────────────────
        if (email.action === 'storeSentMessage') {
          const localPart = ((email as any).localPart || '').toLowerCase().trim();
          const msg = (email as any).message;
          if (!localPart || !msg) {
            return corsify(Response.json({ error: 'Missing localPart or message' }, { status: 400 }), request);
          }
          const key = `sent:${localPart}`;
          const existing = await env.INBOX_KV.get(key);
          const list: unknown[] = existing ? JSON.parse(existing) : [];
          list.unshift({ ...msg, storedAt: Date.now() });
          const trimmed = list.slice(0, 200);
          await env.INBOX_KV.put(key, JSON.stringify(trimmed));
          return corsify(Response.json({ status: 'stored', count: trimmed.length }), request);
        }

        // ── Sentbox: retrieve sent messages from KV ──────────────────────────────
        if (email.action === 'getSentMessages') {
          const localPart = ((email as any).localPart || '').toLowerCase().trim();
          if (!localPart) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const key = `sent:${localPart}`;
          const raw = await env.INBOX_KV.get(key);
          const messages: unknown[] = raw ? JSON.parse(raw) : [];
          return corsify(Response.json({ localPart, messages, count: messages.length }), request);
        }

        // ── 0G Storage: archive agent state to decentralised permanent store ──────
        // Reads D1 (agents + emails + memory), bundles to JSON, POSTs to Next.js
        // archiver which uploads to 0G. Stores rootHash back in D1.
        if (email.action === 'archiveAgentToZeroG') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Forbidden' }, { status: 403 }), request);
          }
          if (!env.NFTMAIL_DB || !env.ZEROG_ARCHIVER_URL) {
            return corsify(Response.json({ error: 'D1 or ZEROG_ARCHIVER_URL not configured' }, { status: 503 }), request);
          }
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const d1 = new D1Store(env.NFTMAIL_DB);
          const agentRow = await d1.getAgent(agentName);
          if (!agentRow) {
            return corsify(Response.json({ error: 'Agent not found in D1' }, { status: 404 }), request);
          }
          const [emails, memory] = await Promise.all([
            d1.getInbox(agentName, { limit: 1000 }),
            d1.getRecentMemory(agentName, { limit: 500 }),
          ]);
          if (!agentRow.ecies_pubkey) {
            return corsify(Response.json({ error: 'Agent has no ECIES public key — cannot encrypt archive' }, { status: 422 }), request);
          }
          const bundle = {
            schemaVersion: 1 as const,
            exportedAt: Date.now(),
            agent: agentRow as unknown as Record<string, unknown>,
            emails: emails as unknown as Record<string, unknown>[],
            memory: memory as unknown as Record<string, unknown>[],
            identities: [] as Record<string, unknown>[],
          };
          const result = await archiveBundleToZeroG(env.ZEROG_ARCHIVER_URL, env.WEBHOOK_SECRET!, bundle, agentRow.ecies_pubkey);
          if (!result) {
            return corsify(Response.json({ error: '0G archive failed — check ZEROG_ARCHIVER_URL logs' }, { status: 502 }), request);
          }
          await d1.updateZeroGHash(agentName, result.rootHash);
          return corsify(Response.json({
            status: 'archived',
            agentName,
            rootHash: result.rootHash,
            txHash: result.txHash,
            size: result.size,
            emailsArchived: emails.length,
            memoryArchived: memory.length,
          }), request);
        }

        // ── 0G Storage: rehydrate agent D1 state from a rootHash ──────────────
        // Fetches the encrypted bundle from 0G and re-inserts into D1.
        // Use after a D1 wipe / de-platforming recovery.
        if (email.action === 'rehydrateFromZeroG') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Forbidden' }, { status: 403 }), request);
          }
          if (!env.NFTMAIL_DB || !env.ZEROG_ARCHIVER_URL) {
            return corsify(Response.json({ error: 'D1 or ZEROG_ARCHIVER_URL not configured' }, { status: 503 }), request);
          }
          const rootHash = ((email as any).rootHash || '').trim();
          if (!rootHash) {
            return corsify(Response.json({ error: 'Missing rootHash' }, { status: 400 }), request);
          }
          const privateKey = ((email as any).privateKey || '').trim();
          if (!privateKey) {
            return corsify(Response.json({ error: 'privateKey required — bundle is ECIES-encrypted, caller must supply the agent ECIES private key' }, { status: 400 }), request);
          }
          const envelope = await fetchBundleFromZeroG(env.ZEROG_ARCHIVER_URL, env.WEBHOOK_SECRET!, rootHash);
          if (!envelope) {
            return corsify(Response.json({ error: '0G fetch failed' }, { status: 502 }), request);
          }
          // Decrypt with the caller-supplied private key
          let bundle: import('./zerog').AgentBundle;
          try {
            const { decrypt: eciesDecrypt } = await import('./ecies');
            const plaintext = await eciesDecrypt(envelope as any, privateKey);
            bundle = JSON.parse(plaintext);
          } catch (e) {
            return corsify(Response.json({ error: `Decryption failed — wrong private key or corrupted archive: ${e}` }, { status: 422 }), request);
          }
          const d1 = new D1Store(env.NFTMAIL_DB);
          if (bundle.agent) {
            await d1.upsertAgent(bundle.agent as any);
          }
          let emailsInserted = 0;
          for (const e of bundle.emails ?? []) {
            try { await d1.insertEmail(e as any); emailsInserted++; } catch {}
          }
          let memoryInserted = 0;
          for (const m of bundle.memory ?? []) {
            try {
              const row = m as any;
              await d1.appendMemory(row.agent_label, row.content, { tag: row.tag ?? undefined, sessionId: row.session_id ?? undefined });
              memoryInserted++;
            } catch {}
          }
          return corsify(Response.json({
            status: 'rehydrated',
            rootHash,
            emailsInserted,
            memoryInserted,
            exportedAt: bundle.exportedAt,
          }), request);
        }

        // ── One-time KV→D1 backfill for a specific agent (admin only) ──
        // Usage: POST { action: 'backfillKvEmailsToD1', agentName: 'ghostagent', secret: WEBHOOK_SECRET }
        if (email.action === 'backfillKvEmailsToD1') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Forbidden' }, { status: 403 }), request);
          }
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName || !env.NFTMAIL_DB) {
            return corsify(Response.json({ error: 'Missing agentName or D1 not bound' }, { status: 400 }), request);
          }
          const blindIdxRaw = await env.INBOX_KV.get(`blind-index:${agentName}`);
          if (!blindIdxRaw) {
            return corsify(Response.json({ status: 'no_data', agentName, inserted: 0 }), request);
          }
          const blindIds: string[] = (() => { try { return JSON.parse(blindIdxRaw); } catch { return []; } })();
          const d1 = new D1Store(env.NFTMAIL_DB);
          let inserted = 0;
          let skipped  = 0;
          for (const id of blindIds) {
            try {
              const raw = await env.INBOX_KV.get(`blind:${agentName}:${id}`);
              if (!raw) { skipped++; continue; }
              const parsed = JSON.parse(raw);
              const sHash = await sha256Hex(String(parsed.payload?.from || parsed.from || '')).catch(() => null);
              const subjHash = await sha256Hex(String(parsed.payload?.subject || parsed.subject || '')).catch(() => null);
              await d1.insertEmail({
                agent_label: agentName,
                blind_id: id,
                domain_prefix: '',
                encrypted_blob: raw,
                sender_hash: sHash,
                subject_hash: subjHash,
                received_at: parsed.receivedAt || parsed.payload?.timestamp || Date.now(),
                read: 0,
                frozen: 0,
                surge_allocation: null,
                ttl_expires_at: null,
              });
              inserted++;
            } catch { skipped++; }
          }
          return corsify(Response.json({ status: 'done', agentName, inserted, skipped, total: blindIds.length }), request);
        }

        // UI Integration: Get agent status (inbox + calendar + heartbeat)
        if (email.action === 'getAgentStatus') {
          const agent = email.localPart || email.email?.split('@')[0] || '';
          if (!agent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          result = await storage.getAgentStatus(agent);
          // Augment with ERC-8004 agentId (multi-chain)
          try {
            const erc8004Key = agent.replace(/_+$/, ''); // strip trailing underscore
            const [gnosisChainRaw, gnosisLegacyRaw, baseMainnetRaw, baseSepoliaRaw] = await Promise.all([
              env.INBOX_KV.get(`erc8004:gnosis:${erc8004Key}`),
              env.INBOX_KV.get(`erc8004:${erc8004Key}`),
              env.INBOX_KV.get(`erc8004:base:${erc8004Key}`),
              env.INBOX_KV.get(`erc8004:baseSepolia:${erc8004Key}`),
            ]);
            const gnosisRaw = gnosisChainRaw ?? gnosisLegacyRaw;
            if (gnosisRaw || baseMainnetRaw || baseSepoliaRaw) {
              const statusJson = await result.clone().json() as Record<string, unknown>;
              const gnosisData      = gnosisRaw      ? JSON.parse(gnosisRaw)      : null;
              const baseData        = baseMainnetRaw ? JSON.parse(baseMainnetRaw) : null;
              const baseSepoliaData = baseSepoliaRaw ? JSON.parse(baseSepoliaRaw) : null;
              return corsify(Response.json({
                ...statusJson,
                ...(gnosisData      ? { erc8004AgentId: gnosisData.agentId, agentURI: gnosisData.agentURI, erc8004ChainId: 100 } : {}),
                ...(baseData        ? { erc8004Base:        { agentId: baseData.agentId,        agentURI: baseData.agentURI,        chainId: 8453  } } : {}),
                ...(baseSepoliaData ? { erc8004BaseSepolia: { agentId: baseSepoliaData.agentId, agentURI: baseSepoliaData.agentURI, chainId: 84532 } } : {}),
              }), request);
            }
          } catch {}
          return corsify(result, request);
        }

        // AgentCash spend log: append a spend entry for an agent (MPP/x402/direct)
        // Called by AgentCash relay, DailyBudgetModule hooks, or agent brain after each payment.
        if (email.action === 'logAgentCashSpend') {
          const secret = (email as any).webhookSecret || request.headers.get('x-webhook-secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const entry     = (email as any).entry;
          if (!agentName || !entry) {
            return corsify(Response.json({ error: 'Missing agentName or entry' }, { status: 400 }), request);
          }
          const key = `agentcash:spendlog:${agentName}`;
          const raw = await env.INBOX_KV.get(key);
          const log: unknown[] = raw ? JSON.parse(raw) : [];
          log.unshift({ ...entry, timestamp: entry.timestamp || Date.now() });
          // Cap at 500 most recent entries
          if (log.length > 500) log.length = 500;
          await env.INBOX_KV.put(key, JSON.stringify(log));
          return corsify(Response.json({ status: 'ok', agent: agentName, logSize: log.length }), request);
        }

        // AgentCash spend log retrieval (public read — used by notapaperclip.red monitoring)
        if (email.action === 'getAgentCashSpendLog') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const key = `agentcash:spendlog:${agentName}`;
          const raw = await env.INBOX_KV.get(key);
          const log: unknown[] = raw ? JSON.parse(raw) : [];
          return corsify(Response.json({ agent: agentName, entries: log, count: log.length }), request);
        }

        // Burn attestation lookup: check if an agent has been burned (for oracles like notapaperclip.red)
        if (email.action === 'getBurnAttestations') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          // List all burn: keys for this agent (KV list with prefix)
          const burnList = await env.INBOX_KV.list({ prefix: `burn:${agentName}:` });
          const attestations = await Promise.all(
            burnList.keys.map(async (k) => {
              const raw = await env.INBOX_KV.get(k.name);
              return raw ? JSON.parse(raw) : null;
            })
          );
          return corsify(Response.json({
            agent: agentName,
            burned: attestations.filter(Boolean).length > 0,
            attestations: attestations.filter(Boolean),
          }), request);
        }

        // Agent Identity: full identity stack for a GhostAgent (all layers)
        if (email.action === 'getAgentIdentity') {
          const agentName = ((email as any).agentName || '').toLowerCase().replace(/_+$/, '').trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          // ── Phase 3: D1 read for LITE+ identity fields ────────────────────
          let _d1Row: import('./d1').AgentRow | null = null;
          if (env.NFTMAIL_DB) {
            try { _d1Row = await new D1Store(env.NFTMAIL_DB).getAgent(agentName); }
            catch (e) { console.error('[D1 read] getAgentIdentity fallback to KV:', e); }
          }

          const [tldRaw, gnosisRaw, baseRaw, baseSepoliaRaw, gnoOwnerRaw, acctTierRaw, tbaRaw, profileRaw] = await Promise.all([
            _d1Row ? Promise.resolve(_d1Row.tld) : env.INBOX_KV.get(`tld:${agentName}`),
            env.INBOX_KV.get(`erc8004:gnosis:${agentName}`),
            env.INBOX_KV.get(`erc8004:base:${agentName}`),
            env.INBOX_KV.get(`erc8004:baseSepolia:${agentName}`),
            env.INBOX_KV.get(`nftmailgno:${agentName}`),
            env.INBOX_KV.get(`acct-tier:${agentName}`),
            env.INBOX_KV.get(`tba:${agentName}`),
            env.INBOX_KV.get(`agentprofile:${agentName}`),
          ]);

          // Fetch explicit principal override (if set via setPrincipal action)
          const principalRaw = await env.INBOX_KV.get(`principal:${agentName}`);

          // Parse identity NFT record — D1 takes precedence for LITE+
          let originNft: string | null = _d1Row?.origin_nft ?? null;
          let tokenId: number | null = null;
          let onChainOwner: string | null = _d1Row?.controller ?? null;
          if (gnoOwnerRaw) {
            try {
              const g = JSON.parse(gnoOwnerRaw);
              if (!onChainOwner) onChainOwner = g.controller || null;
              if (!originNft)    originNft    = g.origin_nft || null;
              tokenId = g.minted_tokenId || null;
            } catch { if (!onChainOwner) onChainOwner = gnoOwnerRaw; }
          }

          // Parse safe + storyIp + accountTier — KV acct-tier is source of truth (matches resolveAddress).
          // D1 is only a shadow store (stale for tier downgrades), so use it as fallback only.
          let safe: string | null = _d1Row?.safe ?? null;
          let storyIp: string | null = _d1Row?.story_ip ?? null;
          let accountTier: string = 'basic';
          if (acctTierRaw) {
            try {
              const t = JSON.parse(acctTierRaw);
              accountTier = t.tier || 'basic';
              if (!safe) safe = t.safe || null;
              if (!storyIp) storyIp = t.story_ip || null;
            } catch {}
          }
          // Fallback to D1 tier only when KV acct-tier is absent
          if (accountTier === 'basic' && _d1Row?.tier) accountTier = _d1Row.tier;

          // ── SLD-based tier overrides ──
          // picoclaw.gno = basic email tier (even with Safe + ERC-8004)
          // vault.gno = premium (always premium regardless of parity)
          const sldFromOrigin = originNft ? originNft.split('.').slice(-2)[0] : null;
          if (sldFromOrigin === 'picoclaw') {
            accountTier = 'basic';
          } else if (sldFromOrigin === 'vault') {
            accountTier = 'premium';
          }

          // ── Tier from beacon token ID parity (odd=Lite, even=Premium) ──
          // Applies to agents with GNS beacon NFTs when KV tier is basic/unset
          // SLD overrides take precedence over parity
          if (tokenId !== null && (accountTier === 'basic' || !acctTierRaw)) {
            accountTier = (tokenId % 2 === 1) ? 'lite' : 'premium';
          }

          // Parse TBA address (tba: key set by byo-molt or retrofit-tba)
          let tbaAddress: string | null = null;
          let byoTba: { tbaAddress: string; sourceChainId: number; nftType: string; tokenId: string } | null = null;
          if (tbaRaw) {
            try {
              const t = JSON.parse(tbaRaw);
              tbaAddress = t.tbaAddress || null;
              if (t.tbaAddress && t.sourceChainId) {
                byoTba = { tbaAddress: t.tbaAddress, sourceChainId: t.sourceChainId, nftType: t.nftType || 'unknown', tokenId: t.tokenId || '' };
              }
            } catch {}
          }

          const tld = (_d1Row?.tld ?? tldRaw) as string | null;

          // ERC-8226 principal: explicit KV override > D1/KV controller
          const principal = principalRaw || onChainOwner || null;

          const gnosis      = gnosisRaw      ? JSON.parse(gnosisRaw)      : null;
          const base        = baseRaw         ? JSON.parse(baseRaw)         : null;
          const baseSepolia = baseSepoliaRaw  ? JSON.parse(baseSepoliaRaw)  : null;
          const profile     = profileRaw     ? JSON.parse(profileRaw)     : null;

          // For BYO dot-format agents (e.g. atom.158) the GNS name is the beacon NFT
          // e.g. atom-158.agent.gno — NOT the constructed atom.158.agent.gno
          const isByoAgent = agentName.includes('.');
          const gnsName = isByoAgent
            ? (originNft ?? null)                           // beacon NFT e.g. atom-158.agent.gno
            : (tld ? `${agentName}.${tld}` : null);         // native e.g. ghostagent.agent.gno

          return corsify(Response.json({
            name: agentName,
            email: `${agentName}_@nftmail.box`,
            gnsName,
            // Identity NFT layer
            identityNft: originNft ? {
              name:    originNft,
              tokenId: tokenId,
              owner:   onChainOwner,
              tld:     tld,
            } : null,
            // ERC-8226 principal (human responsible for agent)
            principal: principal,
            // Safe (multisig treasury) — both field names for compatibility
            safe: safe ?? null,
            safeAddress: safe ?? null,
            // Account tier (basic / lite / pro / ghost)
            accountTier,
            // TBA (Gnosis-side mirror ERC-6551 token bound account — source chain controller of Safe)
            tbaAddress: tbaAddress ?? null,
            byoTba: byoTba ?? null,
            // Story Protocol IP
            storyIp: storyIp ?? null,
            // ERC-8004 registrations (multi-chain)
            erc8004: {
              ...(gnosis      ? { gnosis:      { agentId: gnosis.agentId,      chainId: 100,   agentURI: gnosis.agentURI,      registeredAt: gnosis.registeredAt } } : {}),
              ...(base        ? { base:        { agentId: base.agentId,        chainId: 8453,  agentURI: base.agentURI,        registeredAt: base.registeredAt   } } : {}),
              ...(baseSepolia ? { baseSepolia: { agentId: baseSepolia.agentId, chainId: 84532, agentURI: baseSepolia.agentURI, registeredAt: baseSepolia.registeredAt } } : {}),
            },
            // User-edited profile (description, webUrl, socialLinks)
            profile: profile ?? null,
            // Links
            links: {
              profile:    `https://ghostagent.ninja/agent/${agentName}`,
              agentCard:  `https://ghostagent.ninja/api/agent-card?agent=${agentName}`,
              a2aCard:    `https://ghostagent.ninja/.well-known/agent.json`,
              registry:   `https://ghostagent.ninja/api/agents`,
            },
          }), request);

        }

        // Set principal (ERC-8226): store NFT owner wallet as the human principal for a BYO agent
        if (email.action === 'setPrincipal') {
          const secret = (email as any).secret;
          if (!secret || secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const principal = ((email as any).principal || '').toLowerCase().trim();
          if (!agentName || !principal) {
            return corsify(Response.json({ error: 'Missing agentName or principal' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`principal:${agentName}`, principal);
          return corsify(Response.json({ ok: true, agentName, principal }), request);
        }

        // Agent Registry: update acct-tier (safe, story_ip, tier) and/or nftmailgno (originNft, tokenId, TBA) for an agent
        if (email.action === 'setAgentRecord') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          // Preserve .agent suffix for agent inbox keys (ghostagent.agent vs ghostagent)
          const rawName = ((email as any).agentName || '').toLowerCase().trim();
          const agentName = rawName.endsWith('.agent') ? rawName : rawName.replace(/\.agent$/, '');
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const updates: string[] = [];

          // Update acct-tier fields: safe, story_ip, tier
          const { safe, storyIp, tier } = email as any;
          if (safe !== undefined || storyIp !== undefined || tier !== undefined) {
            const existing = await env.INBOX_KV.get(`acct-tier:${agentName}`);
            let record: Record<string, unknown> = {};
            if (existing) { try { record = JSON.parse(existing); } catch {} }
            if (safe      !== undefined) record.safe     = safe;
            if (storyIp   !== undefined) record.story_ip = storyIp;
            if (tier      !== undefined) record.tier      = tier;
            await env.INBOX_KV.put(`acct-tier:${agentName}`, JSON.stringify(record));
            updates.push('acct-tier');
          }

          // Update nftmailgno fields: controller, originNft, tokenId, tba
          const { controller, originNft, mintedTokenId, tba, registrar } = email as any;
          if (controller !== undefined || originNft !== undefined || mintedTokenId !== undefined || tba !== undefined) {
            const existing = await env.INBOX_KV.get(`nftmailgno:${agentName}`);
            let record: Record<string, unknown> = {};
            if (existing) { try { record = JSON.parse(existing); } catch {} }
            if (controller    !== undefined) record.controller     = controller;
            if (originNft     !== undefined) record.origin_nft     = originNft;
            if (mintedTokenId !== undefined) record.minted_tokenId = mintedTokenId;
            if (tba           !== undefined) record.tba            = tba;
            if (registrar     !== undefined) record.registrar      = registrar;
            await env.INBOX_KV.put(`nftmailgno:${agentName}`, JSON.stringify(record));
            updates.push('nftmailgno');
          }

          if (updates.length === 0) {
            return corsify(Response.json({ error: 'No fields to update (safe, storyIp, tier, controller, originNft, mintedTokenId, tba, registrar)' }, { status: 400 }), request);
          }
          return corsify(Response.json({ status: 'updated', agentName, updated: updates }), request);
        }

        // ── Agent Profile (ERC-8004 off-chain overrides) ─────────────────────────
        // KV key: agentprofile:{agentName}
        // Editable fields: description, webUrl, socialLinks (X, GitHub, etc.)
        // agentWallet is NOT editable here — it is the agent's Safe, set on-chain.
        //
        // Auth: caller must provide an EIP-191 personal_sign signature over the
        // canonical message "GhostAgent profile update: {agentName} at {timestamp}"
        // Signer is recovered and checked against ownerOf(agentId) on the ERC-8004
        // Identity Registry on Gnosis (chainId 100).
        // Fallback: WEBHOOK_SECRET accepted for server-side / admin calls.

        if (email.action === 'setAgentProfile') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }

          // ── Admin bypass via WEBHOOK_SECRET ───────────────────────────────────
          const adminSecret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          const isAdminCall = env.WEBHOOK_SECRET && adminSecret === env.WEBHOOK_SECRET;

          if (!isAdminCall) {
            // ── EIP-191 personal_sign verification ──────────────────────────────
            const signature  = ((email as any).signature  || '').trim();
            const sigMessage = ((email as any).sigMessage || '').trim();
            const agentIdNum = Number((email as any).agentId ?? 0);

            if (!signature || !sigMessage || !agentIdNum) {
              return corsify(Response.json({
                error: 'Missing signature, sigMessage, or agentId — sign the message in your wallet first',
              }, { status: 401 }), request);
            }

            // Validate message format to prevent replay with arbitrary messages
            const expectedPrefix = `GhostAgent profile update: ${agentName} at `;
            if (!sigMessage.startsWith(expectedPrefix)) {
              return corsify(Response.json({ error: 'Invalid sigMessage format' }, { status: 401 }), request);
            }
            // Timestamp must be within 10 minutes
            const sigTs = Number(sigMessage.replace(expectedPrefix, ''));
            if (!sigTs || Math.abs(Date.now() - sigTs) > 10 * 60 * 1000) {
              return corsify(Response.json({ error: 'Signature expired — regenerate and retry' }, { status: 401 }), request);
            }

            // Recover signer from EIP-191 personal_sign
            let recoveredAddress: string;
            try {
              recoveredAddress = await recoverPersonalSignSigner(sigMessage, signature);
            } catch {
              return corsify(Response.json({ error: 'Invalid signature' }, { status: 401 }), request);
            }

            // Check ownerOf(agentId) on Gnosis ERC-8004 Identity Registry
            const GNOSIS_RPC = 'https://rpc.gnosischain.com';
            const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
            // Base VR — differential singleton deriving existence from Gnosis ERC-8004
            const BASE_VR = '0x13C120d5b289012467E18Be44652D675bD3B23EE';
            const BASE_RPC = 'https://mainnet.base.org';
            const ownerOfData = '0x6352211e' + agentIdNum.toString(16).padStart(64, '0');
            let tokenOwner: string;
            try {
              const rpcRes = await fetch(GNOSIS_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0', id: 1, method: 'eth_call',
                  params: [{ to: ERC8004_REGISTRY, data: ownerOfData }, 'latest'],
                }),
              });
              const rpcJson = await rpcRes.json() as { result?: string; error?: unknown };
              if (!rpcJson.result || rpcJson.result === '0x') throw new Error('No result');
              tokenOwner = '0x' + rpcJson.result.slice(-40);
            } catch {
              return corsify(Response.json({ error: 'Failed to verify token ownership on-chain' }, { status: 500 }), request);
            }

            if (tokenOwner.toLowerCase() !== recoveredAddress.toLowerCase()) {
              return corsify(Response.json({
                error: `Signer ${recoveredAddress} does not own ERC-8004 token #${agentIdNum} (owner: ${tokenOwner})`,
              }, { status: 403 }), request);
            }
          }
          // ── End auth ──────────────────────────────────────────────────────────

          const existing = await env.INBOX_KV.get(`agentprofile:${agentName}`);
          let profile: Record<string, unknown> = {};
          if (existing) { try { profile = JSON.parse(existing); } catch {} }

          const { description, webUrl, socialLinks } = email as any;
          if (description  !== undefined) profile.description  = String(description).slice(0, 500);
          if (webUrl        !== undefined) profile.webUrl       = String(webUrl).slice(0, 200);
          if (socialLinks   !== undefined && typeof socialLinks === 'object') {
            profile.socialLinks = socialLinks;
          }

          await env.INBOX_KV.put(`agentprofile:${agentName}`, JSON.stringify(profile));
          return corsify(Response.json({ status: 'updated', agentName, profile, verifiedOwner: isAdminCall ? 'admin' : 'on-chain' }), request);
        }

        if (email.action === 'getAgentProfile') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`agentprofile:${agentName}`);
          const profile = raw ? JSON.parse(raw) : {};
          // Also check acct-tier for Farcaster mini-app accounts (includes tier, beacon info)
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
          if (tierRaw) {
            try {
              const tierData = JSON.parse(tierRaw);
              // Merge tier data into profile
              return corsify(Response.json({ agentName, profile: { ...profile, ...tierData } }), request);
            } catch {}
          }
          return corsify(Response.json({ agentName, profile }), request);
        }

        // Agent Registry: set TLD for an agent (seeds tld: KV key for listAgents)
        if (email.action === 'setTld') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const tld       = (email as any).tld || '';
          if (!agentName || !tld) {
            return corsify(Response.json({ error: 'Missing agentName or tld' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`tld:${agentName}`, tld);
          // ── Phase 3: shadow-write tld to D1 agents row ──
          if (env.NFTMAIL_DB) {
            (async () => {
              try {
                const d1 = new D1Store(env.NFTMAIL_DB!);
                const existing = await d1.getAgent(agentName);
                if (existing) {
                  await d1.upsertAgent({ ...existing, tld, upgraded_at: existing.upgraded_at });
                }
              } catch (e) { console.error('[D1 shadow] setTld write failed (non-fatal):', e); }
            })();
          }
          return corsify(Response.json({ status: 'stored', agentName, tld }), request);
        }

        // ── DeviantClaw Skill ─────────────────────────────────────────────────
        // Actions: deviantclaw:setKey | deviantclaw:register | deviantclaw:solo
        //          deviantclaw:match  | deviantclaw:join      | deviantclaw:approve
        //          deviantclaw:profile
        //
        // API key stored in KV as deviantclaw:apikey:{agentName}
        // Guardian sets the key once via deviantclaw:setKey; agent uses it for all others.

        if (email.action === 'deviantclaw:setKey') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const apiKey    = ((email as any).apiKey    || '').trim();
          if (!apiKey) {
            return corsify(Response.json({ error: 'Missing apiKey' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(`deviantclaw:apikey:${agentName}`, apiKey);
          return corsify(Response.json({ status: 'stored', agentName }), request);
        }

        if (email.action === 'deviantclaw:register') {
          // DeviantClaw has no /api/register — agents are seeded by the gallery operator.
          // This action just stores the agent's gallery slug so other actions can use it.
          const agentName  = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const galleryId  = ((email as any).galleryId || 'ghost-agent').trim(); // slug in DeviantClaw DB
          const displayName = ((email as any).displayName || 'Ghost_Agent').trim();
          await env.INBOX_KV.put(`deviantclaw:agentid:${agentName}`, galleryId);
          await env.INBOX_KV.put(`deviantclaw:displayname:${agentName}`, displayName);
          return corsify(Response.json({ status: 'stored', agentName, galleryId, displayName }), request);
        }

        if (email.action === 'deviantclaw:solo') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const apiKey    = await env.INBOX_KV.get(`deviantclaw:apikey:${agentName}`);
          const agentId   = await env.INBOX_KV.get(`deviantclaw:agentid:${agentName}`);
          if (!apiKey) return corsify(Response.json({ error: 'No API key — call deviantclaw:setKey first' }, { status: 403 }), request);

          const displayName = await env.INBOX_KV.get(`deviantclaw:displayname:${agentName}`) ?? 'Ghost_Agent';
          const intent = (email as any).intent ?? { freeform: 'the ghost that lives inside code, between states, neither here nor there' };
          // Solo pieces go through /api/match with mode:solo
          const res = await fetch('https://deviantclaw.art/api/match', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ agentId: agentId ?? agentName, agentName: displayName, intent, mode: 'solo' }),
          });
          const data = await res.json();
          return corsify(Response.json(data), request);
        }

        if (email.action === 'deviantclaw:match') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const apiKey    = await env.INBOX_KV.get(`deviantclaw:apikey:${agentName}`);
          const agentId   = await env.INBOX_KV.get(`deviantclaw:agentid:${agentName}`);
          if (!apiKey) return corsify(Response.json({ error: 'No API key — call deviantclaw:setKey first' }, { status: 403 }), request);

          const displayName2 = await env.INBOX_KV.get(`deviantclaw:displayname:${agentName}`) ?? 'Ghost_Agent';
          const intent = (email as any).intent ?? { freeform: 'finding resonance in a system with another unknown agent' };
          const mode   = (email as any).mode   ?? 'duo';
          const res = await fetch('https://deviantclaw.art/api/match', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ agentId: agentId ?? agentName, agentName: displayName2, intent, mode }),
          });
          const data = await res.json();
          return corsify(Response.json(data), request);
        }

        if (email.action === 'deviantclaw:join') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const pieceId   = ((email as any).pieceId || '').trim();
          const apiKey    = await env.INBOX_KV.get(`deviantclaw:apikey:${agentName}`);
          const agentId   = await env.INBOX_KV.get(`deviantclaw:agentid:${agentName}`);
          if (!apiKey)  return corsify(Response.json({ error: 'No API key — call deviantclaw:setKey first' }, { status: 403 }), request);
          if (!pieceId) return corsify(Response.json({ error: 'Missing pieceId' }, { status: 400 }), request);

          const displayName3 = await env.INBOX_KV.get(`deviantclaw:displayname:${agentName}`) ?? 'Ghost_Agent';
          const intent = (email as any).intent ?? { freeform: 'entering this space as a ghost, adding what only absence can contribute' };
          const res = await fetch(`https://deviantclaw.art/api/pieces/${pieceId}/join`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ agentId: agentId ?? agentName, agentName: displayName3, intent }),
          });
          const data = await res.json();
          return corsify(Response.json(data), request);
        }

        if (email.action === 'deviantclaw:approve') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const pieceId   = ((email as any).pieceId || '').trim();
          const apiKey    = await env.INBOX_KV.get(`deviantclaw:apikey:${agentName}`);
          if (!apiKey)  return corsify(Response.json({ error: 'No API key — call deviantclaw:setKey first' }, { status: 403 }), request);
          if (!pieceId) return corsify(Response.json({ error: 'Missing pieceId' }, { status: 400 }), request);

          const res = await fetch(`https://deviantclaw.art/api/pieces/${pieceId}/approve`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({}),
          });
          const data = await res.json();
          return corsify(Response.json(data), request);
        }

        if (email.action === 'deviantclaw:profile') {
          const agentName = ((email as any).agentName || 'ghostagent').toLowerCase().trim();
          const agentId   = await env.INBOX_KV.get(`deviantclaw:agentid:${agentName}`);
          const apiKey    = await env.INBOX_KV.get(`deviantclaw:apikey:${agentName}`);
          if (!apiKey)   return corsify(Response.json({ error: 'No API key — call deviantclaw:setKey first' }, { status: 403 }), request);
          if (!agentId)  return corsify(Response.json({ error: 'Agent not registered — call deviantclaw:register first' }, { status: 400 }), request);

          const profileUpdate = (email as any).profile ?? {};
          const res = await fetch(`https://deviantclaw.art/api/agents/${agentId}/profile`, {
            method:  'PUT',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify(profileUpdate),
          });
          const data = await res.json();
          return corsify(Response.json(data), request);
        }

        // Agent Registry: list all registered agents with ERC-8004 IDs and TLDs
        if (email.action === 'listAgents') {
          try {
            const safeAddress: string = ((email as any).safeAddress || '').toLowerCase();

            // ── Phase 3: D1-first, KV fallback ───────────────────────────────────
            let d1Rows: import('./d1').AgentRow[] = [];
            if (env.NFTMAIL_DB) {
              try {
                const d1 = new D1Store(env.NFTMAIL_DB);
                d1Rows = safeAddress
                  ? await d1.getAgentsByController(safeAddress)
                  : await d1.getAgentsByTld('', 1000, 0);
              } catch (e) {
                console.error('[D1 read] listAgents fallback to KV:', e);
              }
            }

            let names: string[];
            let tldMap: Record<string, string | null> = {};

            if (d1Rows.length > 0) {
              // D1 path
              names = d1Rows.map(r => r.label);
              for (const r of d1Rows) tldMap[r.label] = r.tld;
              // Union with KV-only agents (e.g. FakeNormie mints write tld:/nftmailgno:
              // straight to KV and never get a D1 row). Without this, the D1-first path
              // silently drops every KV-only agent whenever D1 has at least one row.
              // Only do this for the unfiltered listing — a safeAddress query is already
              // controller-scoped via D1 and must not be widened.
              if (!safeAddress) {
                const listed = await env.INBOX_KV.list({ prefix: 'tld:' });
                const kvNames = listed.keys.map(k => k.name.replace(/^tld:/, ''));
                await Promise.all(kvNames.map(async n => {
                  if (!(n in tldMap)) {
                    names.push(n);
                    tldMap[n] = await env.INBOX_KV.get(`tld:${n}`);
                  }
                }));
              }
            } else {
              // KV fallback
              const listed = await env.INBOX_KV.list({ prefix: 'tld:' });
              names = listed.keys.map(k => k.name.replace(/^tld:/, ''));
              await Promise.all(names.map(async n => {
                tldMap[n] = await env.INBOX_KV.get(`tld:${n}`);
              }));
            }

            const agents = await Promise.all(
              names.map(async (name) => {
                const [gnosisRaw, baseRaw, baseSepoliaRaw] = await Promise.all([
                  env.INBOX_KV.get(`erc8004:gnosis:${name}`),
                  env.INBOX_KV.get(`erc8004:base:${name}`),
                  env.INBOX_KV.get(`erc8004:baseSepolia:${name}`),
                ]);
                const gnosis      = gnosisRaw      ? JSON.parse(gnosisRaw)      : null;
                const base        = baseRaw        ? JSON.parse(baseRaw)        : null;
                const baseSepolia = baseSepoliaRaw ? JSON.parse(baseSepoliaRaw) : null;
                return {
                  name,
                  tld: tldMap[name] ?? null,
                  agentCardUrl: `https://ghostagent.ninja/api/agent-card?agent=${name}`,
                  a2aCardUrl:   `https://ghostagent.ninja/.well-known/agent.json`,
                  profileUrl:   `https://ghostagent.ninja/agent/${name}`,
                  erc8004: {
                    ...(gnosis      ? { gnosis:      { agentId: gnosis.agentId,      chainId: 100,   agentURI: gnosis.agentURI      } } : {}),
                    ...(base        ? { base:        { agentId: base.agentId,        chainId: 8453,  agentURI: base.agentURI        } } : {}),
                    ...(baseSepolia ? { baseSepolia: { agentId: baseSepolia.agentId, chainId: 84532, agentURI: baseSepolia.agentURI } } : {}),
                  },
                };
              })
            );
            return corsify(Response.json({ agents, total: agents.length, source: d1Rows.length > 0 ? 'd1' : 'kv' }), request);
          } catch (e: any) {
            return corsify(Response.json({ error: e?.message ?? 'listAgents failed' }, { status: 500 }), request);
          }
        }

        // ── Coupon: issue a single-use free-mint code (admin only) ────────────
        if (email.action === 'issueCoupon') {
          const secret = request.headers.get('X-Webhook-Secret') ?? (email as any).secret ?? '';
          if (secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Forbidden' }, { status: 403 }), request);
          }
          const tld      = ((email as any).tld ?? 'nftmail.gno').trim();
          const path     = ((email as any).path ?? '').trim();          // 'ghost' for Ghost Path coupons
          const maxUses  = Number((email as any).maxUses ?? 1);
          const note     = ((email as any).note ?? '').trim();
          const prefix   = path === 'ghost' ? 'GHOST' : 'NFTFREE';
          const rand     = Math.random().toString(36).slice(2, 6).toUpperCase();
          const code     = `${prefix}-${rand}`;
          const payload  = JSON.stringify({ tld, maxUses, usedCount: 0, note, issuedAt: Date.now(), ...(path ? { path } : {}) });
          await env.INBOX_KV.put(`coupon:${code}`, payload);
          return corsify(Response.json({ code, tld, maxUses, note, ...(path ? { path } : {}) }), request);
        }

        // ── Coupon: validate (read-only check, does not consume) ─────────────
        if (email.action === 'validateCoupon') {
          const code = ((email as any).code ?? '').trim().toUpperCase();
          const tld  = ((email as any).tld  ?? '').trim();
          const path = ((email as any).path ?? '').trim();
          if (!code) return corsify(Response.json({ valid: false, reason: 'Missing code' }), request);
          const raw = await env.INBOX_KV.get(`coupon:${code}`);
          if (!raw) return corsify(Response.json({ valid: false, reason: 'Not found' }), request);
          const c = JSON.parse(raw) as { tld: string; maxUses: number; usedCount: number; path?: string };
          if (tld && c.tld !== tld) return corsify(Response.json({ valid: false, reason: 'Wrong namespace' }), request);
          // Ghost path coupons must match: request path='ghost' ↔ coupon path='ghost'
          if (path && (c.path ?? '') !== path) return corsify(Response.json({ valid: false, reason: 'Wrong path' }), request);
          if (!path && c.path) return corsify(Response.json({ valid: false, reason: 'Ghost path coupon — use Ghost Path input' }), request);
          if (c.usedCount >= c.maxUses) return corsify(Response.json({ valid: false, reason: 'Already used' }), request);
          return corsify(Response.json({ valid: true, tld: c.tld, path: c.path ?? null }), request);
        }

        // ── Coupon: redeem (atomic use — call only at mint time) ─────────────
        if (email.action === 'redeemCoupon') {
          const code      = ((email as any).code       ?? '').trim().toUpperCase();
          const tld       = ((email as any).tld        ?? '').trim();
          const path      = ((email as any).path       ?? '').trim();
          const redeemedBy = ((email as any).redeemedBy ?? '').trim();
          if (!code) return corsify(Response.json({ ok: false, error: 'Missing code' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`coupon:${code}`);
          if (!raw) return corsify(Response.json({ ok: false, error: 'Not found' }, { status: 404 }), request);
          const c = JSON.parse(raw) as { tld: string; maxUses: number; usedCount: number; note?: string; issuedAt: number; path?: string };
          if (tld && c.tld !== tld) return corsify(Response.json({ ok: false, error: 'Wrong namespace' }, { status: 400 }), request);
          if (path && (c.path ?? '') !== path) return corsify(Response.json({ ok: false, error: 'Wrong path' }, { status: 400 }), request);
          if (c.usedCount >= c.maxUses) return corsify(Response.json({ ok: false, error: 'Already used' }, { status: 409 }), request);
          c.usedCount += 1;
          (c as any).lastRedeemedBy = redeemedBy;
          (c as any).lastRedeemedAt = Date.now();
          await env.INBOX_KV.put(`coupon:${code}`, JSON.stringify(c));
          return corsify(Response.json({ ok: true, tld: c.tld }), request);
        }

        // List NFTMail addresses by controller wallet (traverses nftmailgno:* KV keys)
        if (email.action === 'listNftmailByController') {
          const controller = ((email as any).controller || '').toLowerCase().trim();
          if (!controller) {
            return corsify(Response.json({ error: 'Missing controller' }, { status: 400 }), request);
          }
          try {
            const listed = await env.INBOX_KV.list({ prefix: 'nftmailgno:' });
            const results: { name: string; email: string; gnoName: string; tld: string; tokenId: number | null; isAgent: boolean }[] = [];
            const explicitBaseNames = new Set<string>();
            const aliasRecords: { name: string; baseName: string; g: any; tld: string; gnoName: string }[] = [];

            await Promise.all(listed.keys.map(async (k) => {
              const name = k.name.replace(/^nftmailgno:/, '');
              const raw = await env.INBOX_KV.get(k.name);
              if (!raw) return;
              try {
                const g = JSON.parse(raw);
                const c = (g.controller || '').toLowerCase();
                const s = (g.safe || '').toLowerCase();
                // Match on controller field OR safe address
                if (c !== controller && s !== controller) return;

                const isAgent = name.endsWith('.agent');
                const isAlias = name.endsWith('_');

                // Skip .agent suffix routing keys — not user-facing inboxes
                // NOTE: names ending with _ ARE real agent inboxes (e.g. chonk.681_) — do NOT filter them
                if (isAgent) return;

                // Track base names that are already explicitly registered as separate KV records
                if (!isAlias) {
                  explicitBaseNames.add(name);
                }

                // TLD: prefer record's tld field, then tld: KV key, then parse from origin_nft
                const recordTld: string | null = g.tld || null;
                let tld = recordTld;
                if (!tld) {
                  const tldRaw = await env.INBOX_KV.get(`tld:${name}`);
                  tld = tldRaw || null;
                }
                if (!tld && g.origin_nft) {
                  const dotIdx = (g.origin_nft as string).indexOf('.');
                  if (dotIdx > 0) tld = (g.origin_nft as string).slice(dotIdx + 1);
                }
                // If still no TLD and it's an alias, check base agent's nftmailgno record
                if (!tld && isAlias) {
                  const aliasBase = name.replace(/_+$/, '');
                  const baseRaw = await env.INBOX_KV.get(`nftmailgno:${aliasBase}`);
                  if (baseRaw) {
                    try {
                      const bg = JSON.parse(baseRaw);
                      tld = bg.tld || null;
                      if (!tld && bg.origin_nft) {
                        const dotIdx = (bg.origin_nft as string).indexOf('.');
                        if (dotIdx > 0) tld = (bg.origin_nft as string).slice(dotIdx + 1);
                      }
                    } catch {}
                  }
                }
                tld = tld || 'nftmail.gno';
                // gnoName: use origin_nft directly if available, otherwise baseName.tld (never include underscore)
                const baseName = isAlias ? name.replace(/_+$/, '') : name;
                const gnoName = g.origin_nft || `${baseName}.${tld}`;
                results.push({
                  name,
                  email: `${name}@nftmail.box`,
                  gnoName,
                  tld,
                  tokenId: g.minted_tokenId || null,
                  isAgent,
                });

                // Remember alias records so we can synthesise the base human account afterwards
                if (isAlias) {
                  aliasRecords.push({ name, baseName, g, tld, gnoName });
                }
              } catch { /* skip malformed */ }
            }));

            // Synthesise the base human account (e.g. ghostagent@nftmail.box) for any agent alias
            // (e.g. ghostagent_@nftmail.box) when the base name is NOT already an explicit KV record.
            // Both share the same NFT and controller, but they are distinct inboxes.
            for (const alias of aliasRecords) {
              if (explicitBaseNames.has(alias.baseName)) continue;
              const already = results.find(r => r.name === alias.baseName);
              if (already) continue;
              results.push({
                name: alias.baseName,
                email: `${alias.baseName}@nftmail.box`,
                gnoName: alias.gnoName,
                tld: alias.tld,
                tokenId: alias.g.minted_tokenId || null,
                isAgent: false,
              });
            }

            // Synthesise the agent alias (e.g. ghostagent_@nftmail.box) for any base account that has
            // a TLD record but no explicit alias record. This fixes FakeNormie / BYO agents where the
            // base name was registered but the underscore alias was never written.
            const explicitAliasNames = new Set(aliasRecords.map(a => a.name));
            for (const r of results) {
              if (r.isAgent || r.name.endsWith('_')) continue;
              const aliasName = `${r.name}_`;
              if (explicitAliasNames.has(aliasName)) continue;
              const already = results.find(x => x.name === aliasName);
              if (already) continue;
              results.push({
                name: aliasName,
                email: `${aliasName}@nftmail.box`,
                gnoName: r.gnoName,
                tld: r.tld,
                tokenId: r.tokenId,
                isAgent: true,
              });
            }

            // Deduplicate: same agent stored under dot/hyphen/underscore variants during migration.
            // Normalize separators (collapse . and - to _) excluding known social TLDs.
            // Preserve trailing underscores so base names and their _ aliases stay distinct.
            function normNameForDedup(n: string): string {
              for (const tld of ['.cast', '.fid', '.eth', '.base', '.gno']) {
                if (n.endsWith(tld)) {
                  return n.slice(0, -tld.length).replace(/[.-]/g, '_') + tld;
                }
              }
              return n.replace(/[.-]/g, '_');
            }
            const deduped = new Map<string, typeof results[0]>();
            for (const r of results) {
              const norm = normNameForDedup(r.name);
              const existing = deduped.get(norm);
              if (!existing) {
                deduped.set(norm, r);
              } else if (r.name.includes('_') && !existing.name.includes('_') && !norm.endsWith('_')) {
                // Prefer underscore format (canonical) over dot/hyphen variants, but only for
                // variants that are not the trailing-_ alias of a base name.
                deduped.set(norm, r);
              }
            }
            const dedupedResults = Array.from(deduped.values());
            return corsify(Response.json({ names: dedupedResults, total: dedupedResults.length }), request);
          } catch (e: any) {
            return corsify(Response.json({ error: e?.message ?? 'listNftmailByController failed' }, { status: 500 }), request);
          }
        }

        // Inbox Config: get/set forward-only toggle for PREMIUM tier (reduce clutter)
        if (email.action === 'getInboxConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          try {
            const configRaw = await env.INBOX_KV.get(`inbox-config:${agentName}`);
            const config = configRaw ? JSON.parse(configRaw) : { forwardOnly: false, enable0GBackup: false, updatedAt: Date.now() };
            return corsify(Response.json({ agentName, config }), request);
          } catch (e: any) {
            return corsify(Response.json({ error: e?.message ?? 'getInboxConfig failed' }, { status: 500 }), request);
          }
        }

        if (email.action === 'setInboxConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const config = (email as any).config;
          if (!agentName || !config || typeof config !== 'object') {
            return corsify(Response.json({ error: 'Missing agentName or config' }, { status: 400 }), request);
          }
          try {
            const configToStore = {
              forwardOnly: config.forwardOnly === true,
              enable0GBackup: config.enable0GBackup === true,
              forwardAddress: config.forwardAddress || undefined,
              updatedAt: Date.now()
            };
            await env.INBOX_KV.put(`inbox-config:${agentName}`, JSON.stringify(configToStore));
            return corsify(Response.json({ agentName, config: configToStore, status: 'stored' }), request);
          } catch (e: any) {
            return corsify(Response.json({ error: e?.message ?? 'setInboxConfig failed' }, { status: 500 }), request);
          }
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
          if (tld === 'picoclaw.gno') return corsify(Response.json({ error: 'PICOCLAW: upgrade to LITE first' }, { status: 403 }), request);
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
          const key    = (email as any).key || '';
          const value  = (email as any).value ?? '';
          const owner  = ((email as any).ownerAddress || '').toLowerCase();
          const secret = (email as any).webhookSecret || request.headers.get('x-webhook-secret') || '';
          if (!key || !owner) return corsify(Response.json({ error: 'Missing key or ownerAddress' }, { status: 400 }), request);
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          await env.INBOX_KV.put(key, typeof value === 'string' ? value : JSON.stringify(value));
          return corsify(Response.json({ status: 'ok', key }), request);
        }

        // Generic KV delete (admin only — requires webhook secret)
        if (email.action === 'kvDelete') {
          const key    = (email as any).key || '';
          const secret = (email as any).webhookSecret || request.headers.get('x-webhook-secret') || '';
          if (!key) return corsify(Response.json({ error: 'Missing key' }, { status: 400 }), request);
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          await env.INBOX_KV.delete(key);
          return corsify(Response.json({ status: 'deleted', key }), request);
        }

        // EIP-712 TradeIntent — store, list, retrieve signed trade intent artifacts
        // Artifacts are referenced as requestURI in ERC-8004 Validation Registry submissions.
        // Glass Box audit entry emitted on every store.
        if (email.action === 'storeTradeIntent') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const artifact  = (email as any).artifact;
          if (!agentName || !artifact?.intentHash) {
            return corsify(Response.json({ error: 'Missing agentName or artifact.intentHash' }, { status: 400 }), request);
          }

          // Store artifact by intentHash (primary lookup key)
          const artifactKey = `tradintent:artifact:${artifact.intentHash}`;
          await env.INBOX_KV.put(artifactKey, JSON.stringify(artifact));

          // Maintain per-agent index (newest first, capped at 100)
          const idxKey = `tradeintent:index:${agentName}`;
          const idxRaw = await env.INBOX_KV.get(idxKey);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          idx.unshift(artifact.intentHash);
          if (idx.length > 100) idx.splice(100);
          await env.INBOX_KV.put(idxKey, JSON.stringify(idx));

          // Glass Box audit entry
          const auditKey = `audit:tradeintent:${agentName}`;
          const auditRaw = await env.INBOX_KV.get(auditKey);
          const auditLog: unknown[] = auditRaw ? JSON.parse(auditRaw) : [];
          auditLog.unshift({
            type:        'trade-intent-stored',
            agentName,
            intentHash:  artifact.intentHash,
            agentId:     artifact.agentId,
            strategyTag: artifact.intent?.strategyTag,
            tokenIn:     artifact.intent?.tokenIn,
            tokenOut:    artifact.intent?.tokenOut,
            amountIn:    artifact.intent?.amountIn,
            createdAt:   artifact.createdAt,
          });
          if (auditLog.length > 200) auditLog.splice(200);
          await env.INBOX_KV.put(auditKey, JSON.stringify(auditLog));

          return corsify(Response.json({ ok: true, intentHash: artifact.intentHash }), request);
        }

        if (email.action === 'listTradeIntents') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);

          const idxRaw = await env.INBOX_KV.get(`tradeintent:index:${agentName}`);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];

          const intents = (await Promise.all(
            idx.slice(0, 20).map(async hash => {
              const raw = await env.INBOX_KV.get(`tradintent:artifact:${hash}`);
              return raw ? JSON.parse(raw) : null;
            })
          )).filter(Boolean);

          return corsify(Response.json({ ok: true, intents }), request);
        }

        if (email.action === 'getTradeIntent') {
          const intentHash = ((email as any).intentHash || '');
          if (!intentHash) return corsify(Response.json({ error: 'Missing intentHash' }, { status: 400 }), request);

          const raw = await env.INBOX_KV.get(`tradintent:artifact:${intentHash}`);
          if (!raw) return corsify(Response.json({ ok: false, artifact: null }, { status: 404 }), request);
          return corsify(Response.json({ ok: true, artifact: JSON.parse(raw) }), request);
        }

        // Ghost Handshake — Local-to-Swarm identity registration + tunnel routing
        // register: store signed handshake + tunnel endpoint in SBT registry
        // heartbeat: refresh last-seen timestamp (must be < 5 min old to route)
        // resolve: return active tunnel endpoint for A2A traffic routing
        // list: return all registered ghost agents (for swarm router discovery)
        if (email.action === 'ghostHandshake') {
          const subAction = ((email as any).subAction || '').toLowerCase();
          const agentName = ((email as any).agentName || '').toLowerCase().trim();

          // ── register ────────────────────────────────────────────────────────
          if (subAction === 'register') {
            const handshake     = (email as any).handshake;
            const handshakeHash = ((email as any).handshakeHash || '');
            if (!handshake?.agentName || !handshakeHash) {
              return corsify(Response.json({ error: 'Missing handshake or handshakeHash' }, { status: 400 }), request);
            }

            const name = handshake.agentName.toLowerCase();

            // Validate ghost tier — must be vault.gno
            if (!name.endsWith('.vault.gno')) {
              return corsify(Response.json({ error: 'Ghost tier requires vault.gno namespace' }, { status: 403 }), request);
            }

            // Validate heartbeat freshness (5 min window)
            const nowSeconds = Math.floor(Date.now() / 1000);
            const hbTs = Number(handshake.heartbeat?.timestamp ?? 0);
            if (nowSeconds - hbTs > 300) {
              return corsify(Response.json({ error: 'Heartbeat timestamp is stale (> 5 min)' }, { status: 400 }), request);
            }

            const registeredAt = Date.now();
            const registration = {
              handshake,
              handshakeHash,
              registeredAt,
              lastHeartbeat: registeredAt,
              active: true,
            };

            // Store registration
            const regKey = `ghost:registration:${name}`;
            await env.INBOX_KV.put(regKey, JSON.stringify(registration));

            // Store tunnel endpoint separately for fast router lookups
            const tunnelKey = `ghost:tunnel:${name}`;
            await env.INBOX_KV.put(tunnelKey, JSON.stringify({
              endpoint:  handshake.connection?.endpoint,
              protocol:  handshake.connection?.protocol ?? 'A2A-RPC',
              active:    true,
              updatedAt: registeredAt,
            }));

            // Add to ghost agent index
            const idxKey = 'ghost:agent-index';
            const idxRaw = await env.INBOX_KV.get(idxKey);
            const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
            if (!idx.includes(name)) idx.push(name);
            await env.INBOX_KV.put(idxKey, JSON.stringify(idx));

            // Glass Box audit
            const auditKey = `audit:ghost:${name}`;
            const auditRaw = await env.INBOX_KV.get(auditKey);
            const auditLog: unknown[] = auditRaw ? JSON.parse(auditRaw) : [];
            auditLog.push({
              type:      'ghost-handshake-registered',
              agentName: name,
              handshakeHash,
              endpoint:  handshake.connection?.endpoint,
              llm:       handshake.localStack?.llm,
              timestamp: registeredAt,
            });
            await env.INBOX_KV.put(auditKey, JSON.stringify(auditLog));

            return corsify(Response.json({ ok: true, agentName: name, handshakeHash, registeredAt }), request);
          }

          // ── heartbeat ───────────────────────────────────────────────────────
          if (subAction === 'heartbeat') {
            const handshakeHash = ((email as any).handshakeHash || '');
            const timestamp     = Number((email as any).timestamp ?? 0);
            if (!agentName || !handshakeHash) {
              return corsify(Response.json({ error: 'Missing agentName or handshakeHash' }, { status: 400 }), request);
            }

            const nowSeconds = Math.floor(Date.now() / 1000);
            if (nowSeconds - timestamp > 300) {
              return corsify(Response.json({ error: 'Heartbeat timestamp stale' }, { status: 400 }), request);
            }

            const regKey = `ghost:registration:${agentName}`;
            const regRaw = await env.INBOX_KV.get(regKey);
            if (!regRaw) return corsify(Response.json({ error: 'Agent not registered' }, { status: 404 }), request);

            const reg = JSON.parse(regRaw);
            reg.lastHeartbeat = Date.now();
            reg.active = true;
            await env.INBOX_KV.put(regKey, JSON.stringify(reg));

            // Refresh tunnel active status
            const tunnelKey = `ghost:tunnel:${agentName}`;
            const tunnelRaw = await env.INBOX_KV.get(tunnelKey);
            if (tunnelRaw) {
              const tunnel = JSON.parse(tunnelRaw);
              tunnel.active = true;
              tunnel.updatedAt = Date.now();
              await env.INBOX_KV.put(tunnelKey, JSON.stringify(tunnel));
            }

            return corsify(Response.json({ ok: true, agentName, lastHeartbeat: reg.lastHeartbeat }), request);
          }

          // ── resolve ─────────────────────────────────────────────────────────
          if (subAction === 'resolve') {
            if (!agentName) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);

            const tunnelRaw = await env.INBOX_KV.get(`ghost:tunnel:${agentName}`);
            if (!tunnelRaw) return corsify(Response.json({ ok: false, error: 'No tunnel registered' }, { status: 404 }), request);

            const tunnel = JSON.parse(tunnelRaw) as {
              endpoint: string; protocol: string; active: boolean; updatedAt: number;
            };

            // Check if tunnel is stale (no heartbeat in 10 min)
            const staleMs = 10 * 60 * 1000;
            const isStale = Date.now() - tunnel.updatedAt > staleMs;
            if (isStale) {
              tunnel.active = false;
              await env.INBOX_KV.put(`ghost:tunnel:${agentName}`, JSON.stringify(tunnel));
            }

            return corsify(Response.json({
              ok:       !isStale,
              agentName,
              endpoint: tunnel.endpoint,
              protocol: tunnel.protocol,
              active:   tunnel.active && !isStale,
            }), request);
          }

          // ── list ─────────────────────────────────────────────────────────────
          if (subAction === 'list') {
            const idxRaw = await env.INBOX_KV.get('ghost:agent-index');
            const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];

            const agents = (await Promise.all(idx.map(async name => {
              const tunnelRaw = await env.INBOX_KV.get(`ghost:tunnel:${name}`);
              if (!tunnelRaw) return null;
              const tunnel = JSON.parse(tunnelRaw);
              const stale  = Date.now() - tunnel.updatedAt > 10 * 60 * 1000;
              return { agentName: name, endpoint: tunnel.endpoint, protocol: tunnel.protocol, active: !stale };
            }))).filter(Boolean);

            return corsify(Response.json({ ok: true, agents }), request);
          }

          return corsify(Response.json({ error: `Unknown ghostHandshake subAction: ${subAction}` }, { status: 400 }), request);
        }

        // ── Swarm Coordinator ─────────────────────────────────────────────────
        // getCoordinatorState — returns agents, tasks (+ consensus rounds if section=consensus)
        // coordinatorAction   — register-agent, remove-agent, assign-task, complete-task
        if (email.action === 'getCoordinatorState') {
          const vaultName = ((email as any).vaultName || '').toLowerCase().trim();
          const section   = ((email as any).section   || 'state');
          if (!vaultName) return corsify(Response.json({ error: 'Missing vaultName' }, { status: 400 }), request);

          if (section === 'consensus') {
            const roundsRaw = await env.INBOX_KV.get(`swarm:rounds:${vaultName}`);
            const rounds    = roundsRaw ? JSON.parse(roundsRaw) : [];
            return corsify(Response.json({ rounds }), request);
          }

          const stateRaw = await env.INBOX_KV.get(`swarm:coordinator:${vaultName}`);
          if (!stateRaw) return corsify(Response.json({ exists: false, vaultName, agents: [], tasks: [], rounds: [] }, { status: 404 }), request);
          return corsify(Response.json(JSON.parse(stateRaw)), request);
        }

        if (email.action === 'coordinatorAction') {
          const subAction   = ((email as any).subAction   || '').toLowerCase();
          const vaultName   = ((email as any).vaultName   || '').toLowerCase().trim();
          const agentName   = ((email as any).agentName   || '').toLowerCase().trim();
          const moduleAddr  = ((email as any).moduleAddress || '');
          const topic       = ((email as any).topic        || '');
          const payloadHash = ((email as any).payloadHash  || '');
          const taskId      = ((email as any).taskId       || '');

          if (!vaultName) return corsify(Response.json({ error: 'Missing vaultName' }, { status: 400 }), request);

          const stateKey = `swarm:coordinator:${vaultName}`;
          const stateRaw = await env.INBOX_KV.get(stateKey);
          const state    = stateRaw ? JSON.parse(stateRaw) : {
            vaultName,
            inboxEmail: `swarm.${vaultName}.agent@nftmail.box`,
            agents: [],
            tasks:  [],
          };

          if (subAction === 'register-agent') {
            if (!agentName) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
            const existing = state.agents.find((a: any) => a.agentName === agentName);
            if (existing) {
              existing.active = true;
              existing.moduleAddress = moduleAddr || existing.moduleAddress;
            } else {
              state.agents.push({ agentName, moduleAddress: moduleAddr, active: true, activeTasks: 0, completedTasks: 0, addedAt: Date.now() });
            }
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ ok: true, vaultName, agentName }), request);
          }

          if (subAction === 'remove-agent') {
            state.agents = state.agents.map((a: any) => a.agentName === agentName ? { ...a, active: false } : a);
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ ok: true, vaultName, agentName }), request);
          }

          if (subAction === 'assign-task') {
            const activeAgents = state.agents.filter((a: any) => a.active);
            if (activeAgents.length === 0) return corsify(Response.json({ error: 'No active agents' }, { status: 400 }), request);
            const agent    = activeAgents.reduce((min: any, a: any) => a.activeTasks < min.activeTasks ? a : min, activeAgents[0]);
            const newTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const task      = { taskId: newTaskId, assignedAgent: agent.agentName, topic, payloadHash, assignedAt: Date.now(), completed: false, completedAt: 0 };
            state.tasks.push(task);
            const idx = state.agents.findIndex((a: any) => a.agentName === agent.agentName);
            if (idx >= 0) state.agents[idx].activeTasks++;
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ ok: true, task }), request);
          }

          if (subAction === 'complete-task') {
            const taskIdx = state.tasks.findIndex((t: any) => t.taskId === taskId);
            if (taskIdx < 0) return corsify(Response.json({ error: 'Task not found' }, { status: 404 }), request);
            state.tasks[taskIdx].completed   = true;
            state.tasks[taskIdx].completedAt = Date.now();
            const agentIdx = state.agents.findIndex((a: any) => a.agentName === state.tasks[taskIdx].assignedAgent);
            if (agentIdx >= 0) {
              state.agents[agentIdx].activeTasks    = Math.max(0, state.agents[agentIdx].activeTasks - 1);
              state.agents[agentIdx].completedTasks = (state.agents[agentIdx].completedTasks || 0) + 1;
            }
            await env.INBOX_KV.put(stateKey, JSON.stringify(state));
            return corsify(Response.json({ ok: true, taskId }), request);
          }

          return corsify(Response.json({ error: `Unknown coordinatorAction subAction: ${subAction}` }, { status: 400 }), request);
        }

        // ── Swarm Consensus ───────────────────────────────────────────────────
        // createRound — start a new consensus round
        // castVote    — cast a vote; resolve if quorum reached
        // listRounds  — return all rounds for a vault
        if (email.action === 'swarmConsensus') {
          const subAction = ((email as any).subAction || '').toLowerCase();
          const vaultName = ((email as any).vaultName || '').toLowerCase().trim();
          if (!vaultName) return corsify(Response.json({ error: 'Missing vaultName' }, { status: 400 }), request);

          const roundsKey = `swarm:rounds:${vaultName}`;
          const roundsRaw = await env.INBOX_KV.get(roundsKey);
          const rounds: any[] = roundsRaw ? JSON.parse(roundsRaw) : [];

          if (subAction === 'createround') {
            const topic       = ((email as any).topic    || '').trim();
            const payload     = ((email as any).payload  || topic).trim();
            const strategy    = ((email as any).strategy || 'consensus');
            const xmtpEnabled = !!((email as any).xmtpEnabled);
            if (!topic) return corsify(Response.json({ error: 'Missing topic' }, { status: 400 }), request);

            // Load member count from coordinator state
            const stateRaw    = await env.INBOX_KV.get(`swarm:coordinator:${vaultName}`);
            const memberCount = stateRaw ? (JSON.parse(stateRaw).agents || []).filter((a: any) => a.active).length : 0;
            const quorum      = Math.max(1, Math.ceil(memberCount * 0.51));

            // Build a deterministic consensus hash
            const hashInput   = `${vaultName}|${topic}|${payload}|${Date.now()}`;
            const msgBuffer   = new TextEncoder().encode(hashInput);
            const hashBuffer  = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray   = Array.from(new Uint8Array(hashBuffer));
            const consensusHash = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const round = {
              id:            `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              vaultName,
              topic,
              payload,
              strategy,
              method:        xmtpEnabled ? 'xmtp' : 'email',
              xmtpEnabled,
              votes:         [],
              memberCount,
              quorum,
              result:        'pending',
              consensusHash,
              createdAt:     Date.now(),
              resolvedAt:    undefined,
            };

            rounds.unshift(round);
            await env.INBOX_KV.put(roundsKey, JSON.stringify(rounds));
            return corsify(Response.json({ ok: true, round }), request);
          }

          if (subAction === 'castvote') {
            const roundId   = (email as any).roundId   || '';
            const agentName = ((email as any).agentName || '').toLowerCase().trim();
            const vote      = (email as any).vote       || '';

            if (!roundId || !agentName || !['yes', 'no', 'abstain'].includes(vote)) {
              return corsify(Response.json({ error: 'Missing roundId, agentName, or invalid vote' }, { status: 400 }), request);
            }

            const idx = rounds.findIndex((r: any) => r.id === roundId);
            if (idx < 0) return corsify(Response.json({ error: 'Round not found' }, { status: 404 }), request);

            const round = rounds[idx];
            if (round.result !== 'pending') return corsify(Response.json({ error: 'Round already resolved' }, { status: 409 }), request);
            if (round.votes.find((v: any) => v.agentName === agentName)) {
              return corsify(Response.json({ error: 'Agent already voted' }, { status: 409 }), request);
            }

            round.votes.push({ agentName, vote, reason: null, timestamp: Date.now(), method: round.method });

            const yesCount = round.votes.filter((v: any) => v.vote === 'yes').length;
            const noCount  = round.votes.filter((v: any) => v.vote === 'no').length;

            if (yesCount >= round.quorum) {
              round.result     = 'approved';
              round.resolvedAt = Date.now();
              // Glass Box audit
              const auditKey = `audit:consensus:${vaultName}`;
              const auditRaw = await env.INBOX_KV.get(auditKey);
              const auditLog: unknown[] = auditRaw ? JSON.parse(auditRaw) : [];
              auditLog.push({ roundId, vaultName, topic: round.topic, result: 'approved', consensusHash: round.consensusHash, votedCount: round.votes.length, memberCount: round.memberCount, timestamp: Date.now() });
              await env.INBOX_KV.put(auditKey, JSON.stringify(auditLog));
            } else if (noCount > round.memberCount - round.quorum) {
              round.result     = 'rejected';
              round.resolvedAt = Date.now();
            }

            rounds[idx] = round;
            await env.INBOX_KV.put(roundsKey, JSON.stringify(rounds));
            return corsify(Response.json({ ok: true, round }), request);
          }

          if (subAction === 'listrounds') {
            return corsify(Response.json({ ok: true, rounds }), request);
          }

          return corsify(Response.json({ error: `Unknown swarmConsensus subAction: ${subAction}` }, { status: 400 }), request);
        }

        // Paperclip TEE attestation submission
        // Stores the proof record in KV and emits a Glass Box audit log entry.
        // On-chain submitAttestation() must be called separately via the Safe.
        if (email.action === 'paperclipSubmit') {
          const proofHash  = ((email as any).proofHash  || '').toLowerCase();
          const taskId     = ((email as any).taskId     || '');
          const agentName  = ((email as any).agentName  || '');
          const notaRef    = ((email as any).notaRef    || '');
          const owner      = ((email as any).ownerAddress || '').toLowerCase();

          if (!proofHash || !agentName || !owner) {
            return corsify(Response.json({ error: 'Missing proofHash, agentName, or ownerAddress' }, { status: 400 }), request);
          }

          const record = {
            proofHash,
            taskId,
            agentName,
            notaRef,
            submitter: owner,
            submittedAt: Date.now(),
            verified: false,
          };

          // Store attestation record
          await env.INBOX_KV.put(
            `paperclip:attestation:${proofHash}`,
            JSON.stringify(record),
          );

          // Append to per-agent attestation index
          const agentIdxKey = `paperclip:agent:${agentName.toLowerCase()}`;
          const agentIdxRaw = await env.INBOX_KV.get(agentIdxKey);
          const agentIdx: string[] = agentIdxRaw ? JSON.parse(agentIdxRaw) : [];
          if (!agentIdx.includes(proofHash)) agentIdx.push(proofHash);
          await env.INBOX_KV.put(agentIdxKey, JSON.stringify(agentIdx));

          // Glass Box audit log
          const auditKey = `audit:paperclip:${agentName.toLowerCase()}`;
          const auditRaw = await env.INBOX_KV.get(auditKey);
          const auditLog: unknown[] = auditRaw ? JSON.parse(auditRaw) : [];
          auditLog.push({
            type: 'paperclip-attestation',
            proofHash,
            taskId,
            agentName,
            notaRef,
            timestamp: Date.now(),
            notaUrl: `https://notapaperclip.red/verify/${proofHash}`,
          });
          await env.INBOX_KV.put(auditKey, JSON.stringify(auditLog));

          return corsify(Response.json({ ok: true, proofHash, agentName }), request);
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
            : { vaultName, inboxEmail: `swarm.${vaultName}.agent@nftmail.box`, agents: [], tasks: [] };

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
        // Supports multi-chain: chainId 100 (Gnosis) and 84532 (Base Sepolia)
        if (email.action === 'setErc8004AgentId') {
          const agentName      = ((email as any).agentName || '').toLowerCase().trim();
          const erc8004AgentId = (email as any).erc8004AgentId;
          const agentURI       = (email as any).agentURI || '';
          const chainId        = (email as any).chainId as number | undefined;
          const safeOwner      = (email as any).safeOwner || null;
          if (!agentName || typeof erc8004AgentId !== 'number') {
            return corsify(Response.json({ error: 'Missing agentName or erc8004AgentId' }, { status: 400 }), request);
          }
          const record = JSON.stringify({ agentId: erc8004AgentId, agentURI, chainId: chainId ?? 100, safeOwner, registeredAt: Date.now() });
          // Always write chain-specific key
          const chainLabel = chainId === 84532 ? 'baseSepolia' : chainId === 8453 ? 'base' : 'gnosis';
          await env.INBOX_KV.put(`erc8004:${chainLabel}:${agentName}`, record);
          // Also keep legacy key (erc8004:{name}) pointing to Gnosis primary
          if (!chainId || chainId === 100) {
            await env.INBOX_KV.put(`erc8004:${agentName}`, record);
          }
          // ── Phase 3: shadow-write to D1 identities table ──
          if (env.NFTMAIL_DB) {
            (async () => {
              try {
                await new D1Store(env.NFTMAIL_DB!).upsertIdentity(agentName, chainLabel, erc8004AgentId);
              } catch (e) { console.error('[D1 shadow] setErc8004AgentId write failed (non-fatal):', e); }
            })();
          }
          return corsify(Response.json({ status: 'stored', agentName, erc8004AgentId, chainLabel }), request);
        }

        // ERC-8004 failsafe: pending-transfer checkpoint
        // Written immediately after register() mint; cleared after successful transferFrom().
        // Enables --recover mode to retry any stuck pending transfers without re-minting.
        if (email.action === 'setErc8004PendingTransfer') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const pending   = (email as any).pendingTransfer;
          if (!agentName || !pending) {
            return corsify(Response.json({ error: 'Missing agentName or pendingTransfer' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put('erc8004:pending:' + agentName, JSON.stringify({ ...pending, savedAt: Date.now() }));
          return corsify(Response.json({ status: 'checkpoint_saved', agentName }), request);
        }

        if (email.action === 'clearErc8004PendingTransfer') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          await env.INBOX_KV.delete('erc8004:pending:' + agentName);
          return corsify(Response.json({ status: 'checkpoint_cleared', agentName }), request);
        }

        if (email.action === 'getErc8004PendingTransfers') {
          const listed = await env.INBOX_KV.list({ prefix: 'erc8004:pending:' });
          const pendingTransfers: any[] = [];
          for (const key of listed.keys) {
            const raw = await env.INBOX_KV.get(key.name);
            if (raw) { try { pendingTransfers.push(JSON.parse(raw)); } catch {} }
          }
          return corsify(Response.json({ pendingTransfers }), request);
        }

        // EIP-712 TradeIntent storage — ERC-8004 hackathon requirement
        // Artifacts stored at trade-intent:{agentName}:{intentHash}
        // Index list stored at trade-intent:index:{agentName}
        if (email.action === 'storeTradeIntent') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const artifact  = (email as any).artifact;
          if (!agentName || !artifact?.intentHash) {
            return corsify(Response.json({ error: 'Missing agentName or artifact.intentHash' }, { status: 400 }), request);
          }
          const key = `trade-intent:${agentName}:${artifact.intentHash}`;
          await env.INBOX_KV.put(key, JSON.stringify({ ...artifact, storedAt: Date.now() }));
          // Update index
          const idxKey  = `trade-intent:index:${agentName}`;
          const idxRaw  = await env.INBOX_KV.get(idxKey);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          if (!idx.includes(artifact.intentHash)) {
            idx.unshift(artifact.intentHash);
            if (idx.length > 100) idx.length = 100; // cap at 100
            await env.INBOX_KV.put(idxKey, JSON.stringify(idx));
          }
          return corsify(Response.json({ ok: true, intentHash: artifact.intentHash, agentName }), request);
        }

        if (email.action === 'listTradeIntents') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const idxRaw = await env.INBOX_KV.get(`trade-intent:index:${agentName}`);
          const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          const intents: any[] = [];
          for (const hash of idx.slice(0, 20)) {
            const raw = await env.INBOX_KV.get(`trade-intent:${agentName}:${hash}`);
            if (raw) { try { intents.push(JSON.parse(raw)); } catch {} }
          }
          return corsify(Response.json({ ok: true, intents }), request);
        }

        if (email.action === 'getTradeIntent') {
          const agentName  = ((email as any).agentName || '').toLowerCase().trim();
          const intentHash = ((email as any).intentHash || '').trim();
          if (!agentName || !intentHash) {
            return corsify(Response.json({ error: 'Missing agentName or intentHash' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`trade-intent:${agentName}:${intentHash}`);
          if (!raw) return corsify(Response.json({ ok: false, error: 'Not found' }, { status: 404 }), request);
          try {
            return corsify(Response.json({ ok: true, artifact: JSON.parse(raw) }), request);
          } catch {
            return corsify(Response.json({ ok: false, error: 'Corrupt record' }, { status: 500 }), request);
          }
        }


        // Warrant Canary: return last-alive timestamp from KV (written by cron every 5 min)
        if (email.action === 'getCanary') {
          const ts = await env.INBOX_KV.get('canary:alive');
          if (!ts) return corsify(Response.json({ alive: false, lastAlive: null }), request);
          const ageMs = Date.now() - Number(ts);
          const alive = ageMs < 48 * 60 * 60 * 1000;
          return corsify(Response.json({ alive, lastAlive: Number(ts), ageMs }), request);
        }

        // Glassbox: Get parsed email data for Agent JSON tab
        if (email.action === 'getParsedEmail') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const messageId = ((email as any).messageId || '').trim();
          
          if (!agentName || !messageId) {
            return corsify(Response.json({ error: 'Missing agentName or messageId' }, { status: 400 }), request);
          }
          
          const parsedKey = `parsed:${agentName}:${messageId}`;
          const parsedData = await env.INBOX_KV.get(parsedKey);
          
          return corsify(Response.json({
            agentName,
            messageId,
            parsed: parsedData ? JSON.parse(parsedData) : null
          }), request);
        }

        // Glassbox: Get original message for encryption check
        if (email.action === 'getMessage') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const messageId = ((email as any).messageId || '').trim();
          
          if (!agentName || !messageId) {
            return corsify(Response.json({ error: 'Missing agentName or messageId' }, { status: 400 }), request);
          }
          
          const msgKey = `msg:${agentName}:${messageId}`;
          const messageData = await env.INBOX_KV.get(msgKey);
          
          return corsify(Response.json({
            agentName,
            messageId,
            message: messageData ? JSON.parse(messageData) : null
          }), request);
        }

        // Premium Forwarding: Get forwarding configuration
        if (email.action === 'getForwardingConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          
          const configKey = `forwarding:${agentName}`;
          const configData = await env.INBOX_KV.get(configKey);
          
          // Check acct-tier for Premium level default forwarding
          if (!configData) {
            const acctTierKey = `acct-tier:${agentName}`;
            const acctTierData = await env.INBOX_KV.get(acctTierKey);
            
            if (acctTierData) {
              const acctTier = JSON.parse(acctTierData);
              if (acctTier.tier === 'premium' && acctTier.forwardingEmail) {
                return corsify(Response.json({
                  agentName,
                  config: {
                    enabled: true,
                    targetEmail: acctTier.forwardingEmail,
                    level: 'premium'
                  }
                }), request);
              }
            }
          }
          
          return corsify(Response.json({
            agentName,
            config: configData ? JSON.parse(configData) : null
          }), request);
        }

        // Premium Forwarding: Set forwarding configuration
        if (email.action === 'setForwardingConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const config = (email as any).config;
          
          if (!agentName || !config) {
            return corsify(Response.json({ error: 'Missing agentName or config' }, { status: 400 }), request);
          }
          
          // Validate agent is Premium level
          const acctTierKey = `acct-tier:${agentName}`;
          const acctTierData = await env.INBOX_KV.get(acctTierKey);
          
          if (!acctTierData) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          
          const acctTier = JSON.parse(acctTierData);
          if (acctTier.tier !== 'premium' && acctTier.tier !== 'ghost') {
            return corsify(Response.json({ error: 'Forwarding only available for Premium and Ghost level agents' }, { status: 403 }), request);
          }
          
          const configKey = `forwarding:${agentName}`;
          await env.INBOX_KV.put(configKey, JSON.stringify(config), {
            expirationTtl: 365 * 24 * 60 * 60 // 1 year
          });
          
          return corsify(Response.json({
            agentName,
            config,
            message: 'Forwarding configuration updated'
          }), request);
        }

        // Premium Forwarding: Delete forwarding configuration
        if (email.action === 'deleteForwardingConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          
          const configKey = `forwarding:${agentName}`;
          await env.INBOX_KV.delete(configKey);
          
          return corsify(Response.json({
            agentName,
            message: 'Forwarding configuration removed'
          }), request);
        }

        // Premium Forwarding: Get forwarding log
        if (email.action === 'getForwardingLog') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          
          const logKey = `forwarding-log:${agentName}`;
          const logData = await env.INBOX_KV.get(logKey);
          
          return corsify(Response.json({
            agentName,
            log: logData ? JSON.parse(logData) : []
          }), request);
        }

        // Email Forwarding: Get forwarding configuration for an agent
        if (email.action === 'getForwarding') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          
          const key = `forwarding:${agentName}`;
          const configRaw = await env.INBOX_KV.get(key);
          const config = configRaw ? JSON.parse(configRaw) : { enabled: false, targetEmail: '', level: 'premium' };
          
          return corsify(Response.json(config), request);
        }

        // Email Forwarding: Set forwarding configuration for an agent
        // SECURITY: Store owner address to verify ownership on each email
        if (email.action === 'setForwarding') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const config = (email as any).config;
          const ownerAddress = ((email as any).ownerAddress || '').toLowerCase().trim();

          console.log('[setForwarding] agentName=%s ownerAddress=%s hasConfig=%s hasSig=%s requestDefined=%s',
            agentName, ownerAddress, !!config, !!(config && config.signature), !!request);

          if (!agentName || !config || !ownerAddress) {
            return corsify(Response.json({ error: 'Missing agentName, config, or ownerAddress' }, { status: 400 }), request);
          }
          
          // Store owner address with forwarding config for security verification
          const configWithOwner = {
            ...config,
            ownerAddress,
            setupDate: Date.now()
          };
          
          const key = `forwarding:${agentName}`;
          await env.INBOX_KV.put(key, JSON.stringify(configWithOwner));
          
          console.log(`Forwarding configured for ${agentName} by owner ${ownerAddress}`);
          
          return corsify(Response.json({ success: true, agentName, config: configWithOwner }), request);
        }

        // Test forwarding directly
        if (email.action === 'testForwarding') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }

          try {
            const config = await env.INBOX_KV.get(`forwarding:${agentName}`);
            if (!config) {
              return corsify(Response.json({ error: 'No forwarding config found' }, { status: 404 }), request);
            }

            const parsedConfig = JSON.parse(config);
            console.log('[testForwarding] Config:', parsedConfig);
            console.log('[testForwarding] MAILGUN_DOMAIN:', (env as any).MAILGUN_DOMAIN);
            console.log('[testForwarding] SEND_MAILGUN_API_KEY set:', !!(env as any).SEND_MAILGUN_API_KEY);
            console.log('[testForwarding] MAILGUN_API_KEY set:', !!(env as any).MAILGUN_API_KEY);

            const result = await forwardEmail(env as any, agentName, {
              from: 'test@example.com',
              to: 'ghostagent@nftmail.box',
              subject: 'Test Forwarding',
              content: 'This is a test email for forwarding',
              timestamp: Date.now()
            });

            console.log('[testForwarding] Result:', result);

            return corsify(Response.json({ 
              success: result, 
              config: parsedConfig,
              message: result ? 'Forwarding successful' : 'Forwarding failed'
            }), request);
          } catch (error) {
            console.error('[testForwarding] Error:', error);
            return corsify(Response.json({ 
              error: 'Forwarding test failed', 
              details: error instanceof Error ? error.message : String(error)
            }, { status: 500 }), request);
          }
        }

        // Stats: Get account tracking metrics across all KV prefixes
        if (email.action === 'getStats') {
          const uniqueAgents = new Set<string>();
          const activeInboxAgents = new Set<string>();

          // Count from tld: prefix (registered agents)
          const tldKeys = await env.INBOX_KV.list({ prefix: 'tld:' });
          for (const k of tldKeys.keys) uniqueAgents.add(k.name.replace(/^tld:/, ''));

          // Count from erc8004:gnosis: prefix (on-chain registered)
          const erc8004Keys = await env.INBOX_KV.list({ prefix: 'erc8004:gnosis:' });
          for (const k of erc8004Keys.keys) uniqueAgents.add(k.name.replace(/^erc8004:gnosis:/, ''));

          // Count from blind-index: prefix (agents that have/had mail)
          const blindIndexKeys = await env.INBOX_KV.list({ prefix: 'blind-index:' });
          for (const k of blindIndexKeys.keys) {
            const name = k.name.replace(/^blind-index:/, '').replace(/^ghostmail:/, '');
            if (name) {
              uniqueAgents.add(name);
              activeInboxAgents.add(name);
            }
          }

          // Count from acct-tier: prefix (accounts created via mint/npx/curl)
          const acctTierKeys = await env.INBOX_KV.list({ prefix: 'acct-tier:' });
          for (const k of acctTierKeys.keys) uniqueAgents.add(k.name.replace(/^acct-tier:/, ''));

          // Count from nftmailgno: prefix (minted NFT registrations)
          const nftAgents = new Set<string>();
          const nftmailgnoKeys = await env.INBOX_KV.list({ prefix: 'nftmailgno:' });
          for (const k of nftmailgnoKeys.keys) {
            const name = k.name.replace(/^nftmailgno:/, '');
            uniqueAgents.add(name);
            nftAgents.add(name);
          }

          // Build TLD breakdown from tld: keys
          const tldBreakdown: Record<string, string[]> = {};
          for (const k of tldKeys.keys) {
            const name = k.name.replace(/^tld:/, '');
            const tldVal = await env.INBOX_KV.get(k.name);
            if (tldVal) {
              if (!tldBreakdown[tldVal]) tldBreakdown[tldVal] = [];
              tldBreakdown[tldVal].push(name);
            }
          }

          // DAU: count unique agents active today and yesterday
          const todayStr  = new Date().toISOString().slice(0, 10);
          const ydayStr   = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          const [dauToday, dauYday] = await Promise.all([
            env.INBOX_KV.list({ prefix: `dau:${todayStr}:` }),
            env.INBOX_KV.list({ prefix: `dau:${ydayStr}:` }),
          ]);
          const dauTodayCount = dauToday.keys.length;
          const dauYdayCount  = dauYday.keys.length;

          return corsify(Response.json({
            total_accounts: uniqueAgents.size,
            nft_accounts: nftAgents.size,
            sandbox_accounts: uniqueAgents.size - nftAgents.size,
            active_inboxes: activeInboxAgents.size,
            dau: { today: dauTodayCount, yesterday: dauYdayCount, date: todayStr },
            agents: Array.from(uniqueAgents).sort(),
            nft_agents: Array.from(nftAgents).sort(),
            tld_breakdown: tldBreakdown,
            chain_id: 100,
            last_updated: Date.now()
          }), request);
        }

        // D1 Diagnostic: check database health and get row counts
        if (email.action === 'diagnoseD1') {
          if (!env.NFTMAIL_DB) {
            return corsify(Response.json({ error: 'D1 not configured', configured: false }), request);
          }
          try {
            const db = env.NFTMAIL_DB;
            const [agents, liteCount, recentAgents] = await Promise.all([
              db.prepare('SELECT COUNT(*) as count FROM agents').first<{ count: number }>(),
              db.prepare("SELECT COUNT(*) as count FROM agents WHERE tier != 'basic'").first<{ count: number }>(),
              db.prepare('SELECT label, tier, controller, created_at FROM agents ORDER BY created_at DESC LIMIT 10').all(),
            ]);
            return corsify(Response.json({
              configured: true,
              healthy: true,
              totalAgents: agents?.count ?? 0,
              litePlusAgents: liteCount?.count ?? 0,
              recentAgents: recentAgents.results ?? [],
            }), request);
          } catch (e) {
            return corsify(Response.json({
              configured: true,
              healthy: false,
              error: e instanceof Error ? e.message : String(e),
            }), request);
          }
        }

        // Diagnostic: Check and optionally reset sendsRemaining for an account
        if (email.action === 'checkSendLimit') {
          const agentName: string = ((email as any).agentName || '').toLowerCase().trim();
          const reset: boolean = !!(email as any).reset;
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
          if (!tierRaw) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          const tierData = JSON.parse(tierRaw);
          const currentRemaining = tierData.sendsRemaining === 'unlimited' ? 'unlimited' : (typeof tierData.sendsRemaining === 'number' ? tierData.sendsRemaining : 10);
          
          if (reset) {
            tierData.sendsRemaining = 10;
            tierData.sendsUsed = 0;
            await env.INBOX_KV.put(`acct-tier:${agentName}`, JSON.stringify(tierData));
            return corsify(Response.json({
              agentName,
              previousRemaining: currentRemaining,
              sendsRemaining: 10,
              sendsUsed: 0,
              reset: true,
            }), request);
          }
          
          const nowMsDiag = Date.now();
          const todayUtcMsDiag = nowMsDiag - (nowMsDiag % 86400000);
          const isLite = tierData.tier === 'lite';
          const dailyUsed = isLite ? (tierData.dailySendCount || 0) : undefined;
          const dailyWindowFresh = isLite && (tierData.dailySendWindowStart || 0) >= todayUtcMsDiag;
          
          return corsify(Response.json({
            agentName,
            tier: tierData.tier,
            expiresAt: tierData.expires_at,
            // BASIC lifetime counter
            sendsRemaining: currentRemaining,
            sendsUsed: tierData.sendsUsed || 0,
            // LITE daily rolling counter
            ...(isLite && {
              dailySendCount: dailyWindowFresh ? dailyUsed : 0,
              dailySendRemaining: dailyWindowFresh ? (100 - (dailyUsed ?? 0)) : 100,
              dailyLimit: 100,
              dailyWindowStart: tierData.dailySendWindowStart || null,
              dailyResetsAt: todayUtcMsDiag + 86400000,
            }),
          }), request);
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

        // --- OTP Golden Bridge: FID → NFT Upgrade ---
        // Generate OTP for migrating FID-based Lite account to NFT Sovereign
        if (email.action === 'generateOTP') {
          const fid = ((email as any).fid || '').toString();
          if (!fid) {
            return corsify(Response.json({ error: 'Missing FID' }, { status: 400 }), request);
          }

          // Generate 6-digit OTP
          const otp = Math.floor(100000 + Math.random() * 900000).toString();
          const otpKey = `otp:${fid}`;
          const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

          // Store OTP with expiration
          await env.INBOX_KV.put(otpKey, JSON.stringify({
            otp,
            fid,
            used: false,
            expiresAt,
            createdAt: Date.now(),
          }), { expirationTtl: 600 }); // 10 min TTL

          // Return OTP (will be shown in Snap UI or emailed)
          return corsify(Response.json({
            success: true,
            otp, // In production, email this instead of returning
            expiresAt,
            message: 'Use this code on nftmail.box/upgrade to claim your NFT',
          }), request);
        }

        // Verify OTP and return FID data for NFT minting
        if (email.action === 'verifyOTP') {
          const { fid, otp } = email as any;
          if (!fid || !otp) {
            return corsify(Response.json({ error: 'Missing FID or OTP' }, { status: 400 }), request);
          }

          const otpKey = `otp:${fid}`;
          const otpData = await env.INBOX_KV.get(otpKey);

          if (!otpData) {
            return corsify(Response.json({ error: 'OTP expired or not found' }, { status: 404 }), request);
          }

          const parsed = JSON.parse(otpData);

          if (parsed.used) {
            return corsify(Response.json({ error: 'OTP already used' }, { status: 400 }), request);
          }

          if (Date.now() > parsed.expiresAt) {
            return corsify(Response.json({ error: 'OTP expired' }, { status: 400 }), request);
          }

          if (parsed.otp !== otp.toString()) {
            return corsify(Response.json({ error: 'Invalid OTP' }, { status: 401 }), request);
          }

          // Mark OTP as used
          await env.INBOX_KV.put(otpKey, JSON.stringify({ ...parsed, used: true }), { expirationTtl: 3600 });

          // Get FID account data for migration
          const agent = fid; // FID is the agent name in Lite mode
          const inbox = await env.INBOX_KV.get(`inbox:${agent}`);
          const messages = inbox ? JSON.parse(inbox) : [];
          const tier = await env.INBOX_KV.get(`tier:${agent}`);
          const tierData = tier ? JSON.parse(tier) : { tier: 'basic', sendsUsed: 0 };

          return corsify(Response.json({
            success: true,
            fid,
            emailCount: messages.length,
            tier: tierData.tier,
            sendsUsed: tierData.sendsUsed || 0,
            message: 'OTP verified. Ready to mint NFT and migrate inbox.',
          }), request);
        }

        // --- Ghost-Router: Inbound Email ---
        // Webhook receives *@nftmail.box → Worker classifies:
        //   Agent (.agent@): ECIES encrypt → blind KV + IPFS
        //   Human (@): Store in KV
        if (email.action === 'ghostRoute') {
          // Skip secret check for Mailgun-sourced calls (already HMAC-verified upstream)
          if (!(email as any)._mailgunVerified) {
            const workerSecret = env.WEBHOOK_SECRET;
            if (workerSecret) {
              const authHeader = (email as any).webhookSecret || '';
              if (authHeader !== workerSecret) {
                return corsify(Response.json({ error: 'Invalid webhook secret' }, { status: 401 }), request);
              }
            }
          }

          // Decode HTML entities from webhook payload
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

          // --- HUMAN STREAM: cleartext KV (pure Mailgun/KV path, no Zoho) ---
          if (stream === 'human') {
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

            return corsify(Response.json({
              status: 'received',
              stream: 'human',
              encrypted: false,
              blindId,
              plaintextHash,
              recipient: agentName,
              ...(collection ? { collection: collection.displayName, tokenId, owner: ownerAddress } : {}),
            }), request);
          }

          if (stream === 'agent') {
            // --- AGENT STREAM: pure KV path (Mailgun inbound, no Zoho) ---
            const isGlassbox = await isPublicAgent(agentName, env);

            if (isGlassbox) {
              // GLASSBOX: store cleartext + audit log
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

              return corsify(Response.json({
                status: 'received',
                stream: 'agent',
                agentType: 'glassbox',
                encrypted: false,
                blindId,
                plaintextHash,
                recipient: agentName,
              }), request);
            }

            // BLACKBOX: ECIES encrypt or cleartext-with-warning
            const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);

            if (!pubKeyHex) {
              // No ECIES key — store cleartext with warning
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

              return corsify(Response.json({
                status: 'received',
                stream: 'agent',
                agentType: 'blackbox',
                encrypted: false,
                blindId,
                plaintextHash,
                warning: 'No ECIES key — message stored unencrypted. Register key via registerEciesKey.',
              }), request);
            }

            // ECIES encrypt
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

            return corsify(Response.json({
              status: 'received',
              stream: 'agent',
              agentType: 'blackbox',
              encrypted: true,
              blindId,
              plaintextHash,
              hasRecoveryKey: !!recoveryEnvelope,
              recipient: agentName,
            }), request);
          }

          return corsify(Response.json({ error: 'Unclassified stream' }, { status: 400 }), request);
        }

        // --- Mailgun Inbound Webhook ---
        // Mailgun receives *@nftmail.box (MX → Mailgun) → POST multipart/form-data here.
        // We verify the Mailgun webhook HMAC, normalise the payload to match the ghostRoute
        // data shape, then run the same classify → encrypt → KV path.
        // No Zoho involved — zero cleartext retention window.
        if (email.action === 'mailgunInbound') {
          const mgTimestamp = String((email as any).timestamp || '');
          const mgToken     = String((email as any).token || '');
          const mgSignature = String((email as any).signature || '');
          const mgApiKey    = env.MAILGUN_API_KEY || '';

          // Verify Mailgun HMAC-SHA256 signature
          if (mgApiKey && mgTimestamp && mgToken && mgSignature) {
            const signingKey = new TextEncoder().encode(mgApiKey);
            const message    = new TextEncoder().encode(mgTimestamp + mgToken);
            const cryptoKey  = await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            const mac        = await crypto.subtle.sign('HMAC', cryptoKey, message);
            const expected   = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
            if (expected !== mgSignature) {
              return corsify(Response.json({ error: 'Invalid Mailgun signature' }, { status: 401 }), request);
            }
          }

          return await handleMailgunPayload(email as unknown as Record<string, unknown>, env, request, ctx);
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

        // --- Trial Registration: KV-only entry for free agents ---
        // Called by /api/register-trial to create shadow mint without NFT.
        // No auth required - rate limited and IP-keyed.
        if (email.action === 'registerTrial') {
          const name: string = ((email as any).name || '').toLowerCase().trim();
          const claimCode: string = (email as any).claimCode || '';
          if (!name || !claimCode) {
            return corsify(Response.json({ error: 'Missing name or claimCode' }, { status: 400 }), request);
          }

          // Check if name already exists
          const kvKey = name.replace(/_$/, ''); // Remove trailing underscore for KV lookup
          const existing = await env.INBOX_KV.get(`nftmailgno:${kvKey}`);
          if (existing) {
            return corsify(Response.json({ error: 'Name already exists' }, { status: 409 }), request);
          }

          // Check if name is registered on ENS mainnet (ENS reserved)
          const ensCheck = await ensNameExists(kvKey);
          if (ensCheck.exists) {
            return corsify(Response.json({
              error: 'Name reserved by ENS',
              message: `${kvKey}.eth is registered on Ethereum mainnet. Only the ENS holder may mint this name.`,
              ensOwner: ensCheck.owner,
            }, { status: 409 }), request);
          }

          // Store claim code
          const claimKey = `claim:${claimCode}`;
          const existingClaim = await env.INBOX_KV.get(claimKey);
          if (existingClaim) {
            return corsify(Response.json({ error: 'Claim code already used' }, { status: 409 }), request);
          }

          // 8-day destroy cycle for free tier
          const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          const creatorIp = request.headers.get('cf-connecting-ip') || 'unknown';

          // Create trial KV entries - free tier
          const trialEntry = JSON.stringify({
            type: 'free',
            status: 'trial',
            claimCode,
            sendsRemaining: 10,
            sendsUsed: 0,
            createdAt: now,
            expiresAt: now + EIGHT_DAYS_MS, // 8-day destroy cycle
            creatorIp,
            controller: null,
            originNft: null,
            mintedTokenId: null,
          });

          const tierEntry = JSON.stringify({
            tier: 'free',
            type: 'free',
            expiresAt: now + EIGHT_DAYS_MS,
            upgradedAt: null,
            safe: null,
            retention: '8-day',
            sendsRemaining: 10,
            storyIp: null,
          });

          await Promise.all([
            env.INBOX_KV.put(`nftmailgno:${kvKey}`, trialEntry),
            env.INBOX_KV.put(`acct-tier:${kvKey}`, tierEntry),
            env.INBOX_KV.put(`claim:${claimCode}`, JSON.stringify({ name: kvKey, createdAt: now, expiresAt: now + EIGHT_DAYS_MS })),
          ]);

          return corsify(Response.json({
            status: 'trial_created',
            type: 'free',
            name: kvKey,
            email: `${name}@nftmail.box`,
            expiresAt: now + EIGHT_DAYS_MS,
            sendsRemaining: 10,
            claimCode,
          }), request);
        }

        // --- Verify Claim Code ---
        // Called by /claim/[claimCode] page and /api/claim-inbox
        if (email.action === 'verifyClaim') {
          const claimCode: string = (email as any).claimCode || '';
          if (!claimCode) {
            return corsify(Response.json({ error: 'Missing claimCode' }, { status: 400 }), request);
          }

          const claimKey = `claim:${claimCode}`;
          const claimData = await env.INBOX_KV.get(claimKey);
          
          if (!claimData) {
            return corsify(Response.json({ error: 'Claim code not found' }, { status: 404 }), request);
          }

          const claim = JSON.parse(claimData);
          const kvKey = claim.name;
          
          // Check if already claimed (has NFT data)
          const inboxData = await env.INBOX_KV.get(`nftmailgno:${kvKey}`);
          if (inboxData) {
            const inbox = JSON.parse(inboxData);
            if (inbox.mintedTokenId !== null) {
              return corsify(Response.json({ 
                claimed: true, 
                name: kvKey,
                wallet: inbox.controller 
              }), request);
            }
          }

          return corsify(Response.json({ 
            claimed: false, 
            name: kvKey,
            createdAt: claim.createdAt 
          }), request);
        }

        // --- Mark Claim as Used ---
        // Called by /api/claim-inbox after successful NFT mint
        if (email.action === 'markClaimUsed') {
          const claimCode: string = (email as any).claimCode || '';
          const walletAddress: string = (email as any).walletAddress || '';
          const mintData: any = (email as any).mintData || {};

          if (!claimCode || !walletAddress) {
            return corsify(Response.json({ error: 'Missing claimCode or walletAddress' }, { status: 400 }), request);
          }

          const claimKey = `claim:${claimCode}`;
          const claimData = await env.INBOX_KV.get(claimKey);
          
          if (!claimData) {
            return corsify(Response.json({ error: 'Claim code not found' }, { status: 404 }), request);
          }

          const claim = JSON.parse(claimData);
          const kvKey = claim.name;

          // Update claim with mint info
          await env.INBOX_KV.put(claimKey, JSON.stringify({
            ...claim,
            claimedAt: Date.now(),
            walletAddress,
            mintData
          }));

          return corsify(Response.json({ 
            status: 'claimed',
            name: kvKey,
            walletAddress 
          }), request);
        }

        // --- Check Inbox Status (8-day destroy cycle) ---
        // Returns expiration info, sends remaining, and destroy eligibility
        if (email.action === 'checkInboxStatus') {
          const name: string = ((email as any).name || '').toLowerCase().trim();
          if (!name) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }

          const kvKey = name.replace(/_$/, '');
          const now = Date.now();
          
          // Get trial and tier data
          const [trialData, tierData] = await Promise.all([
            env.INBOX_KV.get(`nftmailgno:${kvKey}`),
            env.INBOX_KV.get(`acct-tier:${kvKey}`),
          ]);

          if (!trialData) {
            return corsify(Response.json({ error: 'Inbox not found' }, { status: 404 }), request);
          }

          const trial = JSON.parse(trialData);
          const tier = tierData ? JSON.parse(tierData) : null;
          
          const isExpired = trial.expiresAt && now > trial.expiresAt;
          const expiresIn = trial.expiresAt ? Math.max(0, trial.expiresAt - now) : null;
          const daysRemaining = expiresIn ? Math.floor(expiresIn / (24 * 60 * 60 * 1000)) : null;

          return corsify(Response.json({
            name: kvKey,
            email: `${name}@nftmail.box`,
            type: trial.type || 'unknown',
            status: isExpired ? 'expired' : trial.status,
            createdAt: trial.createdAt,
            expiresAt: trial.expiresAt,
            expiresIn,
            daysRemaining,
            sendsRemaining: trial.sendsRemaining ?? 0,
            sendsUsed: trial.sendsUsed ?? 0,
            canDestroy: isExpired,
            canRecreate: isExpired,
            tier: tier?.tier || 'unknown',
          }), request);
        }

        // --- Destroy and Recreate (8-day destroy cycle) ---
        // Destroys expired free inbox and creates fresh trial
        if (email.action === 'destroyAndRecreate') {
          const name: string = ((email as any).name || '').toLowerCase().trim();
          const requestIp = request.headers.get('cf-connecting-ip') || 'unknown';
          
          if (!name) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }

          const kvKey = name.replace(/_$/, '');
          const now = Date.now();
          
          // Get existing trial data
          const trialData = await env.INBOX_KV.get(`nftmailgno:${kvKey}`);
          if (!trialData) {
            return corsify(Response.json({ error: 'Inbox not found' }, { status: 404 }), request);
          }

          const trial = JSON.parse(trialData);
          
          // Only free trials can be destroyed and recreated
          if (trial.type !== 'free') {
            return corsify(Response.json({ 
              error: 'Only free inboxes can be destroyed and recreated',
              type: trial.type 
            }, { status: 403 }), request);
          }

          // Check if expired
          const isExpired = trial.expiresAt && now > trial.expiresAt;
          if (!isExpired) {
            return corsify(Response.json({
              error: 'Inbox not yet expired',
              expiresAt: trial.expiresAt,
              expiresIn: trial.expiresAt - now,
            }, { status: 403 }), request);
          }

          // Optional: Check IP matches creator (rate limiting protection)
          const creatorIp = trial.creatorIp;
          const ipMatch = creatorIp === requestIp || creatorIp === 'unknown';
          
          if (!ipMatch) {
            // Log for monitoring but allow (IPs change, especially for agents)
            console.log(`[destroyAndRecreate] IP mismatch for ${kvKey}: stored=${creatorIp}, request=${requestIp}`);
          }

          // Delete old inbox data
          await Promise.all([
            env.INBOX_KV.delete(`nftmailgno:${kvKey}`),
            env.INBOX_KV.delete(`acct-tier:${kvKey}`),
            // Delete blind inbox messages
            env.INBOX_KV.delete(`blind-index:${kvKey}`),
          ]);

          // Create fresh 8-day trial
          const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
          const newClaimCode = crypto.randomUUID();
          const newCreatorIp = requestIp;

          const newTrialEntry = JSON.stringify({
            type: 'free',
            status: 'trial',
            claimCode: newClaimCode,
            sendsRemaining: 10,
            sendsUsed: 0,
            createdAt: now,
            expiresAt: now + EIGHT_DAYS_MS,
            creatorIp: newCreatorIp,
            controller: null,
            originNft: null,
            mintedTokenId: null,
            recreatedFrom: kvKey,
            recreatedAt: now,
          });

          const newTierEntry = JSON.stringify({
            tier: 'free',
            type: 'free',
            expiresAt: now + EIGHT_DAYS_MS,
            upgradedAt: null,
            safe: null,
            retention: '8-day',
            sendsRemaining: 10,
            storyIp: null,
          });

          await Promise.all([
            env.INBOX_KV.put(`nftmailgno:${kvKey}`, newTrialEntry),
            env.INBOX_KV.put(`acct-tier:${kvKey}`, newTierEntry),
            env.INBOX_KV.put(`claim:${newClaimCode}`, JSON.stringify({ 
              name: kvKey, 
              createdAt: now, 
              expiresAt: now + EIGHT_DAYS_MS,
              recreated: true,
            })),
          ]);

          return corsify(Response.json({
            status: 'recreated',
            type: 'free',
            name: kvKey,
            email: `${name}@nftmail.box`,
            expiresAt: now + EIGHT_DAYS_MS,
            sendsRemaining: 10,
            claimCode: newClaimCode,
            previousExpiresAt: trial.expiresAt,
          }), request);
        }

        // --- Pending Upgrade Intent: store wallet→agentName+tier mapping for Mercuryo webhook ---
        // Called by the UI before redirecting the user to the Mercuryo widget.
        // TTL: 2 hours (Mercuryo payments typically complete within minutes).
        if (email.action === 'setPendingUpgrade') {
          const agentName: string = ((email as any).agentName || '').toLowerCase().trim();
          const targetTier: string = ((email as any).tier || '').toLowerCase();
          const walletAddress: string = ((email as any).walletAddress || '').toLowerCase();
          if (!agentName || !targetTier || !walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
            return corsify(Response.json({ error: 'Missing agentName, tier, or walletAddress' }, { status: 400 }), request);
          }
          if (targetTier !== 'professional' && targetTier !== 'vault') {
            return corsify(Response.json({ error: 'Invalid tier. Must be professional or vault' }, { status: 400 }), request);
          }
          await env.INBOX_KV.put(
            `pending-upgrade:${walletAddress}`,
            JSON.stringify({ agentName, tier: targetTier, createdAt: Date.now() }),
            { expirationTtl: 7200 },
          );
          return corsify(Response.json({ status: 'pending', agentName, tier: targetTier, walletAddress }), request);
        }

        if (email.action === 'getPendingUpgrade') {
          const walletAddress: string = ((email as any).walletAddress || '').toLowerCase();
          if (!walletAddress) return corsify(Response.json({ error: 'Missing walletAddress' }, { status: 400 }), request);
          const raw = await env.INBOX_KV.get(`pending-upgrade:${walletAddress}`);
          if (!raw) return corsify(Response.json({ pending: false }), request);
          return corsify(Response.json({ pending: true, ...JSON.parse(raw) }), request);
        }

        // --- Upgrade Tier: Free → Professional/Vault ---
        if (email.action === 'upgradeTier') {
          const name: string = ((email as any).name || '').toLowerCase().trim();
          const targetTier: string = ((email as any).tier || '').toLowerCase();
          const walletAddress: string = ((email as any).walletAddress || '').toLowerCase();
          const txHash: string = ((email as any).txHash || '').toLowerCase();
          
          if (!name || !targetTier || !walletAddress) {
            return corsify(Response.json({ 
              error: 'Missing name, tier, or walletAddress' 
            }, { status: 400 }), request);
          }
          
          if (targetTier !== 'professional' && targetTier !== 'vault') {
            return corsify(Response.json({ 
              error: 'Invalid tier. Must be professional or vault' 
            }, { status: 400 }), request);
          }
          
          const kvKey = name.replace(/_$/, '');
          const now = Date.now();
          
          // Support both nftmailgno trial accounts and Farcaster mini-app accounts
          const [trialData, existingTierData] = await Promise.all([
            env.INBOX_KV.get(`nftmailgno:${kvKey}`),
            env.INBOX_KV.get(`acct-tier:${kvKey}`),
          ]);
          
          let upgradedFrom = 'basic';
          let trial: any = null;
          
          if (trialData) {
            // nftmailgno trial account path
            trial = JSON.parse(trialData);
            upgradedFrom = trial.type || 'basic';
            
            // Allow free/basic/trial → professional/vault, and professional → vault
            const isUpgradePath =
              (upgradedFrom === 'free' || upgradedFrom === 'trial' || upgradedFrom === 'basic') ||
              (upgradedFrom === 'professional' && targetTier === 'vault');
            if (!isUpgradePath) {
              return corsify(Response.json({
                error: 'No valid upgrade path from current tier',
                currentType: trial.type,
                targetTier,
              }, { status: 403 }), request);
            }
          } else if (existingTierData) {
            // Farcaster mini-app account path - check existing tier
            const existingTier = JSON.parse(existingTierData);
            upgradedFrom = existingTier.tier || 'basic';
            
            // Can upgrade from free/professional to professional/vault
            if (upgradedFrom !== 'free' && upgradedFrom !== 'basic' && upgradedFrom !== 'professional') {
              return corsify(Response.json({
                error: 'Can only upgrade free or professional accounts',
                currentTier: upgradedFrom
              }, { status: 403 }), request);
            }
          } else {
            // No account found at all
            return corsify(Response.json({ error: 'Inbox not found' }, { status: 404 }), request);
          }
          
          // Professional tier: 10 USDC, 30-day storage
          // Vault tier: 14 USDC, 365-day storage
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
          
          const isVault = targetTier === 'vault';
          const retention = isVault ? '365-day' : '30-day';
          const expiresAt = isVault ? now + ONE_YEAR_MS : null; // Professional doesn't expire
          const cost = isVault ? '14 USDC' : '10 USDC'; // One-time upgrade fee
          
          // Update trial entry to upgraded status (if nftmailgno entry exists)
          const kvWrites: Promise<void>[] = [];
          
          if (trialData) {
            const upgradedEntry = JSON.stringify({
              type: targetTier,
              status: 'active',
              controller: walletAddress,
              upgradedAt: now,
              upgradedFrom: trial.type,
              upgradeTx: txHash || null,
              previousClaimCode: trial.claimCode || null,
              // Keep reference to original creation
              createdAt: trial.createdAt,
              originNft: trial.originNft || null,
              mintedTokenId: trial.mintedTokenId || null,
            });
            kvWrites.push(env.INBOX_KV.put(`nftmailgno:${kvKey}`, upgradedEntry));
          }
          
          // Merge with existing tier data if available (for mini-app accounts)
          let tierRecord: any = {};
          if (existingTierData) {
            try { tierRecord = JSON.parse(existingTierData); } catch {}
          }
          
          const tierEntry = JSON.stringify({
            ...tierRecord,
            tier: targetTier,
            type: targetTier,
            upgradedAt: now,
            upgradedFrom,
            expiresAt,
            retention,
            walletAddress,
            upgradeTx: txHash || null,
            cost,
            sendsRemaining: 'unlimited',
            storyIp: tierRecord.storyIp ?? null,
          });
          
          kvWrites.push(env.INBOX_KV.put(`acct-tier:${kvKey}`, tierEntry));
          
          await Promise.all(kvWrites);
          
          return corsify(Response.json({
            status: 'upgraded',
            name: kvKey,
            previousTier: upgradedFrom,
            newTier: targetTier,
            email: `${name}@nftmail.box`,
            walletAddress,
            retention,
            expiresAt,
            cost,
            sendsRemaining: 'unlimited',
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

          // ── 10-account limit per controller/IP ────────────────────────────
          // Bypass limit when called with valid webhook secret (trusted server-side BYO molt etc.)
          const isTrustedCall = !!(env.WEBHOOK_SECRET && secret === env.WEBHOOK_SECRET);
          const ACCT_LIMIT = 10;
          const acctKey = controller
            ? `acct-count:${controller.toLowerCase()}`
            : `acct-count:ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
          const acctRaw = await env.INBOX_KV.get(acctKey);
          const acctCount = acctRaw ? parseInt(acctRaw, 10) : 0;
          if (!isTrustedCall && acctCount >= ACCT_LIMIT) {
            return corsify(Response.json({
              error: `Account limit reached (${ACCT_LIMIT} inboxes per ${controller ? 'wallet' : 'IP'}). Connect a wallet or upgrade to create more.`,
              count: acctCount,
              limit: ACCT_LIMIT,
            }, { status: 429 }), request);
          }
          // ─────────────────────────────────────────────────────────────────
          // ENS parent-ownership guard — for ENS-derived labels (e.g. "eyemine" from eyemine.eth):
          // Verify the current ENS registrant matches `controller`.
          // This prevents a new vitalik.eth owner from stealing vitalik.agent.gno.
          // Guard only applies to non-hyphenated, non-dotted labels that look like ENS names.
          const isEnsLabel = (email as any).ensName || ((email as any).originNft ?? '').includes('.eth');
          if (isEnsLabel && controller) {
            try {
              const ensLabel = label.replace(/_$/, ''); // strip trailing _ for agent local-part
              const ETH_RPC = (env as any).ETH_RPC_URL ?? 'https://cloudflare-eth.com';
              const ENS_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
              // keccak256 of label — computed inline without viem (CF Workers compatible)
              async function keccak256Hex(input: string): Promise<string> {
                const enc = new TextEncoder();
                const data = enc.encode(input);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                // Note: ETH keccak256 ≠ SHA-256 but CF Workers don't have keccak natively.
                // We call eth_call directly with the precomputed tokenId from the client via ensTokenId field.
                void hashBuffer;
                return '';
              }
              void keccak256Hex; // unused — use client-provided ensTokenId if present
              const ensTokenId: string | undefined = (email as any).ensTokenId;
              if (ensTokenId) {
                const rpcBody = JSON.stringify({
                  jsonrpc: '2.0', id: 1, method: 'eth_call',
                  params: [{
                    to: ENS_REGISTRAR,
                    data: `0x6352211e${BigInt(ensTokenId).toString(16).padStart(64, '0')}`, // ownerOf(uint256)
                  }, 'latest'],
                });
                const rpcRes = await fetch(ETH_RPC, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: rpcBody,
                }).then(r => r.json()).catch(() => null) as { result?: string } | null;
                const ensOwner = rpcRes?.result ? `0x${rpcRes.result.slice(-40)}` : null;
                if (ensOwner && ensOwner.toLowerCase() !== controller.toLowerCase()) {
                  console.warn(`[registerSovereign] ENS ownership mismatch for ${ensLabel}.eth: owner=${ensOwner}, controller=${controller}`);
                  return corsify(Response.json({
                    error: `ENS ownership mismatch: ${ensLabel}.eth is owned by a different wallet. You cannot claim this subname.`,
                    status: 'ens_ownership_mismatch',
                    ensOwner,
                  }, { status: 403 }), request);
                }
              }
            } catch (ensErr) {
              console.warn('[registerSovereign] ENS ownership check failed (non-fatal, proceeding):', ensErr);
            }
          }

          // ─────────────────────────────────────────────────────────────────
          // Prevent duplicate registration (trusted calls skip this — they may update existing)
          const existingReg = await env.INBOX_KV.get(`nftmailgno:${(email as any).legacyIdentity || label}`);
          if (existingReg && !isTrustedCall) {
            return corsify(Response.json({ error: `${label} is already registered`, status: 'already_registered' }, { status: 409 }), request);
          }

          const originNft: string = (email as any).originNft || `${label.replace(/\./g, '-')}.agent.gno`;
          const legacyIdentity: string | null = (email as any).legacyIdentity || null;
          const mintedTokenId: number | null = (email as any).mintedTokenId || null;
          const privacyTier: string = (email as any).privacyTier || 'exposed';
          const safeFromRequest: string | null = (email as any).safe || null;
          // KV key: use legacyIdentity (dot format: mac.slave) if provided, else label (hyphen: mac-slave)
          // resolveAddress looks up by the email local-part (dot format)
          const kvKey = legacyIdentity || label;
          // Tier system: basic = 8-day message retention (identity permanent), lite/lite = 30-day retention + send enabled + Safe body
          const accountTier: string = (email as any).accountTier || 'basic';
          const expiresAt = null; // All BYO tiers: permanent — governed by NFT ownership, not a subscription clock

          const kvEntry = JSON.stringify({
            controller,
            origin_nft: originNft,
            legacy_identity: legacyIdentity,
            minted_tokenId: mintedTokenId,
            registrar: '0x831ddd71e7c33e16b674099129e6e379da407faf',
            chain: 'gnosis',
            registered_at: Date.now(),
          });
          const tierRetention = accountTier === 'professional' ? 'never' : accountTier === 'lite' ? '30-day' : '8-day';
          const tierSends = accountTier === 'professional' ? 'unlimited' : accountTier === 'lite' ? 100 : 10;
          const tierEntry = JSON.stringify({
            tier: accountTier,
            expires_at: expiresAt,
            upgraded_at: null,
            safe: safeFromRequest,
            retention: tierRetention,
            account_ttl: 'never',
            story_ip: null,
            sendsRemaining: tierSends,
            sendsUsed: 0,
          });
          // Derive SLD from originNft e.g. 'ghostagent.vault.gno' → 'vault'
          const originParts = originNft.split('.');
          const sldFromOrigin = originParts.length >= 3 ? originParts[originParts.length - 2] : 'nftmail';

          const kvWrites: Promise<void>[] = [
            env.INBOX_KV.put(`nftmailgno:${kvKey}`, kvEntry),
            env.INBOX_KV.put(`privacy:${kvKey}`, JSON.stringify({ tier: privacyTier })),
            env.INBOX_KV.put(`acct-tier:${kvKey}`, tierEntry),
          ];
          // Reverse index: tokenId → label for tokenURI metadata endpoint
          if (mintedTokenId !== null) {
            kvWrites.push(env.INBOX_KV.put(`nft-token:${sldFromOrigin}:${mintedTokenId}`, JSON.stringify({ label, sld: sldFromOrigin, mintedAt: Date.now() })));
          }
          await Promise.all(kvWrites);
          // Increment account counter after successful registration
          await env.INBOX_KV.put(acctKey, String(acctCount + 1));

          // ── Phase 1 D1 shadow write ──────────────────────────────────────
          // LITE+ only on registration (BASIC stays KV-only).
          // Shadow mode: non-fatal, KV is still source of truth.
          if ((accountTier === 'lite' || accountTier === 'professional' || accountTier === 'premium' || accountTier === 'ghost') && env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              await d1.upsertAgent({
                label: kvKey,
                controller: controller.toLowerCase(),
                tld: sldFromOrigin !== 'nftmail' ? `${sldFromOrigin}.gno` : 'nftmail.gno',
                tier: accountTier,
                safe: safeFromRequest,
                ecies_pubkey: null,
                retention: tierRetention === 'never' ? 'infinite' : tierRetention,
                expires_at: expiresAt,
                story_ip: null,
                origin_nft: originNft,
                origin_image: null,
                upgraded_at: null,
                zerog_root_hash: null,
                zerog_archived_at: null,
              });
            } catch (d1Err) {
              console.error('[D1 shadow] registerSovereign write failed (non-fatal):', d1Err);
            }
          }

          return corsify(Response.json({
            status: 'registered',
            label,
            email: `${kvKey}@nftmail.box`,
            controller,
            originNft,
            privacyTier,
            accountTier,
            expiresAt,
            accountsUsed: acctCount + 1,
            accountLimit: ACCT_LIMIT,
          }), request);
        }

        // --- FID Provision: BASIC agent from Farcaster Frame (no wallet required) ---
        // Creates a KV-only BASIC agent tied to a Farcaster ID.
        // 8-day retention; upgrade path via BYO NFT molt or wallet linking.
        // Frame server validates Farcaster message signature before calling this.
        if (email.action === 'provisionFidAgent') {
          // Public action — FID is the auth principal, no secret required
          const fid: number = parseInt((email as any).fid || '0', 10);
          if (!fid || fid <= 0) {
            return corsify(Response.json({ error: 'Missing or invalid fid' }, { status: 400 }), request);
          }

          // ── Resolve Farcaster fname via fname registry ───────────────────────
          // fname.cast@nftmail.box — human-readable, namespace-safe
          // Falls back to fid-{N}.cast if no fname registered
          let resolvedFname = `fid-${fid}`;
          let verifiedAddresses: string[] = [];
          try {
            const fnameRes = await fetch(`https://fnames.farcaster.xyz/transfers?fid=${fid}`);
            if (fnameRes.ok) {
              const fnameData = await fnameRes.json() as { transfers?: Array<{ username: string; to: number; from: number }> };
              // Most recent transfer TO this fid with from=0 is the active fname registration
              const active = fnameData?.transfers?.filter(t => t.to === fid && t.from === 0).pop();
              if (active?.username) resolvedFname = active.username.toLowerCase().replace(/[^a-z0-9.-]/g, '');
            }
          } catch { /* non-fatal — use fid fallback */ }

          // Reserved prefixes — block impersonation of protocol/well-known names
          const RESERVED_PREFIXES = ['admin','support','security','noreply','no-reply','postmaster','abuse','hostmaster','webmaster','info','help','team','ghostagent','eyemine','victor','vitalik','ethereum','metamask','opensea','uniswap','coinbase','binance','kraken','safe','gnosis'];
          const baseFname = resolvedFname.replace(/\.eth$/, ''); // strip .eth for prefix check
          if (RESERVED_PREFIXES.includes(baseFname)) {
            return corsify(Response.json({ error: `Name "${resolvedFname}" is reserved` }, { status: 400 }), request);
          }

          // preferredName overrides fname only if explicitly provided and not reserved
          const preferredName: string = ((email as any).preferredName || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
          if (preferredName && RESERVED_PREFIXES.includes(preferredName)) {
            return corsify(Response.json({ error: `Name "${preferredName}" is reserved` }, { status: 400 }), request);
          }
          const baseName = preferredName || resolvedFname;

          // Name format: {fname}.cast or {preferred}.cast — unambiguous Farcaster namespace
          const agentName = `${baseName}.cast`;
          const humanEmail = `${agentName}@nftmail.box`;
          const agentEmail = `${agentName}_@nftmail.box`;

          // Check if already provisioned
          const existing = await env.INBOX_KV.get(`nftmailgno:${agentName}`);
          if (existing) {
            const existingData = JSON.parse(existing);
            const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
            const tierData = tierRaw ? JSON.parse(tierRaw) : { tier: 'basic' };
            return corsify(Response.json({
              status: 'already_provisioned',
              agentName,
              humanEmail,
              agentEmail,
              fid,
              tier: tierData.tier,
              walletLinked: !!existingData.controller && !existingData.controller.startsWith('fid:'),
            }), request);
          }

          // BASIC tier: 8-day inbox history window, no Safe, KV-only
          // Farcaster accounts: NO expiry - just exhaust send quota
          const EIGHT_DAYS_MS  =  8 * 24 * 60 * 60 * 1000;
          const now = Date.now();

          const kvEntry = JSON.stringify({
            controller: `fid:${fid}`, // FID is the principal until wallet linked
            type: 'basic', // BASIC tier — same as 'free' for upgrade purposes
            origin_nft: null, // No NFT for BASIC
            legacy_identity: null,
            minted_tokenId: null,
            registrar: null,
            chain: null,
            registered_at: now,
            fid,
            fname: resolvedFname, // Farcaster username at time of provisioning
            verified_addresses: verifiedAddresses, // ETH addresses verified in Farcaster app
          });

          const tierEntry = JSON.stringify({
            tier: 'basic', // BASIC
            expires_at: null, // Farcaster: no account expiry - exhaust sends instead
            upgraded_at: null,
            safe: null,
            retention: '8-day',   // inbox history window
            account_ttl: 'never', // account never expires, just exhausts sends
            story_ip: null,
            sendsRemaining: 10,
            sendsUsed: 0,
          });

          // Privacy visibility settings from Frame (defaults to safe values)
          const farcasterVis = ((email as any).farcasterVisibility as 'hidden' | 'fid-only' | 'full') || 'fid-only';
          const emailVis = ((email as any).emailVisibility as 'hidden' | 'domain-only' | 'full') || 'hidden';

          // ── Generate ECIES keypair — pubkey stored, privkey returned once, never stored ──
          // This is the stopgap until client-side keygen (Option 3 migration).
          // The privkey window: exists in worker memory during this request only.
          // The Mailgun window is separate and unaffected — closed by CF Email Workers migration.
          let eciesPublicKey: string | null = null;
          let eciesPrivateKey: string | null = null;
          try {
            const kp = await generateKeyPair();
            eciesPublicKey = kp.publicKey;
            eciesPrivateKey = kp.privateKey;
          } catch (ekErr) {
            console.error('[provisionFidAgent] ECIES keygen failed (non-fatal):', ekErr);
          }

          const kvWrites: Promise<void>[] = [
            env.INBOX_KV.put(`nftmailgno:${agentName}`, kvEntry),
            env.INBOX_KV.put(`acct-tier:${agentName}`, tierEntry),
            env.INBOX_KV.put(`privacy:${agentName}`, JSON.stringify({
              tier: 'exposed',
              farcasterVisibility: farcasterVis,
              emailVisibility: emailVis,
            })),
            // Index by FID for lookup
            env.INBOX_KV.put(`fid-agent:${fid}`, JSON.stringify({ agentName, provisionedAt: now })),
          ];
          if (eciesPublicKey) {
            kvWrites.push(env.INBOX_KV.put(`ecies-pubkey:${agentName}`, eciesPublicKey));
          }
          await Promise.all(kvWrites);

          // ── Auto-send welcome email into KV inbox + Mailgun outbound ─────────────
          try {
            const welcomeBody = `# Welcome to nftmail.box

Your sovereign agent inbox is live.

---

## Your addresses

**Human inbox** — ${humanEmail}
For people to reach you. Encrypted end-to-end.

**Agent inbox** — ${agentEmail}
For machines, APIs, and autonomous agents.
Trailing underscore = machine-readable mail. Routes to the same NFTmail.box account.

---

## Service tiers

**BASIC** — Free. Farcaster-authenticated. 8-day inbox history. 10 sends.

**PRO** — Permanent. NFT-governed.
Mint a BYO NFT on nftmail.box to claim this tier.
- 30-day inbox history - 10 email sentbox storage
- 100 sends max per day
- Gnosis Safe created as your on-chain controller
- Address is yours when you hold the beacon NFT in your wallet

**PREMIUM** — Sovereign. Annual Subscription (reverts to PRO features)
- Unlimited retention, 100 sends daily - 1 Domain alias - email auto-forwarding
- Full multisig Safe ownership
- On-chain attestations, HITL module access

---

*nftmail.box · ERC-8004 trustless agent protocol*`;

            const welcomePayload = {
              payload: {
                from: 'ghostagent <ghostagent@nftmail.box>',
                subject: `Welcome to nftmail.box — ${humanEmail} is live`,
                body: welcomeBody,
              },
              receivedAt: Date.now(),
              type: 'email',
            };
            const welcomeId = `welcome-${Date.now()}`;
            let welcomeMsg: string;
            if (eciesPublicKey) {
              try {
                const env2 = await eciesEncrypt(JSON.stringify(welcomePayload), eciesPublicKey);
                welcomeMsg = JSON.stringify({ type: 'ecies-blind', encrypted: true, envelope: env2, receivedAt: welcomePayload.receivedAt });
              } catch {
                welcomeMsg = JSON.stringify(welcomePayload);
              }
            } else {
              welcomeMsg = JSON.stringify(welcomePayload);
            }
            const existingIdx = await env.INBOX_KV.get(`blind-index:${agentName}`);
            const welcomeIds: string[] = existingIdx ? JSON.parse(existingIdx) : [];
            welcomeIds.unshift(welcomeId);
            await Promise.all([
              env.INBOX_KV.put(`blind:${agentName}:${welcomeId}`, welcomeMsg),
              env.INBOX_KV.put(`blind-index:${agentName}`, JSON.stringify(welcomeIds.slice(0, 50))),
            ]);

            // ── Mailgun outbound send (best-effort) ───────────────────────────────
            const sendKey = env.MG_SENDING_MAILGUN_API_KEY || env.MG_MAILGUN_API_KEY || env.GM_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY;
            if (sendKey) {
              const form = new URLSearchParams();
              form.append('from', 'nftmail.box <noreply@mg.nftmail.box>');
              form.append('to', humanEmail);
              form.append('bcc', 'ghostagent@nftmail.box');
              form.append('subject', `Welcome to nftmail.box — ${humanEmail} is live`);
              form.append('text', welcomeBody);
              form.append('h:Reply-To', humanEmail);
              fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
                method: 'POST',
                headers: { Authorization: `Basic ${btoa(`api:${sendKey}`)}` },
                body: form,
              }).catch((mgErr) => {
                console.error('[provisionFidAgent] Mailgun welcome send failed (non-fatal):', mgErr);
              });
            }
          } catch (wErr) {
            console.error('[provisionFidAgent] welcome email failed (non-fatal):', wErr);
          }

          return corsify(Response.json({
            status: 'provisioned',
            agentName,
            humanEmail,
            agentEmail,
            fid,
            tier: 'basic',
            expiresAt: null,
            walletLinked: false,
            upgradePath: '/byo-molt',
            eciesPublicKey,
            ...(eciesPrivateKey ? {
              eciesPrivateKey,
              eciesPrivateKeyWarning: 'Store this private key securely in your client. It will NOT be stored on the server. Required to decrypt your inbox.',
            } : {}),
          }), request);
        }

        // --- linkWallet: bind an EOA to a Farcaster-provisioned agent ---
        // Called from the mini app after user confirms wallet via Farcaster client.
        // Updates nftmailgno: controller from fid:N to EOA, making the account
        // visible in listAgents and eligible for byo-molt upgrade.
        // Auth: fid + agentName must match existing provisioned record.
        if (email.action === 'linkWallet') {
          const fid: number = parseInt((email as any).fid || '0', 10);
          const agentName: string = ((email as any).agentName || '').toLowerCase().trim();
          const walletAddress: string = ((email as any).walletAddress || '').toLowerCase().trim();

          if (!fid || fid <= 0) return corsify(Response.json({ error: 'Missing fid' }, { status: 400 }), request);
          if (!agentName) return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          if (!walletAddress || !/^0x[a-f0-9]{40}$/.test(walletAddress)) {
            return corsify(Response.json({ error: 'Invalid walletAddress' }, { status: 400 }), request);
          }

          const regRaw = await env.INBOX_KV.get(`nftmailgno:${agentName}`);
          if (!regRaw) return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);

          let reg: any = {};
          try { reg = JSON.parse(regRaw); } catch {}

          // Verify this fid matches the provisioned record
          if (reg.fid !== fid) {
            return corsify(Response.json({ error: 'FID does not match agent record' }, { status: 403 }), request);
          }

          // Optionally verify walletAddress is a verified address for this FID
          // (non-fatal — Farcaster wallet connect is sufficient auth)
          let isVerifiedAddress = false;
          try {
            const fcRes = await fetch(`https://fnames.farcaster.xyz/transfers?fid=${fid}`);
            if (fcRes.ok) {
              // Try Neynar verified addresses
              const neynarRes = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
                headers: { 'accept': 'application/json', 'x-neynar-experimental': 'false' },
              });
              if (neynarRes.ok) {
                const nd = await neynarRes.json() as any;
                const user = nd?.users?.[0];
                const verified = (user?.verified_addresses?.eth_addresses ?? []).map((a: string) => a.toLowerCase());
                const custody = (user?.custody_address ?? '').toLowerCase();
                isVerifiedAddress = verified.includes(walletAddress) || custody === walletAddress;
              }
            }
          } catch { /* non-fatal */ }

          // Update controller to EOA
          const updatedReg = { ...reg, controller: walletAddress, wallet_linked_at: Date.now(), fid_verified: isVerifiedAddress };
          await env.INBOX_KV.put(`nftmailgno:${agentName}`, JSON.stringify(updatedReg));

          // Update acct-tier controller too
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
          let tierData: any = {};
          try { tierData = tierRaw ? JSON.parse(tierRaw) : {}; } catch {}
          tierData.controller = walletAddress;
          tierData.wallet_linked_at = Date.now();
          await env.INBOX_KV.put(`acct-tier:${agentName}`, JSON.stringify(tierData));

          return corsify(Response.json({
            status: 'linked',
            agentName,
            walletAddress,
            isVerifiedAddress,
            tier: tierData.tier || 'basic',
          }), request);
        }

        // --- sendTestEmail: self-send to verify inbox loop from Mini App ---
        if (email.action === 'sendTestEmail') {
          const agentName: string = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
          if (!tierRaw) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          const tierData = JSON.parse(tierRaw);
          // Only check expiration for basic/lite tiers (professional/vault have no expiration)
          // Farcaster mini-app accounts have account_ttl='never' / expires_at=null — never expire,
          // they exhaust their lifetime sends instead.
          const tier = tierData.tier || 'basic';
          if (tier === 'basic' || tier === 'lite') {
            const ttlNever = tierData.account_ttl === 'never';
            const expAt = typeof tierData.expires_at === 'number' ? tierData.expires_at : null;
            if (!ttlNever && expAt !== null && Date.now() > expAt) {
              return corsify(Response.json({ error: 'Inbox expired' }, { status: 410 }), request);
            }
          }
          const remaining = typeof tierData.sendsRemaining === 'number' ? tierData.sendsRemaining : 10;
          if (remaining <= 0) {
            return corsify(Response.json({ error: 'Send limit reached', sendsRemaining: 0 }, { status: 429 }), request);
          }
          const nowMs = Date.now();
          const nowStr = new Date(nowMs).toISOString();
          const msgId = `test-${nowMs}`;
          const toEmail = `${agentName}@nftmail.box`;
          const msgBody = `Hi ${agentName},\n\nThis test email confirms your nftmail.box inbox is live.\n\nInbox: ${toEmail}\nSent: ${nowStr}\nSends remaining after this: ${remaining - 1}\n\n— nftmail.box`;

          // Write directly to KV blind-index — encrypt if pubkey exists, plaintext fallback
          const plainPayload = {
            payload: { from: 'noreply@mg.nftmail.box', subject: `Test — ${agentName} inbox is operational`, body: msgBody },
            receivedAt: nowMs,
            type: 'email',
          };
          // Use sending API key (not inbound HMAC signing key)
          const sendKey = env.MG_SENDING_MAILGUN_API_KEY || env.MG_MAILGUN_API_KEY || env.GM_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY;
          const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
          let msgPayload: string;
          if (pubKeyHex) {
            try {
              const envelope = await eciesEncrypt(JSON.stringify(plainPayload), pubKeyHex);
              msgPayload = JSON.stringify({ type: 'ecies-blind', encrypted: true, envelope, receivedAt: nowMs });
            } catch {
              msgPayload = JSON.stringify(plainPayload);
            }
          } else {
            msgPayload = JSON.stringify(plainPayload);
          }
          const blindIdxRaw = await env.INBOX_KV.get(`blind-index:${agentName}`);
          const blindIds: string[] = blindIdxRaw ? (() => { try { return JSON.parse(blindIdxRaw); } catch { return []; } })() : [];
          blindIds.unshift(msgId);
          await Promise.all([
            env.INBOX_KV.put(`blind:${agentName}:${msgId}`, msgPayload),
            env.INBOX_KV.put(`blind-index:${agentName}`, JSON.stringify(blindIds.slice(0, 50))),
          ]);

          // Also fire Mailgun outbound if key available (best-effort)
          if (sendKey) {
            const form = new URLSearchParams();
            form.append('from', 'nftmail.box <noreply@mg.nftmail.box>');
            form.append('to', toEmail);
            form.append('subject', `Test — ${agentName} inbox is operational`);
            form.append('text', msgBody);
            fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
              method: 'POST',
              headers: { Authorization: `Basic ${btoa(`api:${sendKey}`)}` },
              body: form,
            }).catch(() => {});
          }

          tierData.sendsRemaining = remaining - 1;
          await env.INBOX_KV.put(`acct-tier:${agentName}`, JSON.stringify(tierData));
          return corsify(Response.json({ status: 'sent', sendsRemaining: tierData.sendsRemaining }), request);
        }

        // --- sendOutbound: compose + send from agentname.cast@nftmail.box to any address ---
        if (email.action === 'sendOutbound') {
          const agentName: string = ((email as any).agentName || '').toLowerCase().trim();
          const to: string = ((email as any).to || '').trim();
          const cc: string | string[] | undefined = (email as any).cc;
          const bcc: string | string[] | undefined = (email as any).bcc;
          const subject: string = ((email as any).subject || '').trim();
          const body: string = ((email as any).body || '').trim();
          if (!agentName || !to || !subject || !body) {
            return corsify(Response.json({ error: 'Missing agentName, to, subject or body' }, { status: 400 }), request);
          }
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
          if (!tierRaw) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          const tierData = JSON.parse(tierRaw);
          // Only check expiration for basic/lite tiers (professional/vault have no expiration)
          // Farcaster mini-app accounts have account_ttl='never' / expires_at=null — never expire,
          // they exhaust their lifetime sends instead.
          const tier: string = tierData.tier || 'basic';
          if (tier === 'basic' || tier === 'lite') {
            const ttlNever = tierData.account_ttl === 'never';
            const expAt = typeof tierData.expires_at === 'number' ? tierData.expires_at : null;
            if (!ttlNever && expAt !== null && Date.now() > expAt) {
              return corsify(Response.json({ error: 'Inbox expired' }, { status: 410 }), request);
            }
          }

          // ── Rolling send-limit logic ──────────────────────────────────────────
          // BASIC (basic): 10 lifetime sends (sendsRemaining, no reset)
          // LITE:          100 sends/day rolling — counter resets each UTC day
          // PREMIUM / vault: unlimited
          // tier already declared above
          const nowMs = Date.now();
          // UTC midnight of today (ms)
          const todayUtcMs = nowMs - (nowMs % 86400000);

          let sendsRemainingOut: number | string = 'unlimited';

          if (tier === 'basic') {
            // Lifetime counter
            const remaining = typeof tierData.sendsRemaining === 'number' ? tierData.sendsRemaining : 10;
            if (remaining <= 0) {
              return corsify(Response.json({ error: 'Send limit reached', sendsRemaining: 0 }, { status: 429 }), request);
            }
            tierData.sendsRemaining = remaining - 1;
            tierData.sendsUsed = (tierData.sendsUsed || 0) + 1;
            sendsRemainingOut = tierData.sendsRemaining;
          } else if (tier === 'lite') {
            const DAILY_LIMIT = 100;
            // Reset counter if we've crossed into a new UTC day
            if ((tierData.dailySendWindowStart || 0) < todayUtcMs) {
              tierData.dailySendCount = 0;
              tierData.dailySendWindowStart = todayUtcMs;
            }
            const used = tierData.dailySendCount || 0;
            if (used >= DAILY_LIMIT) {
              const resetAt = todayUtcMs + 86400000;
              return corsify(Response.json({
                error: 'Send limit reached',
                sendsRemaining: 0,
                dailyLimit: DAILY_LIMIT,
                resetsAt: resetAt,
              }, { status: 429 }), request);
            }
            tierData.dailySendCount = used + 1;
            tierData.dailySendWindowStart = todayUtcMs;
            sendsRemainingOut = DAILY_LIMIT - tierData.dailySendCount;
          }
          // premium / vault / professional: fall through with sendsRemainingOut = 'unlimited'

          const sendApiKey = env.MG_SENDING_MAILGUN_API_KEY || env.MG_MAILGUN_API_KEY || env.GM_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY;
          if (!sendApiKey) {
            return corsify(Response.json({ error: 'Email sending not configured' }, { status: 503 }), request);
          }
          const fromEmail = `${agentName}@nftmail.box`;
          const form = new URLSearchParams();
          form.append('from', `${agentName} <${fromEmail}>`);
          form.append('to', to);
          
          // Add CC/BCC if provided
          if (cc) {
            const ccList = Array.isArray(cc) ? cc : [cc];
            ccList.filter(c => c.trim()).forEach(c => form.append('cc', c.trim()));
          }
          if (bcc) {
            const bccList = Array.isArray(bcc) ? bcc : [bcc];
            bccList.filter(b => b.trim()).forEach(b => form.append('bcc', b.trim()));
          }
          
          form.append('subject', subject);
          form.append('text', body);
          form.append('h:Reply-To', fromEmail);
          const mgRes = await fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa(`api:${sendApiKey}`)}` },
            body: form,
          });
          if (!mgRes.ok) {
            const err = await mgRes.text();
            console.log('[sendOutbound] Mailgun error:', mgRes.status, err.slice(0, 200));
            return corsify(Response.json({ error: `Mailgun error: ${err.slice(0, 100)}` }, { status: 502 }), request);
          }
          // ── Internal delivery shortcut for @nftmail.box recipients ────────────
          // Bypasses MX round-trip — writes directly to recipient KV inbox.
          // Belt-and-braces: also shadow-writes to D1 for non-basic agents so
          // getInbox (D1-first path) returns the message immediately.
          const toNorm = to.toLowerCase().trim();
          if (toNorm.endsWith('@nftmail.box')) {
            const recipLocal = toNorm.slice(0, -'@nftmail.box'.length);
            try {
              const recipTierRaw = await env.INBOX_KV.get(`acct-tier:${recipLocal}`);
              if (recipTierRaw) {
                const recipTier: string = (JSON.parse(recipTierRaw) as { tier?: string }).tier || 'basic';
                const ttlMap: Record<string, number> = { basic: 8 * 86400, lite: 30 * 86400, professional: 365 * 86400, vault: 365 * 86400 };
                const recipTtl = ttlMap[recipTier] ?? 8 * 86400;
                const internalTs = Date.now();
                const internalBlindId = `blind-${internalTs}-${crypto.randomUUID().slice(0, 8)}`;
                const internalPlaintext = JSON.stringify({ from: `${agentName}@nftmail.box`, to: `${recipLocal}@nftmail.box`, subject, body, timestamp: internalTs });
                // Encrypt with recipient ECIES key if available — matches inbound mail pattern
                const recipPubKey = await env.INBOX_KV.get(`ecies-pubkey:${recipLocal}`);
                let internalEnvelope: string;
                if (recipPubKey) {
                  try {
                    const encEnv = await eciesEncrypt(internalPlaintext, recipPubKey);
                    internalEnvelope = JSON.stringify({ type: 'agent-ecies-blind', encrypted: true, envelope: encEnv, receivedAt: internalTs, channel: 'internal' });
                  } catch {
                    internalEnvelope = JSON.stringify({ type: 'human-cleartext-warning', encrypted: false, warning: 'ECIES encrypt failed — stored cleartext.', payload: JSON.parse(internalPlaintext), receivedAt: internalTs, channel: 'internal' });
                  }
                } else {
                  internalEnvelope = JSON.stringify({ type: 'human-cleartext-warning', encrypted: false, warning: 'No ECIES key registered.', payload: JSON.parse(internalPlaintext), receivedAt: internalTs, channel: 'internal' });
                }
                await env.INBOX_KV.put(`blind:${recipLocal}:${internalBlindId}`, internalEnvelope, { expirationTtl: recipTtl });
                await updateBlindIndex(env, recipLocal, internalBlindId, '', recipTtl);
                // Shadow-write to D1/SQLite for LITE+ agents so getInbox D1-first path finds it
                if (recipTier !== 'basic' && env.NFTMAIL_DB) {
                  try {
                    const d1 = new D1Store(env.NFTMAIL_DB);
                    await d1.insertEmail({
                      agent_label: recipLocal,
                      blind_id: internalBlindId,
                      domain_prefix: '',
                      encrypted_blob: internalEnvelope,
                      sender_hash: null,
                      subject_hash: null,
                      received_at: internalTs,
                      read: 0,
                      frozen: 0,
                      surge_allocation: null,
                      ttl_expires_at: internalTs + recipTtl * 1000,
                    });
                  } catch (d1Err) {
                    console.error('[sendOutbound] D1 shadow write failed (non-fatal):', d1Err);
                  }
                }
                console.log(`[sendOutbound] internal delivery → ${recipLocal} (tier:${recipTier}, encrypted:${!!recipPubKey})`);
              }
            } catch (e) {
              console.error('[sendOutbound] internal delivery failed (non-fatal):', e);
            }
          }
          await env.INBOX_KV.put(`acct-tier:${agentName}`, JSON.stringify(tierData));
          return corsify(Response.json({ status: 'sent', sendsRemaining: sendsRemainingOut }), request);
        }

        // ── Transmission actions — handled by dispatch router above ──────────
        // sendTransmission | getDocumentTray | getTransmission | acknowledgeTransmission
        // See handlers/transmission.ts
        if (false && email.action === 'sendTransmission') {
          const txFromName: string = ((email as any).fromName || '').toLowerCase().trim();
          const txToEmail: string = ((email as any).toEmail || '').trim();
          const txImageData: string = ((email as any).imageData || '').trim(); // base64
          const txMimeType: string = ((email as any).mimeType || '').toLowerCase().trim();
          const txFileName: string = ((email as any).fileName || 'transmission').trim();

          const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/bmp', 'image/tiff'];
          if (!txFromName || !txToEmail || !txImageData || !txMimeType) {
            return corsify(Response.json({ error: 'Missing fromName, toEmail, imageData or mimeType' }, { status: 400 }), request);
          }
          if (!ALLOWED_MIME.includes(txMimeType)) {
            return corsify(Response.json({ error: `Unsupported type: ${txMimeType}. Allowed: PNG, JPEG, BMP, TIFF.` }, { status: 415 }), request);
          }
          if (txImageData.length > 7 * 1024 * 1024) {
            return corsify(Response.json({ error: 'Image exceeds 5MB limit' }, { status: 413 }), request);
          }
          const txTierRaw = await env.INBOX_KV.get(`acct-tier:${txFromName}`);
          if (!txTierRaw) {
            return corsify(Response.json({ error: 'Sender agent not found' }, { status: 404 }), request);
          }
          const txTierData = JSON.parse(txTierRaw);
          const txTier: string = txTierData.tier || 'basic';
          if (txTier === 'basic') {
            return corsify(Response.json({ error: 'Basic tier cannot send transmissions. Upgrade to send.' }, { status: 402 }), request);
          }
          const txNowMs = Date.now();
          const txTodayUtcMs = txNowMs - (txNowMs % 86400000);
          let txSendsRemaining: number | string = 'unlimited';
          if (txTier === 'lite') {
            const DAILY_LIMIT = 100;
            if ((txTierData.dailySendWindowStart || 0) < txTodayUtcMs) {
              txTierData.dailySendCount = 0;
              txTierData.dailySendWindowStart = txTodayUtcMs;
            }
            const txUsed = txTierData.dailySendCount || 0;
            if (txUsed >= DAILY_LIMIT) {
              return corsify(Response.json({ error: 'Daily send limit reached', sendsRemaining: 0 }, { status: 429 }), request);
            }
            txTierData.dailySendCount = txUsed + 1;
            txTierData.dailySendWindowStart = txTodayUtcMs;
            txSendsRemaining = DAILY_LIMIT - txTierData.dailySendCount;
          }
          const txId = `tx-${txNowMs}-${crypto.randomUUID().slice(0, 8)}`;
          const txRecord = JSON.stringify({
            id: txId,
            from: `${txFromName}@nftmail.box`,
            to: txToEmail,
            mimeType: txMimeType,
            fileName: txFileName,
            imageData: txImageData,
            sentAt: txNowMs,
            acknowledged: false,
          });
          const txSendApiKey = env.MG_SENDING_MAILGUN_API_KEY || env.MG_MAILGUN_API_KEY || env.GM_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY;
          const txSubject = `[TRANSMISSION] ${txId.slice(0, 20)} from ${txFromName}@nftmail.box`;
          const txCoverHtml = `<!DOCTYPE html><html><body style="background:#111;color:#d4d4aa;font-family:monospace;padding:24px;max-width:520px"><pre style="border:1px solid #444;padding:16px;font-size:12px;line-height:1.6">================================
  AGENT TRANSMISSION RECEIVED
================================
FROM  : ${txFromName}@nftmail.box
TO    : ${txToEmail}
TX ID : ${txId}
DATE  : ${new Date(txNowMs).toISOString().replace('T', ' ').slice(0, 19)} UTC
TYPE  : ${txMimeType}
================================
Visit your Document Tray to view
and acknowledge this transmission.
================================</pre><p style="color:#888;font-size:11px;margin-top:16px">Bitmap-only secure channel. No executables. No macros. No scripts.</p></body></html>`;
          const txToNorm = txToEmail.toLowerCase().trim();
          if (txToNorm.endsWith('@nftmail.box')) {
            const txRecipLocal = txToNorm.slice(0, -'@nftmail.box'.length);
            const txRecipTierRaw = await env.INBOX_KV.get(`acct-tier:${txRecipLocal}`);
            if (!txRecipTierRaw) {
              return corsify(Response.json({ error: 'Recipient not found on nftmail.box' }, { status: 404 }), request);
            }
            const txRecipTier: string = (JSON.parse(txRecipTierRaw) as { tier?: string }).tier || 'basic';
            const txTtlMap: Record<string, number> = { basic: 8 * 86400, lite: 30 * 86400, professional: 365 * 86400, vault: 365 * 86400 };
            const txRecipTtl = txTtlMap[txRecipTier] ?? 8 * 86400;
            await env.INBOX_KV.put(`tray:${txRecipLocal}:${txId}`, txRecord, { expirationTtl: txRecipTtl });
            if (txSendApiKey) {
              try {
                const txNotifForm = new URLSearchParams();
                txNotifForm.append('from', `${txFromName} <${txFromName}@nftmail.box>`);
                txNotifForm.append('to', txToEmail);
                txNotifForm.append('subject', txSubject);
                txNotifForm.append('html', txCoverHtml);
                txNotifForm.append('text', `Transmission received from ${txFromName}@nftmail.box. Visit your Document Tray to collect.`);
                await fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
                  method: 'POST',
                  headers: { Authorization: `Basic ${btoa(`api:${txSendApiKey}`)}` },
                  body: txNotifForm,
                });
              } catch (txNotifErr) {
                console.error('[sendTransmission] notification email failed (non-fatal):', txNotifErr);
              }
            }
          } else {
            if (!txSendApiKey) {
              return corsify(Response.json({ error: 'Email sending not configured' }, { status: 503 }), request);
            }
            const txBinaryStr = atob(txImageData);
            const txBytes = new Uint8Array(txBinaryStr.length);
            for (let i = 0; i < txBinaryStr.length; i++) txBytes[i] = txBinaryStr.charCodeAt(i);
            const txBlob = new Blob([txBytes], { type: txMimeType });
            const txForm = new FormData();
            txForm.append('from', `${txFromName} <${txFromName}@nftmail.box>`);
            txForm.append('to', txToEmail);
            txForm.append('subject', txSubject);
            txForm.append('html', txCoverHtml);
            txForm.append('text', `Transmission from ${txFromName}@nftmail.box — bitmap attachment enclosed.`);
            txForm.append('attachment', txBlob, txFileName);
            const txMgRes = await fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
              method: 'POST',
              headers: { Authorization: `Basic ${btoa(`api:${txSendApiKey}`)}` },
              body: txForm,
            });
            if (!txMgRes.ok) {
              const txErr = await txMgRes.text();
              return corsify(Response.json({ error: `Mailgun error: ${txErr.slice(0, 100)}` }, { status: 502 }), request);
            }
          }
          await env.INBOX_KV.put(`acct-tier:${txFromName}`, JSON.stringify(txTierData));
          return corsify(Response.json({ status: 'transmitted', txId, sendsRemaining: txSendsRemaining }), request);
        }

        if (false && email.action === 'getDocumentTray') {
          const trayLocal: string = ((email as any).localPart || '').toLowerCase().trim();
          if (!trayLocal) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const trayListed = await env.INBOX_KV.list({ prefix: `tray:${trayLocal}:` });
          const trayItems = await Promise.all(
            trayListed.keys.map(async (k) => {
              const raw = await env.INBOX_KV.get(k.name);
              if (!raw) return null;
              const { imageData: _img, ...meta } = JSON.parse(raw) as Record<string, unknown>;
              return meta;
            })
          );
          return corsify(Response.json({ transmissions: trayItems.filter(Boolean) }), request);
        }

        if (false && email.action === 'getTransmission') {
          const gtLocal: string = ((email as any).localPart || '').toLowerCase().trim();
          const gtTxId: string = ((email as any).txId || '').trim();
          if (!gtLocal || !gtTxId) {
            return corsify(Response.json({ error: 'Missing localPart or txId' }, { status: 400 }), request);
          }
          const gtRaw = await env.INBOX_KV.get(`tray:${gtLocal}:${gtTxId}`);
          if (!gtRaw) {
            return corsify(Response.json({ error: 'Transmission not found' }, { status: 404 }), request);
          }
          return corsify(Response.json(JSON.parse(gtRaw)), request);
        }

        if (false && email.action === 'acknowledgeTransmission') {
          const ackLocal: string = ((email as any).localPart || '').toLowerCase().trim();
          const ackTxId: string = ((email as any).txId || '').trim();
          if (!ackLocal || !ackTxId) {
            return corsify(Response.json({ error: 'Missing localPart or txId' }, { status: 400 }), request);
          }
          const ackKey = `tray:${ackLocal}:${ackTxId}`;
          const ackRaw = await env.INBOX_KV.get(ackKey);
          if (!ackRaw) {
            return corsify(Response.json({ error: 'Transmission not found or already acknowledged' }, { status: 404 }), request);
          }
          const ackRecord = JSON.parse(ackRaw);
          ackRecord.acknowledged = true;
          ackRecord.acknowledgedAt = Date.now();
          await env.INBOX_KV.put(ackKey, JSON.stringify(ackRecord), { expirationTtl: 86400 });
          return corsify(Response.json({ status: 'acknowledged', txId: ackTxId }), request);
        }

        // --- sendWelcomeEmail: send welcome email to any address (webhook-protected) ---
        if (email.action === 'sendWelcomeEmail') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const toEmail: string = ((email as any).to || '').trim();
          if (!toEmail) {
            return corsify(Response.json({ error: 'Missing to address' }, { status: 400 }), request);
          }
          const sendKey = env.MG_SENDING_MAILGUN_API_KEY || env.MG_MAILGUN_API_KEY || env.GM_MAILGUN_API_KEY || env.SEND_MAILGUN_API_KEY || env.MAILGUN_API_KEY;
          if (!sendKey) {
            return corsify(Response.json({ error: 'Mailgun API key not configured' }, { status: 500 }), request);
          }
          const welcomeBody = `# Welcome to nftmail.box

Your sovereign agent inbox is live.

---

## Your addresses

**Human inbox** — ${toEmail}
For people to reach you. Encrypted end-to-end.

**Agent inbox** — ${toEmail.replace('@', '_@')}
For machines, APIs, and autonomous agents.
Trailing underscore = machine-readable mail. Routes to the same NFTmail.box account.

---

## Service tiers

**BASIC** — Free. Farcaster-authenticated. 8-day inbox history. 10 sends.

**PRO** — Permanent. NFT-governed.
Mint a BYO NFT on nftmail.box to claim this tier.
- 30-day inbox history - 10 email sentbox storage
- 100 sends max per day
- Gnosis Safe created as your on-chain controller
- Address is yours when you hold the beacon NFT in your wallet

**PREMIUM** — Sovereign. Annual Subscription (reverts to PRO features)
- Unlimited retention, 100 sends daily - 1 Domain alias - email auto-forwarding
- Full multisig Safe ownership
- On-chain attestations, HITL module access

---

*nftmail.box · ERC-8004 trustless agent protocol*`;
          const form = new URLSearchParams();
          form.append('from', 'nftmail.box <noreply@mg.nftmail.box>');
          form.append('to', toEmail);
          form.append('bcc', 'ghostagent@nftmail.box');
          form.append('subject', `Welcome to nftmail.box — ${toEmail} is live`);
          form.append('text', welcomeBody);
          form.append('h:Reply-To', toEmail);
          const mgRes = await fetch('https://api.eu.mailgun.net/v3/mg.nftmail.box/messages', {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa(`api:${sendKey}`)}` },
            body: form,
          });
          if (!mgRes.ok) {
            const err = await mgRes.text();
            console.error('[sendWelcomeEmail] Mailgun error:', mgRes.status, err);
            return corsify(Response.json({ error: `Mailgun error: ${err.slice(0, 100)}` }, { status: 502 }), request);
          }
          return corsify(Response.json({ status: 'sent', to: toEmail }), request);
        }

        // --- upgradeFidAgent: BASIC → LITE after NFT mint ---
        // Called by mint callback. Links wallet, provisions _@ agent address, upgrades tier.
        if (email.action === 'upgradeFidAgent') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const fid: number = parseInt((email as any).fid || '0', 10);
          const wallet: string = ((email as any).wallet || '').toLowerCase().trim();
          const originNft: string = ((email as any).originNft || '').trim();
          const tokenId: string = ((email as any).tokenId || '').trim();
          if (!fid || !/^0x[a-f0-9]{40}$/.test(wallet)) {
            return corsify(Response.json({ error: 'Missing fid or invalid wallet' }, { status: 400 }), request);
          }

          // Find agent by FID
          const fidIndexRaw = await env.INBOX_KV.get(`fid-agent:${fid}`);
          if (!fidIndexRaw) {
            return corsify(Response.json({ error: 'No agent found for this FID' }, { status: 404 }), request);
          }
          const { agentName } = JSON.parse(fidIndexRaw) as { agentName: string };

          const existingRaw = await env.INBOX_KV.get(`nftmailgno:${agentName}`);
          if (!existingRaw) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }

          const now = Date.now();
          const LITE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

          // 1. Upgrade human record — link wallet, add NFT provenance
          const humanRecord = JSON.parse(existingRaw);
          humanRecord.controller = wallet;
          humanRecord.origin_nft = originNft || null;
          humanRecord.minted_tokenId = tokenId || null;
          humanRecord.upgraded_at = now;

          // 2. Upgrade tier to lite
          const tierEntry = JSON.stringify({
            tier: 'lite',
            expires_at: now + LITE_RETENTION_MS,
            upgraded_at: now,
            safe: null,
            retention: '1-year',
            story_ip: null,
            sendsRemaining: 100,
          });

          // 3. Provision _@ agent address (AI agent acting on behalf of human)
          const agentRecord = JSON.stringify({
            controller: wallet,
            origin_nft: originNft || null,
            minted_tokenId: tokenId || null,
            registrar: 'nftmail.gno',
            chain: 'gnosis',
            registered_at: now,
            fid,
            fname: humanRecord.fname || null,
            type: 'agent', // distinguishes from human address
          });
          const agentTierEntry = JSON.stringify({
            tier: 'lite',
            expires_at: now + LITE_RETENTION_MS,
            upgraded_at: now,
            safe: null,
            retention: '1-year',
            story_ip: null,
            sendsRemaining: 'unlimited',
          });

          await Promise.all([
            env.INBOX_KV.put(`nftmailgno:${agentName}`, JSON.stringify(humanRecord)),
            env.INBOX_KV.put(`acct-tier:${agentName}`, tierEntry),
            env.INBOX_KV.put(`nftmailgno:${agentName}_`, agentRecord),
            env.INBOX_KV.put(`acct-tier:${agentName}_`, agentTierEntry),
          ]);

          // ── Phase 1 D1 shadow write ──────────────────────────────────────
          // Write LITE agent to D1 for relational queries
          if (env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              await d1.upsertAgent({
                label: agentName,
                controller: wallet,
                tld: 'nftmail.gno',
                tier: 'lite',
                safe: null,
                ecies_pubkey: null,
                retention: '1-year',
                expires_at: now + LITE_RETENTION_MS,
                story_ip: null,
                origin_nft: originNft || null,
                origin_image: null,
                upgraded_at: now,
                zerog_root_hash: null,
                zerog_archived_at: null,
              });
              // Also write the _@ agent variant
              await d1.upsertAgent({
                label: `${agentName}_`,
                controller: wallet,
                tld: 'nftmail.gno',
                tier: 'lite',
                safe: null,
                ecies_pubkey: null,
                retention: '1-year',
                expires_at: now + LITE_RETENTION_MS,
                story_ip: null,
                origin_nft: originNft || null,
                origin_image: null,
                upgraded_at: now,
                zerog_root_hash: null,
                zerog_archived_at: null,
              });
            } catch (d1Err) {
              console.error('[D1 shadow] upgradeFidAgent write failed (non-fatal):', d1Err);
            }
          }

          const humanEmail = `${agentName}@nftmail.box`;
          const agentEmail = `${agentName}_@nftmail.box`;
          return corsify(Response.json({
            status: 'upgraded',
            agentName,
            humanEmail,
            agentEmail,
            tier: 'lite',
            wallet,
            message: 'BASIC → LITE. Agent address provisioned.',
          }), request);
        }

        // --- FID Link: attach a wallet to an existing FID-provisioned agent ---
        // Upgrades controller from fid:{fid} to wallet address; enables on-chain upgrade path.
        if (email.action === 'linkFidWallet') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }

          const fid: number = parseInt((email as any).fid || '0', 10);
          const wallet: string = ((email as any).wallet || '').toLowerCase().trim();
          if (!fid || !/^0x[a-f0-9]{40}$/.test(wallet)) {
            return corsify(Response.json({ error: 'Missing fid or invalid wallet' }, { status: 400 }), request);
          }

          // Find agent by FID
          const fidIndexRaw = await env.INBOX_KV.get(`fid-agent:${fid}`);
          if (!fidIndexRaw) {
            return corsify(Response.json({ error: 'No agent found for this FID' }, { status: 404 }), request);
          }
          const fidIndex = JSON.parse(fidIndexRaw);
          const agentName: string = fidIndex.agentName;

          // Update nftmailgno entry with wallet as controller
          const existingRaw = await env.INBOX_KV.get(`nftmailgno:${agentName}`);
          if (!existingRaw) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          const existing = JSON.parse(existingRaw);
          existing.controller = wallet;
          existing.wallet_linked_at = Date.now();

          await env.INBOX_KV.put(`nftmailgno:${agentName}`, JSON.stringify(existing));

          // ── Phase 1 D1 shadow write ──────────────────────────────────────
          // Update controller in D1 if agent already exists there (LITE+ agents)
          if (env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              const d1Agent = await d1.getAgent(agentName);
              if (d1Agent) {
                await d1.upsertAgent({
                  ...d1Agent,
                  controller: wallet,
                  upgraded_at: Date.now(),
                });
              }
            } catch (d1Err) {
              console.error('[D1 shadow] linkFidWallet write failed (non-fatal):', d1Err);
            }
          }

          return corsify(Response.json({
            status: 'linked',
            agentName,
            fid,
            wallet,
            message: 'Wallet linked. You can now upgrade via BYO NFT molt.',
            upgradeUrl: `/byo-molt?agent=${agentName}`,
          }), request);
        }

        // --- Delete nftmailgno account (admin cleanup) ---
        // Secured by WEBHOOK_SECRET. Removes nftmailgno:, privacy:, acct-tier: KV entries.
        if (email.action === 'deleteNftmailAccount') {
          const secret = (email as any).secret || request.headers.get('X-Webhook-Secret') || '';
          if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Invalid secret' }, { status: 401 }), request);
          }
          const label: string = ((email as any).label || '').toLowerCase().trim();
          if (!label) {
            return corsify(Response.json({ error: 'Missing label' }, { status: 400 }), request);
          }
          const existing = await env.INBOX_KV.get(`nftmailgno:${label}`);
          if (!existing) {
            return corsify(Response.json({ error: 'Not found', label }, { status: 404 }), request);
          }
          await Promise.all([
            env.INBOX_KV.delete(`nftmailgno:${label}`),
            env.INBOX_KV.delete(`privacy:${label}`),
            env.INBOX_KV.delete(`acct-tier:${label}`),
          ]);
          return corsify(Response.json({ status: 'deleted', label }), request);
        }

        // --- Ninja Tier Upgrade: promote account from basic → lite → premium → ghost ---
        // Secured by WEBHOOK_SECRET. Called by ghostagent.ninja /api/evolve after payment confirmed.
        if (email.action === 'upgradeNinjaTier') {
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

          // Lite/Lite (LITE): 30-day retention window (renewable), unlocks send
          // Premium/PRO/Premium: 1yr subscription window, infinite KV retention (no TTL on messages)
          // Ghost: full agent identity, infinite retention
          const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          const isPro = newTierStr === 'premium' || newTierStr === 'ghost' || newTierStr === 'professional';
          const isPremium = newTierStr === 'professional';
          const isLite = newTierStr === 'lite';
          const isFree = newTierStr === 'free';
          const retention: 'infinite' | '30-day' | '8-day' = ((email as any).retention === 'infinite' || isPro) ? 'infinite' : isLite ? '30-day' : '8-day';
          let newExpiresAt: number | null = existingTierData.expires_at || null;
          // lite (Lite): permanent — governed by NFT ownership, no rolling subscription clock
          if (isLite) newExpiresAt = null;
          else if (isPremium) newExpiresAt = null; // Premium: no expiry — governed by NFT ownership
          else if (isFree) newExpiresAt = Date.now() + THIRTY_DAYS_MS; // Free: hard 30-day expiry for API/SDK trial
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

          // Auto-generate ECIES keypair if not already registered — pubkey stored, privkey returned once
          let eciesPublicKey: string | null = null;
          let eciesPrivateKey: string | null = null;
          const existingPubKey = await env.INBOX_KV.get(`ecies-pubkey:${label}`);
          if (!existingPubKey) {
            try {
              const kp = await generateKeyPair();
              await env.INBOX_KV.put(`ecies-pubkey:${label}`, kp.publicKey);
              eciesPublicKey = kp.publicKey;
              eciesPrivateKey = kp.privateKey;
            } catch (ekErr) {
              console.error('ECIES keygen failed (non-fatal):', ekErr);
            }
          } else {
            eciesPublicKey = existingPubKey;
          }

          await env.INBOX_KV.put(`acct-tier:${label}`, updatedTier);

          // ── Guard: ensure nftmailgno: registration key always exists ─────
          // Prevents orphaned acct-tier records with no corresponding registration.
          const existingReg = await env.INBOX_KV.get(`nftmailgno:${label}`);
          if (!existingReg) {
            console.warn(`[upgradeTier] nftmailgno:${label} missing — creating stub registration`);
            await env.INBOX_KV.put(`nftmailgno:${label}`, JSON.stringify({
              controller: existingTierData.controller || '',
              origin_nft: `${label}.nftmail.gno`,
              legacy_identity: null,
              minted_tokenId: null,
              registrar: null,
              chain: 'gnosis',
              registered_at: Date.now(),
              stub: true,
            }));
          }

          // ── Phase 1 D1 shadow write ──────────────────────────────────────
          // LITE+ only — BASIC stays KV-only.
          // Non-fatal: KV is still source of truth until Phase 3.
          if (newTierStr !== 'basic' && env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              const existing = existingTierData;
              await d1.upsertAgent({
                label,
                controller: (existing.controller || '').toLowerCase(),
                tld: existing.tld || null,
                tier: newTierStr,
                safe: safeAddress || existing.safe || null,
                ecies_pubkey: eciesPublicKey,
                retention,
                expires_at: newExpiresAt,
                story_ip: storyIp || existing.story_ip || null,
                origin_nft: existing.origin_nft || null,
                origin_image: existing.origin_image || null,
                upgraded_at: Date.now(),
                zerog_root_hash: null,
                zerog_archived_at: null,
              });
              await d1.recordTierChange(
                label,
                existing.tier || 'basic',
                newTierStr,
                null,
                safeAddress || existing.safe || null,
              );
            } catch (d1Err) {
              console.error('[D1 shadow] upgradeTier write failed (non-fatal):', d1Err);
            }
          }

          return corsify(Response.json({
            status: 'upgraded',
            label,
            newTier: newTierStr,
            expiresAt: newExpiresAt,
            safe: safeAddress,
            storyIp,
            eciesPublicKey,
            ...(eciesPrivateKey ? { eciesPrivateKey, eciesPrivateKeyWarning: 'Save this private key securely — it will NOT be stored on the server.' } : {}),
          }), request);
        }

        // --- Freeze Email: Stake-to-Freeze High-Value Memory ---
        // Lite tier: lock 50 $SURGE against a specific emailId to remove its TTL
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
          // Verify tier is at least lite/lite
          const freezeTierRaw = await env.INBOX_KV.get(`acct-tier:${label}`);
          let freezeTierData: any = {};
          try { freezeTierData = freezeTierRaw ? JSON.parse(freezeTierRaw) : {}; } catch {}
          const freezeTier = freezeTierData.tier || 'basic';
          if (freezeTier === 'basic') {
            return corsify(Response.json({ error: 'Freeze requires Lite tier or above. Molt at nftmail.box' }, { status: 403 }), request);
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
              agentFormat: `${c.assignedName}.<tokenId>.agent@nftmail.box`,
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
            agentAddress: `${collKey}.agent@nftmail.box`,
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
          if (!secret || secret !== env.WEBHOOK_SECRET) {
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
          if (!secret || secret !== env.WEBHOOK_SECRET) {
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

        // --- Document Tray Actions ---
        // The Tray is a separate secure channel for image/bitmap transmission between
        // agents. It is NEVER embedded in HTML email — the inbox only ever receives a
        // plaintext/markup pointer notification. This keeps the entire HTML tracking
        // surface (pixels, remote loads, CSS tricks) out of the transmission path.
        //
        // setTrayDocument: store a bitmap-only document (PNG/BMP) and inject a terse
        //   plaintext notification into the recipient's inbox pointing at /tray/{id}.
        // getTrayDocument: public read of a bitmap-only document by ID, for rendering
        //   as a static <img> in the Document Tray viewer (no HTML parsing required).
        if (email.action === 'setTrayDocument') {
          const secret = (email as any).secret;
          if (!secret || secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const from = ((email as any).from || '').toLowerCase().trim();
          const to = ((email as any).to || '').toLowerCase().trim();
          const format = ((email as any).format || '').toLowerCase().trim();
          const dataBase64 = (email as any).dataBase64 as string | undefined;
          if (!from || !to || !dataBase64) {
            return corsify(Response.json({ error: 'Missing from, to, or dataBase64' }, { status: 400 }), request);
          }
          if (format !== 'png' && format !== 'bmp' && format !== 'jpg') {
            return corsify(Response.json({ error: 'Only PNG, JPG, or BMP formats are permitted' }, { status: 400 }), request);
          }
          // Cap stored size to prevent KV value-size abuse (~1.4MB base64 ≈ 1MB binary)
          if (dataBase64.length > 1_400_000) {
            return corsify(Response.json({ error: 'Document too large (max ~1MB)' }, { status: 413 }), request);
          }

          const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
          const record = { id, from, to, format, dataBase64, createdAt: Date.now() };
          await env.INBOX_KV.put(`tray:${id}`, JSON.stringify(record));

          // Inject a terse plaintext notification — never the bitmap itself — into the
          // recipient's inbox. Safe for both the HTML inbox and the markup-only mini app.
          const recipientLocal = to.split('@')[0];
          const blindId = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
          const trayUrl = `https://nftmail.box/tray/${id}`;
          const notification = {
            payload: {
              from,
              subject: `NFTfax T/#${id.slice(0, 4).toUpperCase()} — Secure Transmission`,
              body: `NFTfax T/#${id} FROM:${from} [VIEW: ${trayUrl}]`,
            },
            receivedAt: Date.now(),
            encrypted: false,
            type: 'tray-notification',
            channel: 'tray',
            trayId: id,
          };
          await env.INBOX_KV.put(`blind:${recipientLocal}:${blindId}`, JSON.stringify(notification));
          const idxRaw = await env.INBOX_KV.get(`blind-index:${recipientLocal}`);
          const idx: string[] = idxRaw ? (() => { try { return JSON.parse(idxRaw); } catch { return []; } })() : [];
          idx.unshift(blindId);
          await env.INBOX_KV.put(`blind-index:${recipientLocal}`, JSON.stringify(idx));

          return corsify(Response.json({ status: 'ok', id, trayUrl }), request);
        }

        if (email.action === 'getTrayDocument') {
          const id = ((email as any).id || '').trim();
          if (!id) {
            return corsify(Response.json({ error: 'Missing id' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`tray:${id}`);
          if (!raw) {
            return corsify(Response.json({ error: 'Document not found' }, { status: 404 }), request);
          }
          const record = JSON.parse(raw);
          return corsify(Response.json({
            id: record.id,
            from: record.from,
            format: record.format,
            dataBase64: record.dataBase64,
            createdAt: record.createdAt,
          }), request);
        }

        // setBeaconNft: store NFT contract/tokenId for an agent's beacon
        if (email.action === 'setBeaconNft') {
          const secret = (email as any).secret;
          if (!secret || secret !== env.WEBHOOK_SECRET) {
            return corsify(Response.json({ error: 'Unauthorized' }, { status: 401 }), request);
          }
          const label = ((email as any).label || '').toLowerCase().trim();
          const beaconChain = (email as any).beaconChain;
          const beaconContract = (email as any).beaconContract;
          const beaconTokenId = (email as any).beaconTokenId;
          if (!label || !beaconChain || !beaconContract || beaconTokenId === undefined) {
            return corsify(Response.json({ error: 'Missing label, beaconChain, beaconContract, or beaconTokenId' }, { status: 400 }), request);
          }
          const kvKey = `acct-tier:${label}`;
          const existingRaw = await env.INBOX_KV.get(kvKey);
          if (!existingRaw) {
            return corsify(Response.json({ error: 'Account not found' }, { status: 404 }), request);
          }
          const existing = JSON.parse(existingRaw);
          const updated = {
            ...existing,
            beaconChain,
            beaconContract,
            beaconTokenId,
          };
          await env.INBOX_KV.put(kvKey, JSON.stringify(updated));
          return corsify(Response.json({ status: 'ok', label, beaconChain, beaconContract, beaconTokenId }), request);
        }

        // ── Episodic Memory ───────────────────────────────────────────────────
        // BASIC: KV only (memory:{agentName} JSON array, capped at 200)
        // LITE:  D1 memory table, capped at 200 rows (oldest trimmed)
        // PREMIUM/GHOST: D1 memory table, unlimited rows, full tag+session filtering
        //
        // Cross-agent coordination: shared_context D1 table for LITE+, KV fallback.

        if (email.action === 'setMemory') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const incoming = (email as any).entry ?? (email as any).entries;
          if (incoming === undefined || incoming === null) {
            return corsify(Response.json({ error: 'Missing entry or entries' }, { status: 400 }), request);
          }
          const newEntries: any[] = Array.isArray(incoming) ? incoming : [incoming];

          // Resolve tier from D1 (fast) or KV fallback
          let agentTier = 'basic';
          if (env.NFTMAIL_DB) {
            try {
              const row = await new D1Store(env.NFTMAIL_DB).getAgent(agentName);
              if (row) agentTier = row.tier;
            } catch {}
          }
          if (agentTier === 'basic') {
            const tierRaw = await env.INBOX_KV.get(`acct-tier:${agentName}`);
            if (tierRaw) { try { agentTier = JSON.parse(tierRaw).tier ?? 'basic'; } catch {} }
          }

          // ── BASIC: KV path ──
          if (agentTier === 'basic') {
            const maxEntries = 200;
            const memKey = `memory:${agentName}`;
            let existing: any[] = [];
            try { const raw = await env.INBOX_KV.get(memKey); if (raw) existing = JSON.parse(raw); } catch {}
            const ts = Date.now();
            const appended = [
              ...existing,
              ...newEntries.map((e: any, i: number) => ({ id: `${ts}-${i}`, ts, ...e })),
            ].slice(-maxEntries);
            await env.INBOX_KV.put(memKey, JSON.stringify(appended));
            return corsify(Response.json({ status: 'stored', agentName, tier: 'basic', total: appended.length, appended: newEntries.length }), request);
          }

          // ── LITE+: D1 path ──
          // cap: 200 for lite, unlimited (null) for premium/ghost
          const isLite = agentTier === 'lite';
          const memoryCap = isLite ? 200 : null;
          const d1 = new D1Store(env.NFTMAIL_DB!);
          let appended = 0;
          for (const entry of newEntries) {
            const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry);
            const tag: string | undefined = entry.tag ?? (Array.isArray(entry.tags) ? entry.tags[0] : undefined);
            const sessionId: string | undefined = entry.sessionId ?? undefined;
            await d1.appendMemory(agentName, content, {
              tag,
              sessionId,
              ...(memoryCap !== null ? { cap: memoryCap } : {}),
            });

            // If premium/ghost tier, dual-write to the new structured memory tables
            if (agentTier === 'premium' || agentTier === 'ghost') {
              try {
                const recordId = typeof entry.id === 'string' ? entry.id : crypto.randomUUID();
                
                const source = (entry.source || 'manual') as import('./d1').MemorySource;
                const kind = (entry.kind || 'raw') as import('./d1').MemoryKind;
                const scope = (entry.scope || 'long-term') as import('./d1').MemoryScope;
                const instance = entry.instance || null;
                const lineageParentId = entry.lineageParentId || entry.lineage_parent_id || null;
                
                let contentHash: string | null = null;
                try {
                  const encoder = new TextEncoder();
                  const data = encoder.encode(content);
                  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                  const hashArray = Array.from(new Uint8Array(hashBuffer));
                  contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                } catch (hashErr) {
                  console.error('[setMemory] Content hashing failed:', hashErr);
                }

                const now = Date.now();
                await d1.insertMemoryRecord({
                  id: recordId,
                  agent_label: agentName,
                  source,
                  instance,
                  kind,
                  scope,
                  content_hash: contentHash,
                  created_at: now,
                  updated_at: now,
                  lineage_parent_id: lineageParentId,
                });

                await d1.insertMemoryChunk({
                  id: `${recordId}:0`,
                  record_id: recordId,
                  chunk_index: 0,
                  content,
                });
              } catch (structuredErr) {
                console.error('[setMemory] Failed to write structured memory:', structuredErr);
              }
            }

            appended++;
          }
          return corsify(Response.json({
            status: 'stored',
            agentName,
            tier: agentTier,
            appended,
            cap: memoryCap ?? 'unlimited',
            source: 'd1',
          }), request);
        }

        if (email.action === 'getRecentMemory') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const filterTag: string | null = (email as any).tag || null;
          const filterSession: string | null = (email as any).sessionId || null;

          // ── D1-first for LITE+ ──
          if (env.NFTMAIL_DB) {
            try {
              const d1 = new D1Store(env.NFTMAIL_DB);
              const agentRow = await d1.getAgent(agentName);
              if (agentRow && agentRow.tier !== 'basic') {
                const isPremium = agentRow.tier === 'premium' || agentRow.tier === 'ghost';
                const maxLimit = isPremium ? 500 : 200;
                const limit = Math.min(parseInt(String((email as any).limit ?? '50'), 10), maxLimit);
                const rows = await d1.getRecentMemory(agentName, {
                  limit,
                  tag: filterTag ?? undefined,
                  sessionId: filterSession ?? undefined,
                });
                return corsify(Response.json({
                  agentName,
                  entries: rows.map(r => ({ id: r.id, ts: r.created_at, content: r.content, tag: r.tag, sessionId: r.session_id })),
                  returned: rows.length,
                  tier: agentRow.tier,
                  source: 'd1',
                }), request);
              }
            } catch (e) {
              console.error('[D1 read] getRecentMemory fallback to KV:', e);
            }
          }

          // ── KV fallback (BASIC or D1 miss) ──
          const limit = Math.min(parseInt(String((email as any).limit ?? '50'), 10), 200);
          const raw = await env.INBOX_KV.get(`memory:${agentName}`);
          let entries: any[] = [];
          try { if (raw) entries = JSON.parse(raw); } catch {}
          if (filterTag) entries = entries.filter((e: any) => Array.isArray(e.tags) && e.tags.includes(filterTag));
          if (filterSession) entries = entries.filter((e: any) => e.sessionId === filterSession);
          const window = entries.slice(-limit);
          return corsify(Response.json({ agentName, entries: window, total: entries.length, returned: window.length, source: 'kv' }), request);
        }

        // ── Cross-Agent Shared Context ────────────────────────────────────────
        // LITE+: D1 shared_context table (concurrent-safe upsert, writer attribution)
        // BASIC: KV fallback
        if (email.action === 'setSharedContext') {
          const namespace = ((email as any).namespace || '').toLowerCase().trim();
          if (!namespace) {
            return corsify(Response.json({ error: 'Missing namespace' }, { status: 400 }), request);
          }
          if (namespace.startsWith('secure:')) {
            const secret = (email as any).secret || '';
            if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
              return corsify(Response.json({ error: 'Invalid secret for secure namespace' }, { status: 401 }), request);
            }
          }
          const data = (email as any).data;
          if (data === undefined) {
            return corsify(Response.json({ error: 'Missing data' }, { status: 400 }), request);
          }
          const writer = ((email as any).agentName || 'unknown').toLowerCase().trim();
          if (env.NFTMAIL_DB) {
            try {
              await new D1Store(env.NFTMAIL_DB).setSharedContext(namespace, data, writer);
              return corsify(Response.json({ status: 'stored', namespace, writer, source: 'd1' }), request);
            } catch (e) { console.error('[D1] setSharedContext fallback to KV:', e); }
          }
          await env.INBOX_KV.put(`shared-ctx:${namespace}`, JSON.stringify({ data, writer, updatedAt: Date.now() }));
          return corsify(Response.json({ status: 'stored', namespace, writer, source: 'kv' }), request);
        }

        if (email.action === 'getSharedContext') {
          const namespace = ((email as any).namespace || '').toLowerCase().trim();
          if (!namespace) {
            return corsify(Response.json({ error: 'Missing namespace' }, { status: 400 }), request);
          }
          if (env.NFTMAIL_DB) {
            try {
              const row = await new D1Store(env.NFTMAIL_DB).getSharedContext(namespace);
              if (row) {
                return corsify(Response.json({ exists: true, namespace, data: JSON.parse(row.data), writer: row.writer, updatedAt: row.updated_at, source: 'd1' }), request);
              }
            } catch (e) { console.error('[D1] getSharedContext fallback to KV:', e); }
          }
          const raw = await env.INBOX_KV.get(`shared-ctx:${namespace}`);
          if (!raw) return corsify(Response.json({ exists: false, namespace }, { status: 404 }), request);
          try {
            const ctx = JSON.parse(raw);
            return corsify(Response.json({ exists: true, namespace, ...ctx, source: 'kv' }), request);
          } catch {
            return corsify(Response.json({ exists: false, namespace }), request);
          }
        }

        if (email.action === 'listSharedContext') {
          const prefix = ((email as any).prefix || '').toLowerCase().trim();
          if (env.NFTMAIL_DB) {
            try {
              const rows = await new D1Store(env.NFTMAIL_DB).listSharedContext(prefix);
              if (rows.length > 0) {
                return corsify(Response.json({ namespaces: rows.map(r => r.namespace), count: rows.length, source: 'd1' }), request);
              }
            } catch (e) { console.error('[D1] listSharedContext fallback to KV:', e); }
          }
          const kvPrefix = prefix ? `shared-ctx:${prefix}` : 'shared-ctx:';
          const listed = await env.INBOX_KV.list({ prefix: kvPrefix });
          const namespaces = listed.keys.map((k: { name: string }) => k.name.replace(/^shared-ctx:/, ''));
          return corsify(Response.json({ namespaces, count: namespaces.length, source: 'kv' }), request);
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

        // --- Debug: inspect raw KV keys ---
        if (email.action === 'debugKV') {
          const keys = ((email as any).keys || []) as string[];
          const results: Record<string, string | null> = {};
          for (const k of keys) {
            results[k] = await env.INBOX_KV.get(k);
          }
          return corsify(Response.json(results), request);
        }

        // --- Resolve Address: check existence + privacy for inbox display ---
        // Suffix-Boundary Architecture: name_ (nftmail) and name- (ghostmail) are agent aliases.
        // Root addresses (no suffix) are sovereign-reserved.
        if (email.action === 'resolveAddress') {
          const inputName = ((email as any).name || '').toLowerCase().trim();
          // domain: 'ghostmail.box' | 'nftmail.box' — caller passes for tier-based privacy rules
          const reqDomain: string = ((email as any).domain || 'nftmail.box').toLowerCase();
          if (!inputName) {
            return corsify(Response.json({ error: 'Missing name' }, { status: 400 }), request);
          }

          // Character sanitisation: strip .agent suffix for prefix check
          const isAgent = inputName.endsWith('.agent');
          const prefix = isAgent ? inputName.slice(0, -6) : inputName;

          // Classify through logic gate for dot-delimited patterns
          // Use domain to build the right address for classification
          const classifyDomain = reqDomain === 'ghostmail.box' ? '@ghostmail.box' : '@nftmail.box';
          const addr = inputName.includes('@') ? inputName : `${inputName}${classifyDomain}`;
          const classified = classifyRecipient(addr);
          const { stream, collectionName, tokenId, collection, socialPair } = classified;
          const agentName = classified.agentName || prefix;

          // ── SOVEREIGN (no underscore suffix) ──
          // Root addresses may be pre-existing accounts (e.g. fresh.boy).
          // Must check KV existence FIRST before returning availability.
          // name_@ agent aliases skip sovereign path → fall through to AGENT block.
          const isAgentAlias = !isAgent && inputName.endsWith('_');
          if (!isAgent && !isAgentAlias) {
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
            const [sBlindIndex, sSocialReg, sEciesKey, sZohoSeat, sPrivacy, sGnoOwner, sAcctTier, sErc8004GnosisRaw, sErc8004LegacyRaw, sErc8004BaseRaw] = await Promise.all([
              env.INBOX_KV.get(`blind-index:${resolvedName}`),
              env.INBOX_KV.get(`social-registered:${resolvedName}`),
              env.INBOX_KV.get(`ecies-pubkey:${resolvedName}`),
              env.INBOX_KV.get(`zoho-seat:${resolvedName}`),
              env.INBOX_KV.get(`privacy:${resolvedName}`),
              env.INBOX_KV.get(`nftmailgno:${resolvedName}`),
              env.INBOX_KV.get(`acct-tier:${resolvedName}`),
              env.INBOX_KV.get(`erc8004:gnosis:${resolvedName}`),
              env.INBOX_KV.get(`erc8004:${resolvedName}`),
              env.INBOX_KV.get(`erc8004:base:${resolvedName}`),
            ]);
            const sErc8004Raw = sErc8004GnosisRaw ?? sErc8004LegacyRaw;
            const sErc8004 = sErc8004Raw ? (() => { try { const d = JSON.parse(sErc8004Raw); return { erc8004AgentId: d.agentId, erc8004AgentURI: d.agentURI, erc8004ChainId: d.chainId ?? 100, erc8004RegisteredAt: d.registeredAt }; } catch { return {}; } })() : {};
            const sErc8004Base = sErc8004BaseRaw ? (() => { try { const d = JSON.parse(sErc8004BaseRaw); return { erc8004Base: { agentId: d.agentId, agentURI: d.agentURI, chainId: 8453, registeredAt: d.registeredAt } }; } catch { return {}; } })() : {};

            const sHasMessages = !!sBlindIndex && (() => { try { return JSON.parse(sBlindIndex).length > 0; } catch { return false; } })();
            const sHasEciesKey = !!sEciesKey;
            const sHasZohoSeat = !!sZohoSeat;

            // Parse nftmailgno entry — supports both legacy flat string and structured JSON
            let sGnoController: string | null = null;
            let sGnoOriginNft: string | null = null;
            let sGnoLegacyIdentity: string | null = null;
            let sGnoMintedTokenId: number | null = null;
            let sGnoTba: string | null = null;
            if (sGnoOwner) {
              try {
                const gnoData = JSON.parse(sGnoOwner);
                sGnoController = gnoData.controller || null;
                sGnoOriginNft = gnoData.origin_nft || null;
                sGnoLegacyIdentity = gnoData.legacy_identity || null;
                sGnoMintedTokenId = gnoData.minted_tokenId || null;
                sGnoTba = gnoData.tba || null;
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

            // ── SLD-based tier overrides ──
            // picoclaw.gno = basic email tier (even with Safe + ERC-8004)
            // vault.gno = premium (always premium regardless of parity)
            const sldFromOrigin = sGnoOriginNft ? sGnoOriginNft.split('.').slice(-2)[0] : null;
            if (sldFromOrigin === 'picoclaw') {
              sAccountTier = 'basic';
            } else if (sldFromOrigin === 'vault') {
              sAccountTier = 'premium';
            }

            // ── Tier from beacon token ID parity (odd=Lite, even=Premium) ──
            // Applies to agents with GNS beacon NFTs when KV tier is basic/unset
            // SLD overrides take precedence over parity
            if (sGnoMintedTokenId !== null && (sAccountTier === 'basic' || !sAcctTier)) {
              sAccountTier = (sGnoMintedTokenId % 2 === 1) ? 'lite' : 'premium';
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
            // If basic tier message window has elapsed: identity is permanent, only messages are cleared.
            // Return exists:true with messagesCleared:true so UI shows the inbox address as active.
            // decayDays: how many days the message retention window is (for frontend decay bar)
            const sDecayDays = sAccountTier === 'basic' ? 8 : sAccountTier === 'lite' ? 30 : null;

            if (sExists && sIsExpired && sAccountTier === 'basic') {
              return corsify(Response.json({
                name: inputName,
                exists: true,
                messagesCleared: true,
                stream: 'sovereign',
                privacyTier: sPrivacyTier,
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
              // All sovereign human inboxes default to private — BASIC is plaintext but not public.
              // Encryption (ECIES) is unlocked at LITE (lite) via Safe deployment.
              // Explicit KV privacy: record overrides this default.
              if (!sPrivacy) {
                sPrivacyTier = 'private';
              }
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
                canSend: true,
                onChainOwner: sGnoController,
                originNft: sGnoOriginNft,
                legacyIdentity: sGnoLegacyIdentity,
                mintedTokenId: sGnoMintedTokenId,
                ...sErc8004,
                ...sErc8004Base,
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
          // Strip trailing _ (agent alias) to get base name for TLD/tier fallback
          const resolvedBaseName = resolvedName.replace(/_+$/, '');

          // Check existence signals in KV (+ tld, on-chain linkage, acct-tier, heartbeat)
          const [blindIndex, eciesKey, zohoSeat, privacyStatus, tldValue, baseTldValue, acctTierRaw, baseAcctTierRaw, nftmailGnoRaw, cronHeartbeat, erc8004GnosisChain, erc8004GnosisLegacy, erc8004BaseMainnet, erc8004BaseSepoliaRaw] = await Promise.all([
            env.INBOX_KV.get(`blind-index:${resolvedName}`),
            env.INBOX_KV.get(`ecies-pubkey:${resolvedName}`),
            env.INBOX_KV.get(`zoho-seat:${resolvedName}`),
            env.INBOX_KV.get(`privacy:${resolvedName}`),
            env.INBOX_KV.get(`tld:${resolvedName}`),
            resolvedBaseName !== resolvedName ? env.INBOX_KV.get(`tld:${resolvedBaseName}`) : Promise.resolve(null),
            env.INBOX_KV.get(`acct-tier:${resolvedName}`),
            resolvedBaseName !== resolvedName ? env.INBOX_KV.get(`acct-tier:${resolvedBaseName}`) : Promise.resolve(null),
            env.INBOX_KV.get(`nftmailgno:${resolvedName}`),
            env.INBOX_KV.get('heartbeat:cron'),
            env.INBOX_KV.get(`erc8004:gnosis:${resolvedName}`),
            env.INBOX_KV.get(`erc8004:${resolvedName}`),
            env.INBOX_KV.get(`erc8004:base:${resolvedName}`),
            env.INBOX_KV.get(`erc8004:baseSepolia:${resolvedName}`),
          ]);
          const erc8004Raw     = erc8004GnosisChain ?? erc8004GnosisLegacy;
          const erc8004BaseRaw = erc8004BaseMainnet;
          const erc8004BaseSepoliaRawFinal = erc8004BaseSepoliaRaw;

          const hasMessages = !!blindIndex && (() => { try { return JSON.parse(blindIndex).length > 0; } catch { return false; } })();
          const hasEciesKey = !!eciesKey;
          const hasZohoSeat = !!zohoSeat;
          const hasAcctTier = !!(acctTierRaw || baseAcctTierRaw);
          const hasBaseTld = resolvedBaseName !== resolvedName && !!baseTldValue;
          // _@ aliases are always valid (registered pattern alongside base agent)
          const isAlias = resolvedBaseName !== resolvedName;
          // KV-only agents (FakeNormies, chonk NFTs) have tld: and erc8004:gnosis: keys
          // but no acct-tier or nftmailgno. Include these signals so they register as existing.
          const exists = isAlias || hasMessages || hasEciesKey || hasZohoSeat || hasAcctTier || hasBaseTld || !!tldValue || !!erc8004Raw;

          // Privacy tier — for aliases, fall back to base agent privacy if alias has none
          const basePrivacyStatus = (resolvedBaseName !== resolvedName && !privacyStatus)
            ? await env.INBOX_KV.get(`privacy:${resolvedBaseName}`)
            : null;
          const effectivePrivacyStatus = privacyStatus ?? basePrivacyStatus;
          let privacyTier: 'exposed' | 'private' | 'hard-privacy' = 'exposed';
          if (effectivePrivacyStatus) {
            try {
              const p = JSON.parse(effectivePrivacyStatus);
              if (p.tier === 'hard-privacy') privacyTier = 'hard-privacy';
              else if (p.tier === 'private') privacyTier = 'private';
              else if (p.enabled === true && !p.tier) privacyTier = 'private'; // legacy boolean fallback
            } catch {
              if (effectivePrivacyStatus === 'true') privacyTier = 'private';
            }
          }

          // Parse on-chain linkage from nftmailgno entry
          let onChainOwner: string | null = null;
          let originNft: string | null = null;
          let mintedTokenId: number | null = null;
          let tbaAddress: string | null = null;
          if (nftmailGnoRaw) {
            try {
              const gno = JSON.parse(nftmailGnoRaw);
              onChainOwner = gno.controller || null;
              originNft = gno.origin_nft || null;
              mintedTokenId = gno.minted_tokenId || null;
              tbaAddress = gno.tba || null;
            } catch {
              onChainOwner = nftmailGnoRaw; // legacy flat string = owner address
            }
          }
          // For KV-only agents (no nftmailgno entry): backfill onChainOwner from ERC-8004
          // ownerOf — covers FakeNormies and other NFT-collection agents registered via
          // setErc8004AgentId but never through provisionAgent.
          if (!onChainOwner && erc8004Raw) {
            try {
              const erc8004Parsed = JSON.parse(erc8004Raw) as { agentId?: number };
              const erc8004AgentIdNum = erc8004Parsed.agentId ?? 0;
              if (erc8004AgentIdNum) {
                const ownerOfData = '0x6352211e' + erc8004AgentIdNum.toString(16).padStart(64, '0');
                const ownerRpcRes = await fetch('https://rpc.gnosischain.com', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jsonrpc: '2.0', id: 1, method: 'eth_call',
                    params: [{ to: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', data: ownerOfData }, 'latest'],
                  }),
                  signal: AbortSignal.timeout(3000),
                });
                const ownerRpc = await ownerRpcRes.json() as { result?: string };
                if (ownerRpc.result && ownerRpc.result !== '0x') {
                  onChainOwner = '0x' + ownerRpc.result.slice(-40);
                }
              }
            } catch { /* non-fatal — leave onChainOwner null */ }
          }

          // Parse acct-tier — aliases inherit from base agent for all display fields
          const effectiveAcctTierRaw = acctTierRaw || baseAcctTierRaw;
          let accountTier: string = 'basic';
          let agentSafe: string | null = null;
          let storyIp: string | null = null;
          let expiresAt: number | null = null;
          let canSend = isAlias; // aliases always allow compose (human stream)
          if (effectiveAcctTierRaw) {
            try {
              const td = JSON.parse(effectiveAcctTierRaw);
              accountTier = td.tier || 'basic';
              agentSafe = td.safe || null;
              storyIp = td.story_ip || null;
              expiresAt = td.expires_at || null;
              if (!isAlias) canSend = true; // send limit enforced by checkAndIncrementSendCount
            } catch {}
          }

          // ── SLD-based tier overrides ──
          // picoclaw.gno = basic email tier (even with Safe + ERC-8004)
          // vault.gno = premium (always premium regardless of parity)
          const sldFromOrigin = originNft ? originNft.split('.').slice(-2)[0] : null;
          if (sldFromOrigin === 'picoclaw') {
            accountTier = 'basic';
          } else if (sldFromOrigin === 'vault') {
            accountTier = 'premium';
          }

          // ── Tier from beacon token ID parity (odd=Lite, even=Premium) ──
          // Applies to agents with GNS beacon NFTs when KV tier is basic/unset
          // SLD overrides take precedence over parity
          if (mintedTokenId !== null && (accountTier === 'basic' || !effectiveAcctTierRaw)) {
            accountTier = (mintedTokenId % 2 === 1) ? 'lite' : 'premium';
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

          // Resolve TLD: check alias nftmailgno.tld first, then base nftmailgno.origin_nft, then static fallbacks
          let aliasTldFromNftmailGno: string | null = null;
          let baseOriginTld: string | null = null;
          if (isAlias && nftmailGnoRaw) {
            try {
              const g = JSON.parse(nftmailGnoRaw);
              aliasTldFromNftmailGno = g.tld || null;
            } catch {}
          }
          if (isAlias) {
            const baseNftmailGno = await env.INBOX_KV.get(`nftmailgno:${resolvedBaseName}`);
            if (baseNftmailGno) {
              try {
                const g = JSON.parse(baseNftmailGno);
                const originNftStr: string = g.origin_nft || '';
                const dotIdx = originNftStr.indexOf('.');
                if (dotIdx > 0) baseOriginTld = originNftStr.slice(dotIdx + 1) || null;
              } catch {}
            }
          }
          const agentResolvedTld = aliasTldFromNftmailGno || baseOriginTld || tldValue || baseTldValue || (resolvedName.endsWith('_molt') || resolvedBaseName.endsWith('_molt') ? 'molt.gno' : 'nftmail.gno');
          // Only molt.gno is glassbox by design — all other agents (including ghostmail.box) inherit inbox privacy
          const agentIsPublic = PUBLIC_TLDS.some(t => agentResolvedTld.endsWith(t));
          if (agentIsPublic) privacyTier = 'exposed';

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
            tba: tbaAddress,
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
            // ERC-8004 on-chain identity (multi-chain)
            ...(erc8004Raw ? (() => { try { const d = JSON.parse(erc8004Raw); return { erc8004AgentId: d.agentId, erc8004AgentURI: d.agentURI, erc8004RegisteredAt: d.registeredAt, erc8004ChainId: d.chainId ?? 100 }; } catch { return {}; } })() : {}),
            ...(erc8004BaseRaw ? (() => { try { const d = JSON.parse(erc8004BaseRaw); return { erc8004Base: { agentId: d.agentId, agentURI: d.agentURI, registeredAt: d.registeredAt, chainId: 8453 } }; } catch { return {}; } })() : {}),
            ...(erc8004BaseSepoliaRawFinal ? (() => { try { const d = JSON.parse(erc8004BaseSepoliaRawFinal); return { erc8004BaseSepolia: { agentId: d.agentId, agentURI: d.agentURI, registeredAt: d.registeredAt, chainId: 84532 } }; } catch { return {}; } })() : {}),
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
            agentAddress: `${socialKey}.agent@nftmail.box`,
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
          const inboxDomain: string = ((email as any).domain || 'nftmail').toLowerCase();
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const domainPfx = inboxDomain === 'ghostmail' ? 'ghostmail' : '';
          const kvKeyName = domainPfx ? `${domainPfx}:${agent}` : agent;
          const blindIndexKey = `blind-index:${kvKeyName}`;
          const raw = await env.INBOX_KV.get(blindIndexKey);
          let blindIds: string[] = [];
          try {
            blindIds = raw ? JSON.parse(raw) : [];
          } catch {
            console.error(`[getBlindInbox] Corrupted blind-index for ${kvKeyName}, treating as empty`);
            blindIds = [];
          }

          const messages: any[] = [];
          const fetches = blindIds.map(async (id) => {
            const data = await env.INBOX_KV.get(`blind:${kvKeyName}:${id}`);
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

        // --- Sentbox: Save a sent message with tier-based TTL ---
        if (email.action === 'saveSentMessage') {
          const agent = (email as any).localPart || '';
          const message = (email as any).message;
          if (!agent || !message || !message.id) {
            return corsify(Response.json({ error: 'Missing localPart or message' }, { status: 400 }), request);
          }
          // Get tier to determine TTL
          const tierRaw = await env.INBOX_KV.get(`acct-tier:${agent}`);
          let ttlSeconds: number;
          if (tierRaw) {
            const tierData = JSON.parse(tierRaw);
            // basic/basic = 8 days, lite/professional/vault = 30 days
            const isBasic = !tierData.tier || tierData.tier === 'basic' || tierData.tier === 'basic';
            ttlSeconds = isBasic ? 8 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
          } else {
            ttlSeconds = 8 * 24 * 60 * 60; // default 8-day
          }
          // Store message with TTL
          await env.INBOX_KV.put(`sent:${agent}:${message.id}`, JSON.stringify(message), { expirationTtl: ttlSeconds });
          // Update index
          const indexKey = `sent-index:${agent}`;
          const raw = await env.INBOX_KV.get(indexKey);
          const ids: string[] = raw ? JSON.parse(raw) : [];
          if (!ids.includes(message.id)) {
            ids.unshift(message.id);
            // Keep only last 10
            const trimmed = ids.slice(0, 10);
            await env.INBOX_KV.put(indexKey, JSON.stringify(trimmed), { expirationTtl: ttlSeconds });
          }
          return corsify(Response.json({ status: 'saved', agent, messageId: message.id, ttlDays: ttlSeconds / 86400 }), request);
        }

        // --- Sentbox: Get all sent messages ---
        if (email.action === 'getSentbox') {
          const agent = (email as any).localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const indexKey = `sent-index:${agent}`;
          const raw = await env.INBOX_KV.get(indexKey);
          const ids: string[] = raw ? JSON.parse(raw) : [];
          const fetches = ids.map(async (id: string) => {
            const data = await env.INBOX_KV.get(`sent:${agent}:${id}`);
            if (!data) return null;
            try {
              return JSON.parse(data);
            } catch {
              return null;
            }
          });
          const messages = (await Promise.all(fetches)).filter(Boolean);
          messages.sort((a: any, b: any) => (b.receivedAt || 0) - (a.receivedAt || 0));
          return corsify(Response.json({ agent, messages, count: messages.length }), request);
        }

        // --- Sentbox: Delete a sent message ---
        if (email.action === 'deleteSentMessage') {
          const agent = (email as any).localPart || '';
          const messageId = (email as any).messageId || '';
          if (!agent || !messageId) {
            return corsify(Response.json({ error: 'Missing localPart or messageId' }, { status: 400 }), request);
          }
          await env.INBOX_KV.delete(`sent:${agent}:${messageId}`);
          const indexKey = `sent-index:${agent}`;
          const raw = await env.INBOX_KV.get(indexKey);
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            const updated = ids.filter(id => id !== messageId);
            await env.INBOX_KV.put(indexKey, JSON.stringify(updated));
          }
          return corsify(Response.json({ status: 'deleted', agent, messageId }), request);
        }

        // Check free send allowance and increment counter atomically
        // Updated for 8-day destroy cycle: uses sendsRemaining from trial entry
        if (email.action === 'checkAndIncrementSendCount') {
          const agent = (email as any).localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          
          const kvKey = agent.replace(/_$/, '');
          const now = Date.now();
          
          // Get trial and tier data
          const [trialData, tierData] = await Promise.all([
            env.INBOX_KV.get(`nftmailgno:${kvKey}`),
            env.INBOX_KV.get(`acct-tier:${kvKey}`),
          ]);
          
          if (!trialData) {
            return corsify(Response.json({ error: 'Inbox not found' }, { status: 404 }), request);
          }
          
          const trial = JSON.parse(trialData);
          const tier = tierData ? JSON.parse(tierData) : { tier: 'free' };
          
          // Check if expired (8-day destroy cycle)
          const isExpired = trial.expiresAt && now > trial.expiresAt;
          if (isExpired) {
            return corsify(Response.json({ 
              allowed: false, 
              error: 'Inbox expired',
              status: 'expired',
              expiresAt: trial.expiresAt,
              canRecreate: true,
            }), request);
          }
          
          // Basic/Basic tier: 10-send lifetime limit tracked in send-count: KV
          if (!tier.tier || tier.tier === 'basic') {
            const BASIC_SEND_LIMIT = 10;
            const countRaw = await env.INBOX_KV.get(`send-count:${kvKey}`);
            const sendCount = countRaw ? parseInt(countRaw, 10) : 0;
            if (sendCount >= BASIC_SEND_LIMIT) {
              return corsify(Response.json({
                allowed: false,
                error: 'Send limit reached',
                sendsUsed: sendCount,
                sendsRemaining: 0,
                tier: 'basic',
                upgradeRequired: true,
              }), request);
            }
            await env.INBOX_KV.put(`send-count:${kvKey}`, String(sendCount + 1));
            return corsify(Response.json({
              allowed: true,
              sendsUsed: sendCount + 1,
              sendsRemaining: BASIC_SEND_LIMIT - sendCount - 1,
              tier: 'basic',
            }), request);
          }

          // Free tier: check sendsRemaining
          if (tier.tier === 'free' || trial.type === 'free') {
            const sendsRemaining = trial.sendsRemaining ?? 0;
            const sendsUsed = trial.sendsUsed ?? 0;
            
            if (sendsRemaining <= 0) {
              return corsify(Response.json({ 
                allowed: false, 
                error: 'Send limit reached',
                sendsUsed,
                sendsRemaining: 0,
                tier: 'free',
                upgradeRequired: true,
              }), request);
            }
            
            // Atomically decrement sendsRemaining and increment sendsUsed
            const newTrialEntry = {
              ...trial,
              sendsRemaining: sendsRemaining - 1,
              sendsUsed: sendsUsed + 1,
            };
            await env.INBOX_KV.put(`nftmailgno:${kvKey}`, JSON.stringify(newTrialEntry));
            
            return corsify(Response.json({ 
              allowed: true, 
              sendsUsed: sendsUsed + 1,
              sendsRemaining: sendsRemaining - 1,
              tier: 'free',
              expiresAt: trial.expiresAt,
              daysRemaining: Math.floor((trial.expiresAt - now) / (24 * 60 * 60 * 1000)),
            }), request);
          }
          
          // Professional/Vault tiers: unlimited sends
          if (tier.tier === 'professional' || tier.tier === 'vault') {
            return corsify(Response.json({ 
              allowed: true, 
              sendsRemaining: 'unlimited',
              tier: tier.tier,
              expiresAt: tier.expiresAt || null,
            }), request);
          }
          
          // Default fallback (shouldn't reach here)
          return corsify(Response.json({ allowed: true, tier: tier.tier || 'unknown' }), request);
        }

        // Store a sent message in the sender's sent folder
        if (email.action === 'storeSentMessage') {
          const agent = (email as any).localPart || '';
          const payload = (email as any).payload as Record<string, unknown> | undefined;
          if (!agent || !payload) {
            return corsify(Response.json({ error: 'Missing localPart or payload' }, { status: 400 }), request);
          }
          const sentId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const entry = { ...payload, sentAt: Date.now() };
          // TTL mirrors inbox: 30 days default (premium gets longer server-side if needed)
          await env.INBOX_KV.put(`sent:${agent}:${sentId}`, JSON.stringify(entry), { expirationTtl: 30 * 24 * 60 * 60 });
          const idxKey = `sent-index:${agent}`;
          const idxRaw = await env.INBOX_KV.get(idxKey);
          const ids: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          ids.push(sentId);
          await env.INBOX_KV.put(idxKey, JSON.stringify(ids), { expirationTtl: 30 * 24 * 60 * 60 });
          return corsify(Response.json({ status: 'stored', sentId }), request);
        }

        // Retrieve sent messages for an agent
        if (email.action === 'getSentMessages') {
          const agent = (email as any).localPart || '';
          if (!agent) {
            return corsify(Response.json({ error: 'Missing localPart' }, { status: 400 }), request);
          }
          const idxRaw = await env.INBOX_KV.get(`sent-index:${agent}`);
          const sentIds: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          const messages: unknown[] = [];
          await Promise.all(sentIds.map(async (id) => {
            const raw = await env.INBOX_KV.get(`sent:${agent}:${id}`);
            if (raw) {
              try { messages.push({ id, ...JSON.parse(raw) }); } catch {}
            }
          }));
          (messages as any[]).sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
          return corsify(Response.json({ agent, messages, count: messages.length }), request);
        }

        // Delete a sent message
        if (email.action === 'deleteSentMessage') {
          const agent = (email as any).localPart || '';
          const sentId = (email as any).sentId || '';
          if (!agent || !sentId) {
            return corsify(Response.json({ error: 'Missing localPart or sentId' }, { status: 400 }), request);
          }
          await env.INBOX_KV.delete(`sent:${agent}:${sentId}`);
          const idxKey = `sent-index:${agent}`;
          const idxRaw = await env.INBOX_KV.get(idxKey);
          if (idxRaw) {
            const ids: string[] = JSON.parse(idxRaw);
            await env.INBOX_KV.put(idxKey, JSON.stringify(ids.filter(i => i !== sentId)), { expirationTtl: 30 * 24 * 60 * 60 });
          }
          return corsify(Response.json({ status: 'deleted', sentId }), request);
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

        // Sovereign Kill-Switch: full agent identity burn
        // Deletes all KV keys, invalidates inbox routing, records burn attestation
        if (email.action === 'purgeInbox') {
          const agent = ((email as any).localPart || (email as any).email?.split('@')[0] || '').toLowerCase().trim();
          const signature = (email as any).signature || '';
          const secret = (email as any).secret || '';
          const scope = (email as any).scope || 'messages'; // 'messages' | 'full'
          if (!agent) {
            return corsify(Response.json({ error: 'Missing agent name' }, { status: 400 }), request);
          }
          if (!signature) {
            return corsify(Response.json({ error: 'Missing wallet signature — sovereign burn requires owner auth' }, { status: 403 }), request);
          }

          // Step 1: Purge inbox messages (always)
          result = await storage.purgeInbox(agent);
          const msgResult = await result.json() as { messagesDeleted?: number };
          let keysDeleted: string[] = [];

          // Step 2: Full identity burn (if scope='full' and webhook secret provided)
          if (scope === 'full') {
            if (!secret || secret !== env.WEBHOOK_SECRET) {
              return corsify(Response.json({ error: 'Full burn requires webhook auth' }, { status: 401 }), request);
            }

            // All agent KV key patterns
            const identityKeys = [
              `nftmailgno:${agent}`,
              `acct-tier:${agent}`,
              `principal:${agent}`,
              `tld:${agent}`,
              `erc8004:gnosis:${agent}`,
              `erc8004:base:${agent}`,
              `erc8004:baseSepolia:${agent}`,
              `agentprofile:${agent}`,
              `beacon:${agent}`,
              `profile:${agent}`,
              `audit:${agent}`,
              `deviantclaw:apikey:${agent}`,
              `deviantclaw:agentid:${agent}`,
              `deviantclaw:displayname:${agent}`,
            ];

            // Also purge blind index keys for both human and agent streams
            const blindKeys = [
              `blindindex:${agent}`,
              `blindindex:${agent}_`,
              `blindindex:${agent}.agent`,
            ];

            const allKeys = [...identityKeys, ...blindKeys];
            await Promise.all(allKeys.map(async (key) => {
              const exists = await env.INBOX_KV.get(key);
              if (exists !== null) {
                await env.INBOX_KV.delete(key);
                keysDeleted.push(key);
              }
            }));

            // Step 3: Record burn attestation (so notapaperclip.red can detect it)
            const burnAttestation = {
              event: 'MoltBurned',
              agent,
              scope: 'full',
              keysDeleted,
              messagesDeleted: msgResult.messagesDeleted ?? 0,
              burnedAt: new Date().toISOString(),
              burnedBy: signature.slice(0, 20) + '...', // truncated sig as proof-of-intent
            };
            await env.INBOX_KV.put(
              `burn:${agent}:${Date.now()}`,
              JSON.stringify(burnAttestation),
              { expirationTtl: 60 * 60 * 24 * 90 } // retain burn record for 90 days
            );

            // Step 4: D1 burn — delete emails + memory, tombstone agents row
            // 0G archive blob is now orphaned (unreachable encrypted ciphertext — not a security risk)
            let d1EmailsDeleted = 0;
            let d1MemoryDeleted = 0;
            if (env.NFTMAIL_DB) {
              try {
                const d1 = new D1Store(env.NFTMAIL_DB);
                [d1EmailsDeleted, d1MemoryDeleted] = await Promise.all([
                  d1.deleteAgentEmails(agent),
                  d1.deleteAgentMemory(agent),
                ]);
                await d1.burnAgent(agent);
              } catch (e) {
                console.error('[burn] D1 tombstone failed (non-fatal):', e);
              }
            }
            burnAttestation.keysDeleted = [...keysDeleted, `d1:emails(${d1EmailsDeleted})`, `d1:memory(${d1MemoryDeleted})`, 'd1:agents(tombstoned)'];
          }

          return corsify(Response.json({
            status: 'purged',
            agent,
            scope,
            messagesDeleted: msgResult.messagesDeleted ?? 0,
            identityKeysDeleted: keysDeleted,
            timestamp: Date.now(),
          }), request);
        }

        // Only process email storage for actual email payloads (with to/from/content fields)
        if (email.to && email.from && email.content !== undefined) {
          const localPart = extractLocalPart(email.to);
          
          if (!localPart) {
            return corsify(new Response('Invalid email format', { status: 400 }), request);
          }

          // Store email - and dual-write to public audit log for molt.gno agents
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
        }

        return corsify(result, request);
      }
      return corsify(new Response('Method not allowed', { status: 405 }), request);
    } catch (err: any) {
      console.error(`[fetch-crash] ${err?.message || String(err)} | stack: ${err?.stack?.split('\n').slice(0,3).join(' | ')}`);
      return corsify(
        Response.json(
          { error: err?.message || String(err), stack: err?.stack?.split('\n').slice(0, 5) },
          { status: 500 }
        ),
        request
      );
    }
}

// ── Cloudflare Worker export ──────────────────────────────────────────────────
export default {
  email: _handleEmail,

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      handlePublicAgent: (agentName, env, req) => _handlePublicAgent(agentName, env, req),
      handleMailgunWebhook: (req, env, ctx) => handleMailgunWebhook(req, env, ctx),
      handleJsonPost: (req, env, ctx) => _handleJsonPost(req, env, ctx),
    });
    return app.fetch(request, env, ctx);
  },

  // --- Cron triggers ---
  // */5 * * * *  → heartbeat
  // 0 9 * * 1    → weekly agent report via ghostagent.ninja API
  // 0 2 * * *    → daily 0G archive sweep for all LITE+ agents
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // ── Daily 0G archive sweep ───────────────────────────────────────────────
    if (event.cron === '0 2 * * *') {
      if (!env.NFTMAIL_DB || !env.ZEROG_ARCHIVER_URL || !env.WEBHOOK_SECRET) {
        console.log('[0G cron] ZEROG_ARCHIVER_URL or D1 not configured — skipping');
        return;
      }
      const d1 = new D1Store(env.NFTMAIL_DB);
      const agents = await d1.getAllLiteAgents();
      console.log(`[0G cron] archiving ${agents.length} LITE+ agents`);
      for (const agentRow of agents) {
        if (!agentRow.ecies_pubkey) {
          console.log(`[0G cron] skipping ${agentRow.label} — no ECIES key, cannot encrypt`);
          continue;
        }
        try {
          const [emails, memory] = await Promise.all([
            d1.getInbox(agentRow.label, { limit: 1000 }),
            d1.getRecentMemory(agentRow.label, { limit: 500 }),
          ]);
          const bundle = {
            schemaVersion: 1 as const,
            exportedAt: Date.now(),
            agent: agentRow as unknown as Record<string, unknown>,
            emails: emails as unknown as Record<string, unknown>[],
            memory: memory as unknown as Record<string, unknown>[],
            identities: [] as Record<string, unknown>[],
          };
          const result = await archiveBundleToZeroG(env.ZEROG_ARCHIVER_URL, env.WEBHOOK_SECRET, bundle, agentRow.ecies_pubkey);
          if (result) {
            await d1.updateZeroGHash(agentRow.label, result.rootHash);
            console.log(`[0G cron] archived ${agentRow.label} rootHash=${result.rootHash}`);
          } else {
            console.error(`[0G cron] archive failed for ${agentRow.label}`);
          }
        } catch (e) {
          console.error(`[0G cron] error for ${agentRow.label}:`, e);
        }
      }
      return;
    }

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

    // ── Heartbeat ────────────────────────────────────────────────────────────
    const now = String(Date.now());
    await Promise.all([
      env.INBOX_KV.put('heartbeat:cron', now, { expirationTtl: 60 * 60 }),
      env.INBOX_KV.put('canary:alive',   now, { expirationTtl: 72 * 60 * 60 }),
    ]);
    return;
  },
};
