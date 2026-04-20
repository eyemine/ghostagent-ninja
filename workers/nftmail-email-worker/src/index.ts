/// <reference types="@cloudflare/workers-types" />

import MailStorageAdapter, { CalendarInvite } from './storage';
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
      const C: bigint[] = Array.from({length:5},(_,x)=>state[x]^state[x+5]^state[x+10]^state[x+15]^state[x+20]) as bigint[];
      const D: bigint[] = Array.from({length:5},(_,x)=>C[(x+4)%5]^rotl64(C[(x+1)%5],1)) as bigint[];
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
  MAILGUN_API_KEY?: string;
  IPFS_GATEWAY?: string;
  // Social recovery: Master Safe public key (optional auditor)
  MASTER_SAFE_PUBKEY?: string;
  // Worker authentication secret
  WORKER_SECRET?: string;
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

// --- Ghost-Router: Stream Classification ---
// Suffix-Boundary Architecture (Vitalik Proof):
//
//   Format                           Stream       KV Provisioning    Verification
//   ──────────────────────────────────────────────────────────────────────────────
//   name.agent@nftmail.box           agent        AUTO (minting)     6551 Brain / Safe (ECIES)
//   name.digits.agent@nftmail.box    agent        AUTO (minting)     NFT collection + 6551
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
    assignedName: 'chonk',
    chainId: 8453,
    contractAddress: '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9',
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
// basic=8d, lite(Pupa)=30d, premium/ghost=no expiry (null = no TTL arg)
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
// molt.gno = Glass Box (public audit log, no encryption)
// agent.gno, openclaw.gno, picoclaw.gno, vault.gno, nftmail.gno = Black Box (private, encrypted, sovereign)
const PUBLIC_TLDS = ['molt.gno'];
const PRIVATE_TLDS = ['agent.gno', 'openclaw.gno', 'picoclaw.gno', 'vault.gno', 'nftmail.gno'];

async function isPublicAgent(agentName: string, env: Env, parentTld?: string): Promise<boolean> {
  if (parentTld) return PUBLIC_TLDS.some(t => parentTld.endsWith(t));
  // Strip trailing _ (agent alias) to inherit base agent's TLD
  const baseName = agentName.replace(/_+$/, '');
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

  const sender = String(mgEmail['sender'] || mgEmail['from'] || '');
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
        return corsify(Response.json({
          error: `Token #${tokenId} not found in ${collection.displayName}`,
          stream: 'human', tokenId,
        }, { status: 404 }), request);
      }
    }
    const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
    const payloadObj = { from: sender, to: recipient, subject, body, ...(bodyHtmlRaw ? { bodyHtml: bodyHtmlRaw } : {}), timestamp };
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
    await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, JSON.stringify(envelope), mgPutOpts);
    await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);

    // Fire email forwarding for Imago human inboxes (non-fatal — storage already succeeded).
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
      await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, JSON.stringify(envelope), mgPutOpts);
      await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
      return corsify(Response.json({ status: 'received', stream: 'agent', agentType: 'glassbox', blindId, plaintextHash, recipient: storageName }), request);
    }

    const pubKeyHex = await env.INBOX_KV.get(`ecies-pubkey:${agentName}`);
    if (!pubKeyHex) {
      const blindId = `blind-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const plaintextPayload = JSON.stringify({ from: sender, to: recipient, subject, body, timestamp });
      const plaintextHash = await sha256Hex(plaintextPayload);
      const envelope = { type: 'agent-cleartext-warning', encrypted: false, warning: 'No ECIES key registered.', payload: JSON.parse(plaintextPayload), plaintextHash, recipient: storageName, receivedAt: timestamp };
      await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, JSON.stringify(envelope), mgPutOpts);
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
    await env.INBOX_KV.put(`blind:${storeKeyName(storageName)}:${blindId}`, JSON.stringify(blindEnvelope), mgPutOpts);
    await updateBlindIndex(env, storageName, blindId, storeDomainPrefix, mgTtlSecs);
    return corsify(Response.json({ status: 'received', stream: 'agent', agentType: 'blackbox', encrypted: true, blindId, plaintextHash, hasRecoveryKey: !!recoveryEnvelope, recipient: storageName }), request);
  }

  return corsify(Response.json({ error: 'Unclassified stream' }, { status: 400 }), request);
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
      const humanTtlSecs = await getAgentTtlSecs(env, agentName);
      const humanPutOpts = humanTtlSecs != null ? { expirationTtl: humanTtlSecs } : {};
      await env.INBOX_KV.put(`blind:${agentName}:${blindId}`, JSON.stringify(envelope), humanPutOpts);
      await updateBlindIndex(env, agentName, blindId, '', humanTtlSecs);
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
        await env.INBOX_KV.put(`blind:${storageName}:${blindId}`, JSON.stringify(envelope), agentPutOpts);
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
      await env.INBOX_KV.put(`blind:${storageName}:${blindId}`, JSON.stringify(blindEnvelope), agentPutOpts);
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
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    // AUTH GUARD: Validate X-Worker-Secret header for API requests (bypass email webhooks)
    const contentType = request.headers.get('content-type') || '';
    const isEmailWebhook = contentType.includes('multipart/form-data');
    
    const workerSecret = env.WORKER_SECRET;
    if (workerSecret && !isEmailWebhook) {
      const requestSecret = request.headers.get('X-Worker-Secret');
      if (requestSecret !== workerSecret) {
        console.error(`[auth] Invalid or missing X-Worker-Secret from ${request.headers.get('host')}`);
        return corsify(
          Response.json({ error: 'Unauthorized - Invalid or missing X-Worker-Secret header' }, { status: 401 }),
          request
        );
      }
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
        // Detect Mailgun inbound webhook (multipart/form-data) and convert to our JSON shape
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('multipart/form-data')) {
          try {
            const formData = await request.formData();
            const mgEmail: Record<string, unknown> = { action: 'mailgunInbound' };
            for (const [key, value] of formData.entries()) {
              mgEmail[key] = (typeof value === 'object' && value !== null && 'text' in value) ? await (value as Blob).text() : value;
            }
            if (mgEmail['body-plain'])  mgEmail['bodyPlain'] = mgEmail['body-plain'];
            if (mgEmail['body-html'])   mgEmail['bodyHtml']  = mgEmail['body-html'];
            console.log(`[multipart] parsed recipient=${mgEmail['recipient']} sender=${mgEmail['sender']} subject=${String(mgEmail['subject']).slice(0,50)}`);
            return await handleMailgunPayload(mgEmail, env, request);
          } catch (multipartErr: unknown) {
            const msg = multipartErr instanceof Error ? multipartErr.message : String(multipartErr);
            console.error(`[multipart] ERROR: ${msg}`);
            return corsify(Response.json({ error: 'multipart parse failed', detail: msg }, { status: 500 }), request);
          }
        }

        // Extract zohoMessageId from raw body BEFORE JSON.parse to preserve 19-digit precision
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
            const mgEmail: Record<string, unknown> = { action: 'mailgunInbound' };
            for (const [key, value] of params.entries()) mgEmail[key] = value;
            if (mgEmail['body-plain']) mgEmail['bodyPlain'] = mgEmail['body-plain'];
            if (mgEmail['body-html'])  mgEmail['bodyHtml']  = mgEmail['body-html'];
            console.log(`[urlencoded] recipient=${mgEmail['recipient']} sender=${mgEmail['sender']}`);
            return await handleMailgunPayload(mgEmail, env, request);
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
            return await handleMailgunPayload(mgEmail, env, request);
          }

          throw parseErr;
        }
        let result: Response;

        if (email.action === 'getInbox') {
          const rawAgent = email.localPart || email.email?.split('@')[0] || '';
          if (!rawAgent) {
            return corsify(new Response('Missing agent name (localPart or email)', { status: 400 }), request);
          }
          // Normalize: strip .agent suffix since KV stores under identity name (no .agent)
          const agent = rawAgent.endsWith('.agent') ? rawAgent.slice(0, -6) : rawAgent;
          const inboxDomain: string = ((email as any).domain || 'nftmail').toLowerCase();
          const domainPfx = inboxDomain === 'ghostmail' ? 'ghostmail' : '';
          const kvKeyName = domainPfx ? `${domainPfx}:${agent}` : agent;

          // Primary: read from blind-index (current storage format)
          const blindIdxRaw = await env.INBOX_KV.get(`blind-index:${kvKeyName}`);
          if (blindIdxRaw) {
            const blindIds: string[] = JSON.parse(blindIdxRaw);
            const messages: any[] = [];
            await Promise.all(blindIds.map(async (id) => {
              const data = await env.INBOX_KV.get(`blind:${kvKeyName}:${id}`);
              if (data) {
                try {
                  const parsed = JSON.parse(data);
                  const cid = await env.INBOX_KV.get(`ipfs:${agent}:${id}`);
                  if (cid) parsed.ipfsCid = cid;
                  // Flatten cleartext payload fields to top level for frontend compatibility
                  const payload = parsed.payload || {};
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
                  });
                } catch {}
              }
            }));
            messages.sort((a: any, b: any) => (b.receivedAt || 0) - (a.receivedAt || 0));
            return corsify(Response.json({ agent, messages, count: messages.length }), request);
          }

          // Fallback: legacy index format
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

        // Agent Identity: full identity stack for a GhostAgent (all layers)
        if (email.action === 'getAgentIdentity') {
          const agentName = ((email as any).agentName || '').toLowerCase().replace(/_+$/, '').trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const [tldRaw, gnosisRaw, baseRaw, baseSepoliaRaw, gnoOwnerRaw, acctTierRaw] = await Promise.all([
            env.INBOX_KV.get(`tld:${agentName}`),
            env.INBOX_KV.get(`erc8004:gnosis:${agentName}`),
            env.INBOX_KV.get(`erc8004:base:${agentName}`),
            env.INBOX_KV.get(`erc8004:baseSepolia:${agentName}`),
            env.INBOX_KV.get(`nftmailgno:${agentName}`),
            env.INBOX_KV.get(`acct-tier:${agentName}`),
          ]);

          // Parse identity NFT record (nftmailgno: key)
          let originNft: string | null = null;
          let tokenId: number | null = null;
          let onChainOwner: string | null = null;
          if (gnoOwnerRaw) {
            try {
              const g = JSON.parse(gnoOwnerRaw);
              onChainOwner = g.controller || null;
              originNft    = g.origin_nft || null;
              tokenId      = g.minted_tokenId || null;
            } catch { onChainOwner = gnoOwnerRaw; }
          }

          // Parse safe + storyIp (acct-tier: key)
          let safe: string | null = null;
          let storyIp: string | null = null;
          if (acctTierRaw) {
            try { const t = JSON.parse(acctTierRaw); safe = t.safe || null; storyIp = t.story_ip || null; } catch {}
          }

          const tld = tldRaw ?? null;

          const gnosis      = gnosisRaw      ? JSON.parse(gnosisRaw)      : null;
          const base        = baseRaw         ? JSON.parse(baseRaw)         : null;
          const baseSepolia = baseSepoliaRaw  ? JSON.parse(baseSepoliaRaw)  : null;

          return corsify(Response.json({
            name: agentName,
            email: `${agentName}.agent@nftmail.box`,
            // Identity NFT layer
            identityNft: originNft ? {
              name:    originNft,
              tokenId: tokenId,
              owner:   onChainOwner,
              tld:     tld,
            } : null,
            // Safe (multisig treasury)
            safe: safe ?? null,
            // Story Protocol IP
            storyIp: storyIp ?? null,
            // ERC-8004 registrations (multi-chain)
            erc8004: {
              ...(gnosis      ? { gnosis:      { agentId: gnosis.agentId,      chainId: 100,   agentURI: gnosis.agentURI,      registeredAt: gnosis.registeredAt } } : {}),
              ...(base        ? { base:        { agentId: base.agentId,        chainId: 8453,  agentURI: base.agentURI,        registeredAt: base.registeredAt   } } : {}),
              ...(baseSepolia ? { baseSepolia: { agentId: baseSepolia.agentId, chainId: 84532, agentURI: baseSepolia.agentURI, registeredAt: baseSepolia.registeredAt } } : {}),
            },
            // Links
            links: {
              profile:    `https://ghostagent.ninja/agent/${agentName}`,
              agentCard:  `https://ghostagent.ninja/api/agent-card?agent=${agentName}`,
              a2aCard:    `https://ghostagent.ninja/.well-known/agent.json`,
              registry:   `https://ghostagent.ninja/api/agents`,
            },
          }), request);
        }

        // Agent Registry: update acct-tier (safe, story_ip, tier) and/or nftmailgno (originNft, tokenId, TBA) for an agent
        if (email.action === 'setAgentRecord') {
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

        if (email.action === 'setAgentProfile') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }

          // ── Signature verification ──────────────────────────────────────────
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
          const ts = Number(sigMessage.replace(expectedPrefix, ''));
          if (!ts || Math.abs(Date.now() - ts) > 10 * 60 * 1000) {
            return corsify(Response.json({ error: 'Signature expired — regenerate and retry' }, { status: 401 }), request);
          }

          // Recover signer from EIP-191 personal_sign
          let recoveredAddress: string;
          try {
            recoveredAddress = await recoverPersonalSignSigner(sigMessage, signature);
          } catch (e) {
            return corsify(Response.json({ error: 'Invalid signature' }, { status: 401 }), request);
          }

          // Check ownerOf(agentId) on Gnosis ERC-8004 Identity Registry
          const GNOSIS_RPC = 'https://rpc.gnosischain.com';
          const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
          // ownerOf(uint256) = 0x6352211e
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
            // result is 32-byte padded address
            tokenOwner = '0x' + rpcJson.result.slice(-40);
          } catch {
            return corsify(Response.json({ error: 'Failed to verify token ownership on-chain' }, { status: 500 }), request);
          }

          if (tokenOwner.toLowerCase() !== recoveredAddress.toLowerCase()) {
            return corsify(Response.json({
              error: `Signer ${recoveredAddress} does not own ERC-8004 token #${agentIdNum} (owner: ${tokenOwner})`,
            }, { status: 403 }), request);
          }
          // ── End signature verification ──────────────────────────────────────

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
          return corsify(Response.json({ status: 'updated', agentName, profile, verifiedOwner: recoveredAddress }), request);
        }

        if (email.action === 'getAgentProfile') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`agentprofile:${agentName}`);
          const profile = raw ? JSON.parse(raw) : {};
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
            const listed = await env.INBOX_KV.list({ prefix: 'tld:' });
            const agents = await Promise.all(
              listed.keys.map(async (k) => {
                const name = k.name.replace(/^tld:/, '');
                const [tld, gnosisRaw, baseRaw, baseSepoliaRaw] = await Promise.all([
                  env.INBOX_KV.get(k.name),
                  env.INBOX_KV.get(`erc8004:gnosis:${name}`),
                  env.INBOX_KV.get(`erc8004:base:${name}`),
                  env.INBOX_KV.get(`erc8004:baseSepolia:${name}`),
                ]);
                const gnosis      = gnosisRaw      ? JSON.parse(gnosisRaw)      : null;
                const base        = baseRaw         ? JSON.parse(baseRaw)         : null;
                const baseSepolia = baseSepoliaRaw  ? JSON.parse(baseSepoliaRaw)  : null;
                return {
                  name,
                  tld: tld ?? null,
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
            return corsify(Response.json({ agents, total: agents.length }), request);
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
            const ownedBaseNames = new Set<string>();
            
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
                
                // Track base agents (without _) to later add their aliases
                if (!isAlias && !isAgent) {
                  ownedBaseNames.add(name);
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
              } catch { /* skip malformed */ }
            }));
            
            // Add aliases for owned base agents (e.g., rgbanksy owns rgbanksy_)
            // Only for pupa (lite) tier or above — larva (basic) does not get a _ alias
            for (const baseName of ownedBaseNames) {
              const tierRaw = await env.INBOX_KV.get(`acct-tier:${baseName}`);
              if (tierRaw) {
                try {
                  const tierData = JSON.parse(tierRaw) as { tier?: string };
                  if (tierData.tier === 'basic') continue;
                } catch { /* malformed tier — skip alias */ continue; }
              }
              const aliasName = `${baseName}_`;
              // Check if alias already exists or has its own nftmailgno record
              const aliasRaw = await env.INBOX_KV.get(`nftmailgno:${aliasName}`);
              if (!aliasRaw) {
                // Add the alias with inherited properties from base agent
                const baseRaw = await env.INBOX_KV.get(`nftmailgno:${baseName}`);
                if (baseRaw) {
                  try {
                    const g = JSON.parse(baseRaw);
                    let tld = g.tld || null;
                    if (!tld && g.origin_nft) {
                      const dotIdx = (g.origin_nft as string).indexOf('.');
                      if (dotIdx > 0) tld = (g.origin_nft as string).slice(dotIdx + 1);
                    }
                    tld = tld || 'nftmail.gno';
                    results.push({
                      name: aliasName,
                      email: `${aliasName}@nftmail.box`,
                      gnoName: g.origin_nft || `${baseName}.${tld}`,
                      tld,
                      tokenId: null, // Aliases don't have their own token
                      isAgent: false, // Aliases are not .agent type
                    });
                  } catch { /* skip malformed */ }
                }
              }
            }
            return corsify(Response.json({ names: results, total: results.length }), request);
          } catch (e: any) {
            return corsify(Response.json({ error: e?.message ?? 'listNftmailByController failed' }, { status: 500 }), request);
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

        // Imago Forwarding: Get forwarding configuration
        if (email.action === 'getForwardingConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          
          const configKey = `forwarding:${agentName}`;
          const configData = await env.INBOX_KV.get(configKey);
          
          // Check acct-tier for Imago level default forwarding
          if (!configData) {
            const acctTierKey = `acct-tier:${agentName}`;
            const acctTierData = await env.INBOX_KV.get(acctTierKey);
            
            if (acctTierData) {
              const acctTier = JSON.parse(acctTierData);
              if (acctTier.tier === 'imago' && acctTier.forwardingEmail) {
                return corsify(Response.json({
                  agentName,
                  config: {
                    enabled: true,
                    targetEmail: acctTier.forwardingEmail,
                    level: 'imago'
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

        // Imago Forwarding: Set forwarding configuration
        if (email.action === 'setForwardingConfig') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          const config = (email as any).config;
          
          if (!agentName || !config) {
            return corsify(Response.json({ error: 'Missing agentName or config' }, { status: 400 }), request);
          }
          
          // Validate agent is Imago level
          const acctTierKey = `acct-tier:${agentName}`;
          const acctTierData = await env.INBOX_KV.get(acctTierKey);
          
          if (!acctTierData) {
            return corsify(Response.json({ error: 'Agent not found' }, { status: 404 }), request);
          }
          
          const acctTier = JSON.parse(acctTierData);
          if (acctTier.tier !== 'imago' && acctTier.tier !== 'ghost') {
            return corsify(Response.json({ error: 'Forwarding only available for Imago and Ghost level agents' }, { status: 403 }), request);
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

        // Imago Forwarding: Delete forwarding configuration
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

        // Imago Forwarding: Get forwarding log
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
          const config = configRaw ? JSON.parse(configRaw) : { enabled: false, targetEmail: '', level: 'imago' };
          
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

        // Stats: Get account tracking metrics (on-chain + KV usage)
        if (email.action === 'getStats') {
          const activeInboxes = await env.INBOX_KV.get('stats:active_inboxes');
          const totalActive = activeInboxes ? parseInt(activeInboxes) : 0;
          
          return corsify(Response.json({
            on_chain: {
              total_minted: 'Query ERC-8004 contract directly',
              chain_id: 100,
              contract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
            },
            off_chain: {
              active_inboxes: totalActive,
              tracked_via_kv: true,
              tracking_period: '30_days'
            },
            last_updated: Date.now()
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

          return await handleMailgunPayload(email as unknown as Record<string, unknown>, env, request);
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

        // --- Trial Registration: KV-only entry for freemium agents ---
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

          // 8-day destroy cycle for freemium tier
          const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          const creatorIp = request.headers.get('cf-connecting-ip') || 'unknown';

          // Create trial KV entries - freemium tier
          const trialEntry = JSON.stringify({
            type: 'freemium',
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
            tier: 'freemium',
            type: 'freemium',
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
            type: 'freemium',
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
        // Destroys expired freemium inbox and creates fresh trial
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
          
          // Only freemium trials can be destroyed and recreated
          if (trial.type !== 'freemium') {
            return corsify(Response.json({ 
              error: 'Only freemium inboxes can be destroyed and recreated',
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
            type: 'freemium',
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
            tier: 'freemium',
            type: 'freemium',
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
            type: 'freemium',
            name: kvKey,
            email: `${name}@nftmail.box`,
            expiresAt: now + EIGHT_DAYS_MS,
            sendsRemaining: 10,
            claimCode: newClaimCode,
            previousExpiresAt: trial.expiresAt,
          }), request);
        }

        // --- Upgrade Tier: Freemium → Professional/Vault ---
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
          
          // Get current trial data
          const trialData = await env.INBOX_KV.get(`nftmailgno:${kvKey}`);
          if (!trialData) {
            return corsify(Response.json({ error: 'Inbox not found' }, { status: 404 }), request);
          }
          
          const trial = JSON.parse(trialData);
          
          // Can only upgrade freemium inboxes
          if (trial.type !== 'freemium' && trial.type !== 'trial') {
            return corsify(Response.json({ 
              error: 'Can only upgrade freemium inboxes',
              currentType: trial.type 
            }, { status: 403 }), request);
          }
          
          // Professional tier: 10 xDAI, 30-day storage
          // Vault tier: 24 xDAI/year, 365-day storage
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
          const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
          
          const isVault = targetTier === 'vault';
          const retention = isVault ? '365-day' : '30-day';
          const expiresAt = isVault ? now + ONE_YEAR_MS : null; // Professional doesn't expire
          const cost = isVault ? '24 xDAI/year' : '10 xDAI';
          
          // Update trial entry to upgraded status
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
          
          const tierEntry = JSON.stringify({
            tier: targetTier,
            type: targetTier,
            upgradedAt: now,
            upgradedFrom: trial.type,
            expiresAt,
            retention,
            walletAddress,
            upgradeTx: txHash || null,
            cost,
            sendsRemaining: 'unlimited',
            storyIp: null,
          });
          
          await Promise.all([
            env.INBOX_KV.put(`nftmailgno:${kvKey}`, upgradedEntry),
            env.INBOX_KV.put(`acct-tier:${kvKey}`, tierEntry),
          ]);
          
          return corsify(Response.json({
            status: 'upgraded',
            name: kvKey,
            previousTier: trial.type,
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
          // Prevent duplicate registration (trusted calls skip this — they may update existing)
          const existingReg = await env.INBOX_KV.get(`nftmailgno:${(email as any).legacyIdentity || label}`);
          if (existingReg && !isTrustedCall) {
            return corsify(Response.json({ error: `${label} is already registered`, status: 'already_registered' }, { status: 409 }), request);
          }

          const originNft: string = (email as any).originNft || `${label}.nftmail.gno`;
          const legacyIdentity: string | null = (email as any).legacyIdentity || null;
          const mintedTokenId: number | null = (email as any).mintedTokenId || null;
          const privacyTier: string = (email as any).privacyTier || 'exposed';
          // KV key: use legacyIdentity (dot format: mac.slave) if provided, else label (hyphen: mac-slave)
          // resolveAddress looks up by the email local-part (dot format)
          const kvKey = legacyIdentity || label;
          // Tier system: basic = 8-day message retention (identity permanent), lite/pupa = 30-day retention + send enabled + Safe body
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

        // ── Episodic Memory ───────────────────────────────────────────────────
        // Rolling per-agent buffer of memory entries.
        // KV key: memory:{agentName}  →  JSON array, newest-last, capped at 200
        // Each entry shape: { id, ts, role, content, tags?, sessionId?, [extra] }
        //
        // Cross-agent coordination via shared namespaces:
        // KV key: shared-ctx:{namespace}  →  { data, writer, updatedAt }
        // Any agent can read; namespaces prefixed 'secure:' require WEBHOOK_SECRET.
        // listSharedContext: enumerate all shared-ctx keys (prefix scan).

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
          const maxEntries = parseInt(String((env as any).MEMORY_MAX_ENTRIES ?? '200'), 10);
          const memKey = `memory:${agentName}`;
          let existing: any[] = [];
          try {
            const raw = await env.INBOX_KV.get(memKey);
            if (raw) existing = JSON.parse(raw);
          } catch {}
          const ts = Date.now();
          const appended = [
            ...existing,
            ...newEntries.map((e: any, i: number) => ({ id: `${ts}-${i}`, ts, ...e })),
          ].slice(-maxEntries);
          await env.INBOX_KV.put(memKey, JSON.stringify(appended));
          return corsify(Response.json({ status: 'stored', agentName, total: appended.length, appended: newEntries.length }), request);
        }

        if (email.action === 'getRecentMemory') {
          const agentName = ((email as any).agentName || '').toLowerCase().trim();
          if (!agentName) {
            return corsify(Response.json({ error: 'Missing agentName' }, { status: 400 }), request);
          }
          const limit = Math.min(parseInt(String((email as any).limit ?? '50'), 10), 200);
          const filterTag: string | null = (email as any).tag || null;
          const filterSession: string | null = (email as any).sessionId || null;
          const raw = await env.INBOX_KV.get(`memory:${agentName}`);
          let entries: any[] = [];
          try { if (raw) entries = JSON.parse(raw); } catch {}
          if (filterTag) entries = entries.filter((e: any) => Array.isArray(e.tags) && e.tags.includes(filterTag));
          if (filterSession) entries = entries.filter((e: any) => e.sessionId === filterSession);
          const window = entries.slice(-limit);
          return corsify(Response.json({ agentName, entries: window, total: entries.length, returned: window.length }), request);
        }

        // ── Cross-Agent Shared Context ────────────────────────────────────────
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
          await env.INBOX_KV.put(`shared-ctx:${namespace}`, JSON.stringify({ data, writer, updatedAt: Date.now() }));
          return corsify(Response.json({ status: 'stored', namespace, writer }), request);
        }

        if (email.action === 'getSharedContext') {
          const namespace = ((email as any).namespace || '').toLowerCase().trim();
          if (!namespace) {
            return corsify(Response.json({ error: 'Missing namespace' }, { status: 400 }), request);
          }
          const raw = await env.INBOX_KV.get(`shared-ctx:${namespace}`);
          if (!raw) {
            return corsify(Response.json({ exists: false, namespace }, { status: 404 }), request);
          }
          try {
            const ctx = JSON.parse(raw);
            return corsify(Response.json({ exists: true, namespace, ...ctx }), request);
          } catch {
            return corsify(Response.json({ exists: false, namespace }), request);
          }
        }

        if (email.action === 'listSharedContext') {
          const prefix = ((email as any).prefix || '').toLowerCase().trim();
          const kvPrefix = prefix ? `shared-ctx:${prefix}` : 'shared-ctx:';
          const listed = await env.INBOX_KV.list({ prefix: kvPrefix });
          const namespaces = listed.keys.map((k: { name: string }) => k.name.replace(/^shared-ctx:/, ''));
          return corsify(Response.json({ namespaces, count: namespaces.length }), request);
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

          const hasMessages = !!blindIndex && JSON.parse(blindIndex).length > 0;
          const hasEciesKey = !!eciesKey;
          const hasZohoSeat = !!zohoSeat;
          const hasAcctTier = !!(acctTierRaw || baseAcctTierRaw);
          const hasBaseTld = resolvedBaseName !== resolvedName && !!baseTldValue;
          // _@ aliases are always valid (registered pattern alongside base agent)
          const isAlias = resolvedBaseName !== resolvedName;
          const exists = isAlias || hasMessages || hasEciesKey || hasZohoSeat || hasAcctTier || hasBaseTld;

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
          // ghostmail.box + .agent stream + freemium/basic tier → always glassbox (npx/curl open access)
          // pro/vault on ghostmail.box gets a privacy toggle like any other agent
          const isGhostmailAgentStream = isAgent && reqDomain === 'ghostmail.box';
          const ghostmailFreemiumGlassbox = isGhostmailAgentStream && accountTier === 'basic';
          if (ghostmailFreemiumGlassbox) privacyTier = 'exposed';
          const agentIsPublic = ghostmailFreemiumGlassbox || PUBLIC_TLDS.some(t => agentResolvedTld.endsWith(t));
          // Note: agentIsPublic marks the agent as a Glass Box for display purposes.
          // privacyTier is intentionally NOT overridden here — the user’s KV-stored choice must be respected.

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
          const blindIds: string[] = raw ? JSON.parse(raw) : [];

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

        // Check freemium send allowance and increment counter atomically
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
          const tier = tierData ? JSON.parse(tierData) : { tier: 'freemium' };
          
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
          
          // Basic/Larva tier: 10-send lifetime limit tracked in send-count: KV
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

          // Freemium tier: check sendsRemaining
          if (tier.tier === 'freemium' || trial.type === 'freemium') {
            const sendsRemaining = trial.sendsRemaining ?? 0;
            const sendsUsed = trial.sendsUsed ?? 0;
            
            if (sendsRemaining <= 0) {
              return corsify(Response.json({ 
                allowed: false, 
                error: 'Send limit reached',
                sendsUsed,
                sendsRemaining: 0,
                tier: 'freemium',
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
              tier: 'freemium',
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

    // ── Heartbeat only (no Zoho polling) ─────────────────────────────────────
    // Write global heartbeat + canary timestamps
    const now = String(Date.now());
    await Promise.all([
      env.INBOX_KV.put('heartbeat:cron', now, { expirationTtl: 60 * 60 }),
      env.INBOX_KV.put('canary:alive',   now, { expirationTtl: 72 * 60 * 60 }),
    ]);
    return;
  },
};
