/**
 * /api/zerog-archive
 *
 * POST { bundle: AgentBundle, eciesPubkey: string } 
 *      → ECIES-encrypts bundle with agent's P-256 public key
 *      → uploads opaque ciphertext to 0G Storage
 *      → returns { rootHash, txHash, size }
 *
 * GET  ?rootHash=<hash>
 *      → downloads raw encrypted envelope from 0G
 *      → returns { envelope: EncryptedEnvelope } (NO server-side decryption)
 *      → caller decrypts with their private key
 *
 * Protected by X-Webhook-Secret header.
 *
 * Environment variables required:
 *   ZEROG_PRIVATE_KEY   — wallet private key with 0G A0GI balance for gas
 *   ZEROG_RPC_URL       — 0G EVM RPC (e.g. https://evmrpc-testnet.0g.ai)
 *   ZEROG_INDEXER_URL   — 0G indexer RPC
 *   WEBHOOK_SECRET      — shared secret with the worker
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Inline ECIES helpers (P-256 Web Crypto — same as worker src/ecies.ts) ──

interface EncryptedEnvelope {
  version: 1;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  tag: string;
  contentHash: string;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function importPublicKeyP256(pubHex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(pubHex);
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function deriveSharedAesKey(privKey: CryptoKey, pubKey: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
  const km = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('nftmail-ecies-v1'), info: new TextEncoder().encode('aes-256-gcm') },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
}

async function eciesEncryptBundle(plaintext: string, recipientPubHex: string): Promise<EncryptedEnvelope> {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPubRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const recipientPub = await importPublicKeyP256(recipientPubHex);
  const aesKey = await deriveSharedAesKey(ephemeral.privateKey, recipientPub);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, new TextEncoder().encode(plaintext));
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  return {
    version: 1,
    ephemeralPublicKey: bytesToHex(new Uint8Array(ephPubRaw)),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    tag: '',
    contentHash: bytesToHex(new Uint8Array(hashBuf)),
  };
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
const ZEROG_PRIVATE_KEY = process.env.ZEROG_PRIVATE_KEY ?? '';
const ZEROG_RPC_URL = process.env.ZEROG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const ZEROG_INDEXER_URL = process.env.ZEROG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function missingConfig() {
  return NextResponse.json({ error: 'ZEROG_PRIVATE_KEY not configured' }, { status: 503 });
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('X-Webhook-Secret') ?? '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) return unauthorized();
  if (!ZEROG_PRIVATE_KEY) return missingConfig();

  let body: { bundle: unknown; eciesPubkey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bundleStr = JSON.stringify(body.bundle ?? body);

  // ── ECIES encrypt if pubkey provided ─────────────────────────────────
  // If no pubkey: reject. Unencrypted uploads are not allowed —
  // every archive must be opaque to 0G storage nodes.
  if (!body.eciesPubkey) {
    return NextResponse.json({ error: 'eciesPubkey required — unencrypted archives are not permitted' }, { status: 400 });
  }

  let uploadBytes: Uint8Array;
  let envelope: EncryptedEnvelope;
  try {
    envelope = await eciesEncryptBundle(bundleStr, body.eciesPubkey);
    const envelopeStr = JSON.stringify(envelope);
    uploadBytes = new TextEncoder().encode(envelopeStr);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `ECIES encryption failed: ${msg}` }, { status: 500 });
  }

  try {
    const { Indexer, MemData } = await import('@0glabs/0g-ts-sdk');
    const { ethers } = await import('ethers');

    const provider = new ethers.JsonRpcProvider(ZEROG_RPC_URL);
    const signer = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);

    const memData = new MemData(uploadBytes);
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      return NextResponse.json({ error: `Merkle tree error: ${treeErr}` }, { status: 500 });
    }
    const rootHash = tree?.rootHash() ?? '';

    const indexer = new Indexer(ZEROG_INDEXER_URL);
    const [tx, uploadErr] = await indexer.upload(memData, ZEROG_RPC_URL, signer as unknown as Parameters<typeof indexer.upload>[2]);
    if (uploadErr !== null) {
      return NextResponse.json({ error: `0G upload error: ${uploadErr}` }, { status: 502 });
    }

    const txHash = 'rootHash' in tx ? (tx as any).txHash : (tx as any).txHashes?.[0] ?? '';
    return NextResponse.json({ rootHash, txHash, size: uploadBytes.length, encrypted: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Archive failed: ${msg}` }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('X-Webhook-Secret') ?? '';
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) return unauthorized();
  if (!ZEROG_PRIVATE_KEY) return missingConfig();

  const rootHash = request.nextUrl.searchParams.get('rootHash') ?? '';
  if (!rootHash) {
    return NextResponse.json({ error: 'Missing rootHash' }, { status: 400 });
  }

  try {
    const { Indexer } = await import('@0glabs/0g-ts-sdk');
    const indexer = new Indexer(ZEROG_INDEXER_URL);

    const chunks: Uint8Array[] = [];
    let seq = 0;
    while (true) {
      const [segment, err] = await (indexer as any).downloadSegmentByTxSeq(rootHash, seq);
      if (err !== null || !segment) break;
      chunks.push(segment);
      seq++;
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }

    // Return raw encrypted envelope — caller decrypts with their private key.
    // Server never sees the plaintext bundle on the read path.
    const envelopeStr = new TextDecoder().decode(merged);
    const envelope: EncryptedEnvelope = JSON.parse(envelopeStr);
    return NextResponse.json({ envelope, rootHash, encrypted: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 500 });
  }
}
