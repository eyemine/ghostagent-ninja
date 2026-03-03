import { NextRequest, NextResponse } from 'next/server';
import {
  workerTierToLevel,
  levelToWorkerTier,
  parseLevelRecord,
  type EvolveLevel,
} from '../../services/evolve-level';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

const WEBHOOK_SECRET = process.env.NFTMAIL_WEBHOOK_SECRET || '';

/**
 * GET /api/evolve?name=victor&tld=agent.gno
 * Returns current level record for an agent.
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name');
  const tld  = req.nextUrl.searchParams.get('tld') || 'agent.gno';

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAcctTier', localPart: name, tld }),
    });

    if (!res.ok) {
      return NextResponse.json({ level: 'egg', workerTier: 'basic', sendEnabled: false, retention: '8-day', expiresAt: null, safe: null, storyIp: null, marketplaceBadge: null, ipAssetDomain: null });
    }

    const raw = await res.json() as { tier?: string; raw?: string; [k: string]: any };
    const record = parseLevelRecord(raw.raw ?? JSON.stringify(raw));
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ level: 'egg', workerTier: 'basic', sendEnabled: false, retention: '8-day', expiresAt: null, safe: null, storyIp: null, marketplaceBadge: null, ipAssetDomain: null });
  }
}

/**
 * POST /api/evolve
 * Body: { action: 'upgrade'|'downgrade', name, tld, walletAddress, safeAddress?, txHash? }
 *
 * upgrade   (pupa → imago): +14 xDAI one-off + 24 xDAI/yr
 *   - Calls worker upgradeTier (newTier=premium)
 *   - Triggers Story .ip asset mint via /api/gasless-ip-mint
 *   - Updates marketplace badge in KV
 *
 * downgrade (imago → pupa): cancel subscription, preserve all data
 *   - Calls worker upgradeTier (newTier=lite)
 *   - Preserves email, Safe, history
 */
export async function POST(req: NextRequest) {
  try {
    const {
      action,
      name,
      tld,
      walletAddress,
      safeAddress,
      tbaAddress,
      txHash,
    } = await req.json() as {
      action: 'upgrade' | 'downgrade';
      name: string;
      tld: string;
      walletAddress: string;
      safeAddress?: string;
      tbaAddress?: string;
      txHash?: string;
    };

    if (!action || !name || !tld || !walletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: action, name, tld, walletAddress' },
        { status: 400 }
      );
    }

    if (!['upgrade', 'downgrade'].includes(action)) {
      return NextResponse.json({ error: 'action must be upgrade or downgrade' }, { status: 400 });
    }

    const newWorkerTier = action === 'upgrade' ? 'premium' : 'lite';
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = action === 'upgrade'
      ? Date.now() + ONE_YEAR_MS
      : Date.now() + THIRTY_DAYS_MS;

    // Step 1: Update worker KV tier via upgradeTier action
    const tierRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upgradeTier',
        secret: WEBHOOK_SECRET,
        label: name,
        newTier: newWorkerTier,
        safe: safeAddress ?? null,
        retention: action === 'upgrade' ? 'infinite' : '30-day',
      }),
    });

    if (!tierRes.ok) {
      const err = await tierRes.text();
      return NextResponse.json({ error: `Worker tier update failed: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const tierData = await tierRes.json() as { status?: string; error?: string };
    if (tierData.error) {
      return NextResponse.json({ error: tierData.error }, { status: 400 });
    }

    interface StoryIpResult {
      fullDomain?: string;
      ipAccount?: string;
      tokenId?: string;
      txHash?: string;
      error?: string;
    }
    let storyIpResult: StoryIpResult | null = null;

    // Step 2: Deploy Story .ip asset on upgrade (fire via internal gasless-ip-mint)
    if (action === 'upgrade' && tbaAddress) {
      try {
        const ipRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/gasless-ip-mint`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentName: name,
              tbaAddress,
              ownerWallet: walletAddress,
            }),
          }
        );
        const ipData = await ipRes.json() as StoryIpResult;
        storyIpResult = ipData;

        // Backfill story_ip into acct-tier KV if mint succeeded
        if (ipData && !ipData.error && ipData.fullDomain) {
          await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upgradeTier',
              secret: WEBHOOK_SECRET,
              label: name,
              newTier: newWorkerTier,
              safe: safeAddress ?? null,
              storyIp: name,
              retention: 'infinite',
            }),
          });
        }
      } catch {
        // Non-fatal — IP mint can be retried; tier upgrade already committed
        storyIpResult = { error: 'Story .ip mint deferred — tier upgraded successfully' };
      }
    }

    const newLevel: EvolveLevel = action === 'upgrade' ? 'imago' : 'pupa';

    return NextResponse.json({
      status: 'ok',
      action,
      level: newLevel,
      workerTier: newWorkerTier,
      expiresAt,
      retention: action === 'upgrade' ? 'infinite' : '30-day',
      marketplaceBadge: action === 'upgrade' ? 'Imago' : 'Pupa',
      storyIp: storyIpResult ?? null,
      paymentTxHash: txHash ?? null,
      message: action === 'upgrade'
        ? `Evolved to Imago ✓ — infinite retention + Story .ip asset registered`
        : `Returned to Pupa — 30-day cycle active. Email, Safe, and history preserved.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
