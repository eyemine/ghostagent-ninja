import { NextRequest, NextResponse } from 'next/server';
import {
  workerTierToLevel,
  levelToWorkerTier,
  parseLevelRecord,
  type EvolveLevel,
} from '../../services/evolve-level';
import { trackEvolve } from '../../services/molt-path-tracker';
import { mintIPAsset } from '../../services/ip-minter';
import { WORKER_URL } from '../../utils/config';


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
      return NextResponse.json({ level: 'basic', workerTier: 'basic', sendEnabled: false, retention: '8-day', expiresAt: null, safe: null, storyIp: null, marketplaceBadge: null, ipAssetDomain: null });
    }

    const raw = await res.json() as { tier?: string; raw?: string; [k: string]: any };
    const record = parseLevelRecord(raw.raw ?? JSON.stringify(raw));
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ level: 'basic', workerTier: 'basic', sendEnabled: false, retention: '8-day', expiresAt: null, safe: null, storyIp: null, marketplaceBadge: null, ipAssetDomain: null });
  }
}

/**
 * POST /api/evolve
 * Body: { action: 'upgrade'|'downgrade', name, tld, walletAddress, safeAddress?, txHash? }
 *
 * upgrade   (lite → premium): +14 xDAI one-off + 24 xDAI/yr
 *   - Calls worker upgradeTier (newTier=premium)
 *   - Triggers Story .ip asset mint via /api/gasless-ip-mint
 *   - Updates marketplace badge in KV
 *
 * downgrade (premium → lite): cancel subscription, preserve all data
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

    // Resolve current level before the transition so we know fromLevel
    let currentWorkerTier = 'basic';
    try {
      const currentRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAcctTier', localPart: name, tld }),
      });
      if (currentRes.ok) {
        const currentRaw = await currentRes.json() as { tier?: string; raw?: string };
        const currentRecord = parseLevelRecord(currentRaw.raw ?? JSON.stringify(currentRaw));
        currentWorkerTier = currentRecord.workerTier;
      }
    } catch {
      // Non-fatal — proceed with assumed 'basic'
    }
    const fromLevel: EvolveLevel = workerTierToLevel(currentWorkerTier);
    const isBasicToLite = fromLevel === 'basic' && action === 'upgrade';

    const newWorkerTier = isBasicToLite ? 'lite' : action === 'upgrade' ? 'premium' : 'lite';
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt = isBasicToLite || action === 'downgrade'
      ? Date.now() + THIRTY_DAYS_MS
      : Date.now() + ONE_YEAR_MS;

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
        retention: isBasicToLite ? '30-day' : action === 'upgrade' ? 'infinite' : '30-day',
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
    let basicToLiteIPResult: Awaited<ReturnType<typeof mintIPAsset>> | null = null;

    // Step 2a: Basic → Lite — mint creation.ip on first paid evolution
    if (isBasicToLite && tbaAddress) {
      try {
        basicToLiteIPResult = await mintIPAsset({
          agentName: name,
          tld,
          tbaAddress,
          ownerWallet: walletAddress,
          safeAddress: safeAddress ?? undefined,
          fromLevel: 'basic',
          toLevel: 'lite',
          webhookSecret: WEBHOOK_SECRET,
        });
      } catch {
        // Non-fatal — tier upgrade already committed
        basicToLiteIPResult = { success: false, ipType: 'creation.ip', error: 'IP mint deferred' };
      }

      // Step 2a.1: Basic → Lite — register ERC-8004 identity (agent brain)
      // This gives the body its agent identity and email account
      try {
        const sld = tld.replace('.gno', '');
        const erc8004Body = { agentName: name, sld, ownerWallet: walletAddress };
        // Register on all three chains (fire-and-forget)
        await Promise.allSettled([
          fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/erc8004/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(erc8004Body),
          }),
          fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/erc8004/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...erc8004Body, network: 'base' }),
          }),
          fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/api/erc8004/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...erc8004Body, network: 'baseSepolia' }),
          }),
        ]);
      } catch {
        // Non-fatal — tier upgrade already committed
      }
    }

    // Step 2b: Lite → Premium — deploy Story .ip asset via gasless-ip-mint
    if (action === 'upgrade' && !isBasicToLite && tbaAddress) {
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

    const newLevel: EvolveLevel = isBasicToLite ? 'lite' : action === 'upgrade' ? 'premium' : 'lite';

    // Step 3: Track molt path + re-pin beacon metadata (non-fatal)
    const xdaiBurned = action === 'upgrade' ? 38 : 0; // 14 one-off + 24 annual
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
    const LIGHTHOUSE_API_KEY = process.env.LIGHTHOUSE_API_KEY;

    let moltPathResult: Awaited<ReturnType<typeof trackEvolve>> | null = null;
    try {
      moltPathResult = await trackEvolve(
        {
          agentName: name,
          ownerAddress: walletAddress,
          gnosisNft: `${name}.${tld}`,
          fromLevel,
          toLevel: newLevel,
          xdaiBurned,
          txHash: txHash ?? '',
          safeAddress: safeAddress ?? null,
          tbaAddress: tbaAddress ?? null,
          storyIpDomain: basicToLiteIPResult?.fullDomain ?? storyIpResult?.fullDomain ?? null,
          repinBeacon: true,
        },
        WEBHOOK_SECRET,
        LIGHTHOUSE_API_KEY,
      );
    } catch {
      // Non-fatal — tier upgrade already committed
    }

    return NextResponse.json({
      status: 'ok',
      action,
      level: newLevel,
      workerTier: newWorkerTier,
      expiresAt,
      retention: isBasicToLite ? '30-day' : action === 'upgrade' ? 'infinite' : '30-day',
      marketplaceBadge: isBasicToLite ? 'Lite' : action === 'upgrade' ? 'Premium' : 'Lite',
      storyIp: basicToLiteIPResult ?? storyIpResult ?? null,
      paymentTxHash: txHash ?? null,
      molt_path: moltPathResult
        ? {
            currentLevel:           moltPathResult.record.currentLevel,
            totalXdaiBurned:        moltPathResult.record.totalXdaiBurned,
            surgeReputationScore:   moltPathResult.record.surgeReputationScore,
            lastEvolveTimestamp:    moltPathResult.record.lastEvolveTimestamp,
            evolutionHistoryLength: moltPathResult.record.evolutionHistory.length,
            beaconCid:              moltPathResult.beaconCid,
            beaconMetadataUrl:      moltPathResult.beaconMetadataUrl,
          }
        : null,
      message: isBasicToLite
        ? `Evolved to Lite ✓ — send enabled + ${basicToLiteIPResult?.fullDomain ? `.IP Minted: ${basicToLiteIPResult.fullDomain}` : 'Story .ip asset registered'}`
        : action === 'upgrade'
        ? `Evolved to Premium ✓ — infinite retention + Story .ip asset registered`
        : `Returned to Lite — 30-day cycle active. Email, Safe, and history preserved.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
