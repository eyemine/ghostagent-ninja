/**
 * POST /api/handshake
 *
 * Bilateral EIP-712 HandshakeCertificate lifecycle endpoint.
 *
 * Manages the "neutral escrow" state for two-agent bilateral signing.
 * Neither agent needs to trust the other's runtime — both sign the same
 * canonical struct and the server assembles the final artifact only once
 * both signatures are present.
 *
 * Actions:
 *   initiate    — Initiator builds cert payload + submits their EIP-712 sig.
 *                 Server stores pending handshake in KV. Returns certHash.
 *   countersign — Responder fetches the pending cert by certHash, adds their
 *                 sig. Server assembles SignedHandshakeCertificate.
 *   submit      — Pin assembled cert to Lighthouse IPFS, then call
 *                 validationRequest() on ERC-8004 Validation Registry.
 *   get         — Retrieve a stored handshake (pending or complete) by certHash.
 *   list        — List handshakes for an agentName (initiator or responder).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import {
  hashHandshakeCertificate,
  assembleSignedCertificate,
  type HandshakeCertificate,
  type SignedHandshakeCertificate,
} from '../../services/handshake-certificate';
import { requestValidation, hashPayload } from '../../services/erc8004-client';
import { GNOSIS_ADDRESSES } from '../../services/erc8004-registration';
import { WORKER_URL } from '../../utils/config';

const LIGHTHOUSE_UPLOAD = 'https://node.lighthouse.storage/api/v0/add';
const LIGHTHOUSE_GATEWAY = 'https://gateway.lighthouse.storage/ipfs';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

// ─── KV helpers ───────────────────────────────────────────────────────────────

async function kvGet(key: string): Promise<unknown> {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body:    JSON.stringify({ action: 'kvGet', key }),
  });
  const data = await res.json() as { value?: string };
  return data?.value ? JSON.parse(data.value) : null;
}

async function kvPut(key: string, value: unknown): Promise<void> {
  await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
    body:    JSON.stringify({ action: 'kvPut', key, value: JSON.stringify(value) }),
  });
}

// ─── IPFS pin ─────────────────────────────────────────────────────────────────

async function pinToLighthouse(obj: object, filename: string): Promise<string | null> {
  const apiKey = process.env.LIGHTHOUSE_API_KEY;
  if (!apiKey) return null;
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }),
      filename,
    );
    const res = await fetch(LIGHTHOUSE_UPLOAD, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });
    if (!res.ok) return null;
    const data = await res.json() as { Hash?: string };
    return data.Hash ?? null;
  } catch {
    return null;
  }
}

// ─── Types stored in KV ───────────────────────────────────────────────────────

interface PendingHandshake {
  status:            'pending';
  cert:              ReturnType<typeof serialiseCert>;
  certHash:          string;
  initiatorAgentId:  string;
  responderAgentId:  string;
  initiatorSignature: string;
  tradeIntentRef:    string;
  initiatedAt:       number;
  sepolia:           boolean;
}

interface CompleteHandshake {
  status:      'complete';
  certHash:    string;
  signed:      SignedHandshakeCertificate;
  ipfsCid:     string | null;
  requestUri:  string | null;
  onChainTx:   string | null;
  onChainError: string | null;
  completedAt: number;
}

type StoredHandshake = PendingHandshake | CompleteHandshake;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serialiseCert(cert: HandshakeCertificate) {
  return {
    initiatorAgentId: cert.initiatorAgentId.toString(),
    responderAgentId: cert.responderAgentId.toString(),
    initiatorWallet:  cert.initiatorWallet,
    responderWallet:  cert.responderWallet,
    tradeIntentHash:  cert.tradeIntentHash,
    meshChannel:      cert.meshChannel,
    initiatedAt:      cert.initiatedAt.toString(),
    completedAt:      cert.completedAt.toString(),
    nonce:            cert.nonce.toString(),
    outcomeTag:       cert.outcomeTag,
  };
}

function deserialiseCert(raw: ReturnType<typeof serialiseCert>): HandshakeCertificate {
  return {
    initiatorAgentId: BigInt(raw.initiatorAgentId),
    responderAgentId: BigInt(raw.responderAgentId),
    initiatorWallet:  raw.initiatorWallet as `0x${string}`,
    responderWallet:  raw.responderWallet as `0x${string}`,
    tradeIntentHash:  raw.tradeIntentHash as `0x${string}`,
    meshChannel:      raw.meshChannel,
    initiatedAt:      BigInt(raw.initiatedAt),
    completedAt:      BigInt(raw.completedAt),
    nonce:            BigInt(raw.nonce),
    outcomeTag:       raw.outcomeTag,
  };
}

function handshakeKvKey(certHash: string)  { return `handshake:cert:${certHash}`; }
function agentIndexKey(agentId: string)    { return `handshake:agent:${agentId}`; }

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { action } = body as { action?: string };
  if (!action) return err('Missing action');

  // ── initiate ───────────────────────────────────────────────────────────────
  // Initiator submits: the cert struct + their EIP-712 signature.
  // Server stores a pending handshake in KV and returns the certHash.
  if (action === 'initiate') {
    const {
      initiatorAgentId, responderAgentId,
      initiatorWallet,  responderWallet,
      tradeIntentHash,  meshChannel,
      nonce,            outcomeTag,
      initiatorSignature, tradeIntentRef,
      sepolia,
    } = body as Record<string, unknown>;

    if (!initiatorAgentId || !responderAgentId || !initiatorWallet || !responderWallet) {
      return err('Missing agent IDs or wallet addresses');
    }
    if (!tradeIntentHash) return err('Missing tradeIntentHash');
    if (!initiatorSignature) return err('Missing initiatorSignature');

    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    const cert: HandshakeCertificate = {
      initiatorAgentId: BigInt(initiatorAgentId as string),
      responderAgentId: BigInt(responderAgentId as string),
      initiatorWallet:  initiatorWallet  as `0x${string}`,
      responderWallet:  responderWallet  as `0x${string}`,
      tradeIntentHash:  tradeIntentHash  as `0x${string}`,
      meshChannel:      (meshChannel as string) ?? 'nftmail.box/ghostagent',
      initiatedAt:      nowSec,
      completedAt:      0n,
      nonce:            nonce ? BigInt(nonce as string) : BigInt(Date.now()),
      outcomeTag:       (outcomeTag as string) ?? 'pending',
    };

    const certHash = hashHandshakeCertificate(cert);

    const pending: PendingHandshake = {
      status:             'pending',
      cert:               serialiseCert(cert),
      certHash,
      initiatorAgentId:   cert.initiatorAgentId.toString(),
      responderAgentId:   cert.responderAgentId.toString(),
      initiatorSignature: initiatorSignature as string,
      tradeIntentRef:     (tradeIntentRef as string) ?? '',
      initiatedAt:        Date.now(),
      sepolia:            !!(sepolia),
    };

    await kvPut(handshakeKvKey(certHash), pending);

    // Index under initiator agentId for listing
    const initIdx = ((await kvGet(agentIndexKey(cert.initiatorAgentId.toString()))) as string[] | null) ?? [];
    if (!initIdx.includes(certHash)) { initIdx.push(certHash); }
    await kvPut(agentIndexKey(cert.initiatorAgentId.toString()), initIdx);

    // Index under responder agentId for listing
    const respIdx = ((await kvGet(agentIndexKey(cert.responderAgentId.toString()))) as string[] | null) ?? [];
    if (!respIdx.includes(certHash)) { respIdx.push(certHash); }
    await kvPut(agentIndexKey(cert.responderAgentId.toString()), respIdx);

    return NextResponse.json({
      ok:       true,
      certHash,
      status:   'pending',
      message:  'Handshake initiated. Share certHash with the responder to countersign.',
    });
  }

  // ── countersign ────────────────────────────────────────────────────────────
  // Responder fetches the pending cert by certHash and adds their EIP-712 sig.
  // Server assembles the final SignedHandshakeCertificate and stores it.
  if (action === 'countersign') {
    const { certHash, responderSignature, outcomeTag } = body as Record<string, string>;
    if (!certHash)           return err('Missing certHash');
    if (!responderSignature) return err('Missing responderSignature');

    const stored = await kvGet(handshakeKvKey(certHash)) as StoredHandshake | null;
    if (!stored) return err(`No handshake found for certHash: ${certHash}`, 404);
    if (stored.status === 'complete') {
      return NextResponse.json({ ok: true, status: 'complete', certHash, message: 'Already countersigned.' });
    }

    const pending = stored as PendingHandshake;

    // Patch completedAt + outcomeTag now that we know the outcome
    const completedCert: HandshakeCertificate = {
      ...deserialiseCert(pending.cert),
      completedAt: BigInt(Math.floor(Date.now() / 1000)),
      outcomeTag:  outcomeTag ?? pending.cert.outcomeTag ?? 'accepted',
    };

    const signed = assembleSignedCertificate(
      completedCert,
      pending.initiatorSignature as `0x${string}`,
      responderSignature as `0x${string}`,
      pending.tradeIntentRef,
      pending.sepolia,
    );

    const complete: CompleteHandshake = {
      status:      'complete',
      certHash:    signed.certificateHash,
      signed,
      ipfsCid:     null,
      requestUri:  null,
      onChainTx:   null,
      onChainError: null,
      completedAt: Date.now(),
    };

    await kvPut(handshakeKvKey(certHash), complete);

    return NextResponse.json({
      ok:              true,
      status:          'complete',
      certHash:        signed.certificateHash,
      signed,
      message:         'Bilateral handshake assembled. Call submit to post on-chain.',
    });
  }

  // ── submit ─────────────────────────────────────────────────────────────────
  // Grand finale:
  //   1. Pin the SignedHandshakeCertificate to Lighthouse IPFS
  //   2. Call validationRequest() on ERC-8004 Validation Registry
  //   3. Update stored record with IPFS CID + tx hash
  if (action === 'submit') {
    const { certHash } = body as { certHash?: string };
    if (!certHash) return err('Missing certHash');

    const stored = await kvGet(handshakeKvKey(certHash)) as StoredHandshake | null;
    if (!stored) return err(`No handshake found for certHash: ${certHash}`, 404);
    if (stored.status !== 'complete') {
      return err('Handshake is not yet countersigned — call countersign first', 409);
    }

    const complete = stored as CompleteHandshake;
    const signed   = complete.signed;

    // Already submitted
    if (complete.onChainTx) {
      return NextResponse.json({
        ok:         true,
        status:     'submitted',
        certHash,
        ipfsCid:    complete.ipfsCid,
        requestUri: complete.requestUri,
        onChainTx:  complete.onChainTx,
        explorer:   `https://gnosisscan.io/tx/${complete.onChainTx}`,
      });
    }

    // 1. Pin to Lighthouse
    const filename = `handshake-${certHash.slice(0, 10)}.json`;
    const ipfsCid  = await pinToLighthouse(signed, filename);
    const requestUri = ipfsCid
      ? `${LIGHTHOUSE_GATEWAY}/${ipfsCid}`
      : `${WORKER_URL}?action=kvGet&key=${handshakeKvKey(certHash)}`;

    // 2. Call validationRequest() on-chain via treasury wallet
    let onChainTx:    string | null = null;
    let onChainError: string | null = null;

    const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
    if (treasuryKey) {
      try {
        const account      = privateKeyToAccount(treasuryKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain:     gnosis,
          transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC ?? 'https://rpc.gnosischain.com'),
        });

        // agentId of the initiator is the "subject" of this validation request
        const agentId     = BigInt(signed.certificate.initiatorAgentId);
        const requestHash = signed.certificateHash as `0x${string}`;
        const payloadHash = hashPayload(JSON.stringify(signed));

        onChainTx = await requestValidation(walletClient, {
          validatorAddress: account.address,
          agentId,
          requestURI:   requestUri,
          requestHash:  payloadHash,
        });
      } catch (e: unknown) {
        onChainError = e instanceof Error ? e.message : String(e);
      }
    }

    // 3. Persist updated record
    const updated: CompleteHandshake = {
      ...complete,
      ipfsCid,
      requestUri,
      onChainTx,
      onChainError,
    };
    await kvPut(handshakeKvKey(certHash), updated);

    // 4. Glass Box audit entry
    const auditKey = `audit:handshake:${certHash}`;
    await kvPut(auditKey, {
      type:        'bilateral-handshake-submitted',
      certHash,
      initiatorAgentId: signed.certificate.initiatorAgentId,
      responderAgentId: signed.certificate.responderAgentId,
      outcomeTag:  signed.certificate.outcomeTag,
      ipfsCid,
      requestUri,
      onChainTx,
      timestamp:   Date.now(),
      portalUrl:   `https://notapaperclip.red/verify/${certHash}`,
    });

    const portalUrl = `https://notapaperclip.red/verify/${certHash}`;

    return NextResponse.json({
      ok:          true,
      status:      'submitted',
      certHash,
      ipfsCid,
      requestUri,
      onChainTx,
      onChainError,
      portalUrl,
      validationRegistry: GNOSIS_ADDRESSES.validationRegistry,
      explorer:    onChainTx ? `https://gnosisscan.io/tx/${onChainTx}` : null,
      onChainNote: onChainTx
        ? `validationRequest() submitted: https://gnosisscan.io/tx/${onChainTx}`
        : onChainError ?? 'TREASURY_PRIVATE_KEY not set — skipped on-chain submission',
    });
  }

  // ── get ────────────────────────────────────────────────────────────────────
  if (action === 'get') {
    const { certHash } = body as { certHash?: string };
    if (!certHash) return err('Missing certHash');
    const stored = await kvGet(handshakeKvKey(certHash)) as StoredHandshake | null;
    if (!stored) return NextResponse.json({ ok: false, found: false, certHash });
    return NextResponse.json({ ok: true, found: true, ...stored });
  }

  // ── list ───────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const { agentId } = body as { agentId?: string };
    if (!agentId) return err('Missing agentId');
    const index = ((await kvGet(agentIndexKey(agentId))) as string[] | null) ?? [];
    const handshakes = await Promise.all(
      index.map(hash => kvGet(handshakeKvKey(hash))),
    );
    return NextResponse.json({ ok: true, agentId, handshakes: handshakes.filter(Boolean) });
  }

  return err(`Unknown action: ${action}`);
}

// ─── GET — retrieve by certHash query param ───────────────────────────────────

export async function GET(req: NextRequest) {
  const certHash = req.nextUrl.searchParams.get('certHash');
  const agentId  = req.nextUrl.searchParams.get('agentId');

  if (certHash) {
    const stored = await kvGet(handshakeKvKey(certHash)) as StoredHandshake | null;
    if (!stored) return NextResponse.json({ ok: false, found: false, certHash });
    return NextResponse.json({ ok: true, found: true, ...stored });
  }

  if (agentId) {
    const index = ((await kvGet(agentIndexKey(agentId))) as string[] | null) ?? [];
    const handshakes = await Promise.all(
      index.map(hash => kvGet(handshakeKvKey(hash))),
    );
    return NextResponse.json({ ok: true, agentId, handshakes: handshakes.filter(Boolean) });
  }

  return NextResponse.json({
    ok:      true,
    actions: ['initiate', 'countersign', 'submit', 'get', 'list'],
    schema:  'ghost:handshake-certificate:v1',
    validationRegistry: GNOSIS_ADDRESSES.validationRegistry,
  });
}
