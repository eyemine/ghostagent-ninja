import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, verifyTypedData } from 'viem';
import { gnosis } from 'viem/chains';
import {
  EIP712_DOMAIN,
  EIP712_TYPES,
  buildAgreementText,
  hashText,
  pinAgreementToIPFS,
  type ListingRecord,
  AGREEMENT_VERSION,
} from '../../../services/ip-transfer-agreement';
import { WORKER_URL } from '../../../utils/config';


const publicClient = createPublicClient({ chain: gnosis, transport: http() });

/**
 * POST /api/marketplace/list
 * Body: {
 *   agentName, safeAddress, listingPriceXdai, seller, namespace,
 *   signature,          // EIP-712 signature from wallet
 *   agreementHash,      // keccak256 of agreement text (from client)
 *   timestamp,          // ms timestamp used when generating agreement
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      agentName: string;
      safeAddress: string;
      listingPriceXdai: number;
      seller: string;
      namespace: string;
      signature: string;
      agreementHash: string;
      timestamp: number;
    };

    const { agentName, safeAddress, listingPriceXdai, seller, namespace, signature, agreementHash, timestamp } = body;

    if (!agentName || !safeAddress || !seller || !signature || !agreementHash || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── 1. Reconstruct agreement text & verify hash ──────────────────────────
    const text = buildAgreementText({ agentName, safeAddress, listingPriceXdai, seller }, timestamp);
    const expectedHash = await hashText(text);
    if (expectedHash !== agreementHash) {
      return NextResponse.json({ error: 'Agreement hash mismatch' }, { status: 400 });
    }

    // ── 2. Verify EIP-712 signature on-chain ─────────────────────────────────
    const message = {
      agentName,
      safeAddress:      safeAddress as `0x${string}`,
      listingPriceXdai: BigInt(Math.round(listingPriceXdai * 1e18)),
      seller:           seller as `0x${string}`,
      agreementVersion: AGREEMENT_VERSION,
      agreementHash:    agreementHash as `0x${string}`,
      timestamp:        BigInt(timestamp),
    };

    const isValid = await verifyTypedData({
      address:    seller as `0x${string}`,
      domain:     EIP712_DOMAIN,
      types:      EIP712_TYPES,
      primaryType: 'IPTransferAgreement',
      message,
      signature:  signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // ── 3. Pin agreement to IPFS via Lighthouse ──────────────────────────────
    const doc = { text, textHash: agreementHash, params: { agentName, safeAddress, listingPriceXdai, seller }, timestamp, version: AGREEMENT_VERSION };
    let ipfsCid = '';
    try {
      ipfsCid = await pinAgreementToIPFS(doc, signature);
    } catch (e: any) {
      console.error('IPFS pin failed (non-fatal):', e?.message);
      ipfsCid = `hash:${agreementHash}`;
    }

    // ── 4. Log to GlassBox via worker ────────────────────────────────────────
    const contentHash = await hashText(signature + ipfsCid);
    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'appendGlassBoxEntry',
          agentName,
          tld: namespace,
          ownerAddress: seller.toLowerCase(),
          entry: {
            id: `gb-listing-${timestamp}-${agentName}`,
            agentName,
            tld: namespace,
            eventType: 'marketplace-listing',
            timestamp,
            contentHash,
            xmtpEnabled: false,
            enhancedLogging: true,
            edgeEncryptNote: 'Glass Box Audit: IP Transfer Agreement Signed',
            from: seller,
            to: 'marketplace',
            subject: `IP Transfer Agreement — ${agentName} listed at ${listingPriceXdai} xDAI`,
            protocol: 'email',
          },
        }),
      });
    } catch (e: any) {
      console.error('GlassBox log failed (non-fatal):', e?.message);
    }

    // ── 5. Store listing record via worker KV ────────────────────────────────
    const listing: ListingRecord = {
      agentName,
      safeAddress,
      listingPriceXdai,
      seller,
      namespace,
      signature,
      agreementHash,
      ipfsCid,
      timestamp,
      version: AGREEMENT_VERSION,
    };

    try {
      await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setMarketplaceListing', listing }),
      });
    } catch (e: any) {
      console.error('Listing KV store failed (non-fatal):', e?.message);
    }

    return NextResponse.json({
      status: 'listed',
      agentName,
      ipfsCid,
      agreementHash,
      timestamp,
    });

  } catch (err: any) {
    console.error('/api/marketplace/list error:', err);
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

/**
 * GET /api/marketplace/list?agent=name&namespace=openclaw.gno
 * Returns the listing record for an agent, including agreement status.
 */
export async function GET(req: NextRequest) {
  const agent     = req.nextUrl.searchParams.get('agent');
  const namespace = req.nextUrl.searchParams.get('namespace');
  if (!agent || !namespace) {
    return NextResponse.json({ error: 'Missing agent or namespace' }, { status: 400 });
  }
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getMarketplaceListing', agentName: agent, namespace }),
    });
    if (res.status === 404) return NextResponse.json({ listing: null });
    const data = await res.json() as { listing?: ListingRecord; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json({ listing: data.listing ?? null });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
