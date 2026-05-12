/// API Route: GhostAgent Beacon Metadata
/// POST /api/beacon  — generate + pin metadata, store CID in worker KV
/// GET  /api/beacon?name=paymastr — fetch existing beacon (CID + metadata URL)
///
/// Schema: GhostAgent Beacon Metadata v1.0
/// IPFS:   Lighthouse (LIGHTHOUSE_API_KEY env var for persistent pinning)

import { NextRequest, NextResponse } from 'next/server';
import {
  buildAndPin,
  buildBeaconMetadata,
  type BuildBeaconParams,
  type EmailAliasMeta,
  type MoltEvent,
} from '../../services/beacon-metadata';
import { WORKER_URL } from '../../utils/config';


const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';
const LIGHTHOUSE_API_KEY = process.env.LIGHTHOUSE_API_KEY;

// ── GET /api/beacon?name=paymastr ────────────────────────────────────────────
// Returns existing beacon CID and metadata URL from worker KV.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getBeacon', name }),
    });

    if (res.status === 404) {
      return NextResponse.json({ exists: false, name }, { status: 200 });
    }

    const data = await res.json() as any;
    return NextResponse.json({ exists: true, ...data });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

// ── POST /api/beacon ──────────────────────────────────────────────────────────
// Body: {
//   agentName, ownerAddress, gnosisNft, tld?,
//   safeAddress?, tbaAddress?, storyIpDomain?,
//   currentLevel?, xdaiBurned?, moltHistory?, aliases?,
//   registeredAt?
// }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      agentName?: string;
      ownerAddress?: string;
      gnosisNft?: string;
      tld?: string;
      safeAddress?: string;
      tbaAddress?: string;
      storyIpDomain?: string;
      currentLevel?: string;
      xdaiBurned?: number;
      moltHistory?: MoltEvent[];
      aliases?: EmailAliasMeta[];
      registeredAt?: number;
    };

    const { agentName, ownerAddress, gnosisNft } = body;

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
    }
    if (!ownerAddress || !/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
      return NextResponse.json({ error: 'Invalid ownerAddress' }, { status: 400 });
    }
    if (!gnosisNft || typeof gnosisNft !== 'string') {
      return NextResponse.json({ error: 'Missing gnosisNft (e.g. paymastr.nftmail.gno)' }, { status: 400 });
    }

    const params: BuildBeaconParams = {
      agentName,
      ownerAddress,
      gnosisNft,
      tld:           body.tld           ?? 'nftmail.gno',
      safeAddress:   body.safeAddress   ?? null,
      tbaAddress:    body.tbaAddress    ?? null,
      storyIpDomain: body.storyIpDomain ?? null,
      currentLevel:  body.currentLevel  ?? 'basic',
      xdaiBurned:    body.xdaiBurned    ?? 0,
      moltHistory:   body.moltHistory   ?? [],
      aliases:       body.aliases       ?? [],
      registeredAt:  body.registeredAt  ?? Date.now(),
    };

    // ── Pin to IPFS via Lighthouse ──
    const result = await buildAndPin(params, LIGHTHOUSE_API_KEY);
    const pin     = result.pin;
    const metadata = result.metadata;

    if (!pin) {
      return NextResponse.json({
        status:  'partial',
        warning: 'Beacon metadata generated but IPFS pin failed (Lighthouse unavailable). Retry POST /api/beacon.',
        metadata,
        pinned:  false,
      }, { status: 207 });
    }

    // ── Store CID in worker KV ──
    let kvStored = false;
    if (WEBHOOK_SECRET) {
      try {
        const kvRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'setBeacon',
            secret: WEBHOOK_SECRET,
            name: agentName,
            cid: pin.cid,
            metadataUrl: pin.url,
            pinnedAt: pin.pinnedAt,
          }),
        });
        const kvData = await kvRes.json() as any;
        kvStored = kvData?.status === 'ok';
      } catch {
        // Non-fatal — CID is returned in response, can be stored manually
      }
    }

    return NextResponse.json({
      status: 'ok',
      message: 'Beacon Metadata Pinned to IPFS',
      name: agentName,
      cid: pin.cid,
      metadataUrl: pin.url,
      gateway: pin.gateway,
      pinnedAt: pin.pinnedAt,
      kvStored,
      metadata,
    });
  } catch (err: any) {
    console.error('[beacon] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal error' },
      { status: 500 }
    );
  }
}
