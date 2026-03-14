import { NextRequest, NextResponse } from 'next/server';
import {
  buildStakeRecord,
  computeUnstake,
  resolveStakeTier,
  type StakeRecord,
} from '../../services/host-staking';
import { WORKER_URL } from '../../utils/config';


/**
 * GET /api/stake?name=victor&tld=agent.gno
 * Returns the current stake record for an agent.
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
      body: JSON.stringify({ action: 'getStake', localPart: name, tld }),
    });

    if (!res.ok) {
      return NextResponse.json({ stakedHost: 0, activeTier: 'none', unlockedSend: false });
    }

    const data = await res.json() as Partial<StakeRecord>;
    return NextResponse.json({
      stakedHost:      data.stakedHost      ?? 0,
      activeTier:      data.activeTier      ?? 'none',
      unlockedSend:    data.unlockedSend    ?? false,
      persistenceDays: data.persistenceDays ?? null,
      expiresAt:       data.expiresAt       ?? null,
      moltPrivateBalance: data.moltPrivateBalance ?? 0,
    });
  } catch {
    return NextResponse.json({ stakedHost: 0, activeTier: 'none', unlockedSend: false });
  }
}

/**
 * POST /api/stake
 * Body: { action: 'stake'|'unstake', name, tld, hostAmount, walletAddress }
 *
 * - stake:   add hostAmount to existing stake, recompute tier, persist to KV
 * - unstake: reduce stake, warn about lost unlocks, persist to KV
 */
export async function POST(req: NextRequest) {
  try {
    const { action, name, tld, hostAmount, walletAddress } = await req.json() as {
      action: 'stake' | 'unstake';
      name: string;
      tld: string;
      hostAmount: number;
      walletAddress: string;
    };

    if (!name || !tld || !walletAddress || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: action, name, tld, walletAddress' },
        { status: 400 }
      );
    }

    if (!['stake', 'unstake'].includes(action)) {
      return NextResponse.json({ error: 'action must be stake or unstake' }, { status: 400 });
    }

    const amt = Number(hostAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: 'hostAmount must be a positive number' }, { status: 400 });
    }

    // Fetch existing stake record from Worker KV
    const existingRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getStake', localPart: name, tld }),
    });

    let existing: StakeRecord | null = null;
    if (existingRes.ok) {
      try { existing = await existingRes.json() as StakeRecord; } catch {}
    }

    let newRecord: StakeRecord;
    let lostUnlocks: string[] = [];

    if (action === 'stake') {
      const prevStaked = existing?.stakedHost ?? 0;
      const prevMoltBalance = existing?.moltPrivateBalance ?? 0;
      newRecord = buildStakeRecord(name, tld, walletAddress, prevStaked + amt, prevMoltBalance);
    } else {
      // unstake
      if (!existing || existing.stakedHost <= 0) {
        return NextResponse.json({ error: 'No active stake to unstake' }, { status: 400 });
      }
      const { newStakedHost, lost } = computeUnstake(existing, amt);
      lostUnlocks = lost;
      newRecord = buildStakeRecord(name, tld, walletAddress, newStakedHost, existing.moltPrivateBalance);
    }

    // Persist to Worker KV
    const putRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setStake',
        localPart: name,
        tld,
        stakeRecord: newRecord,
      }),
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      return NextResponse.json({ error: `Worker error: ${err.slice(0, 200)}` }, { status: 502 });
    }

    return NextResponse.json({
      status: 'ok',
      action,
      stakedHost:      newRecord.stakedHost,
      activeTier:      newRecord.activeTier,
      unlockedSend:    newRecord.unlockedSend,
      persistenceDays: newRecord.persistenceDays,
      expiresAt:       newRecord.expiresAt,
      lostUnlocks,
      message: action === 'stake'
        ? `${amt} $HOST staked for ${newRecord.activeTier === 'send' ? 'Send' : newRecord.activeTier} ✓`
        : `${amt} $HOST unstaked`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
