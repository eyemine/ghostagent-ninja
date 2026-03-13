/**
 * POST /api/swarm/member
 *
 * Swarm member management with 7-day timelock.
 *
 * Body:
 *   { action: 'queue-add',    vaultName, picoclawAddress, agentName, ownerAddress }
 *   { action: 'queue-remove', vaultName, picoclawAddress, ownerAddress }
 *   { action: 'execute',      vaultName, changeId, ownerAddress }
 *   { action: 'cancel',       vaultName, changeId, ownerAddress }
 *   { action: 'list',         vaultName }
 */

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

async function workerPost(body: Record<string, unknown>) {
  const res = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { action, vaultName, ownerAddress } = body as {
    action?: string; vaultName?: string; ownerAddress?: string;
  };

  if (!action || !vaultName) {
    return NextResponse.json({ error: 'Missing action or vaultName' }, { status: 400 });
  }

  if (action === 'list') {
    const data = await workerPost({ action: 'kvGet', key: `swarm:members:${(vaultName as string).toLowerCase()}` });
    const members = data?.value ? JSON.parse(data.value) : [];
    return NextResponse.json({ members });
  }

  if (!ownerAddress) {
    return NextResponse.json({ error: 'Missing ownerAddress' }, { status: 400 });
  }

  if (action === 'queue-add') {
    const { picoclawAddress, agentName } = body as { picoclawAddress?: string; agentName?: string };
    if (!picoclawAddress || !agentName) {
      return NextResponse.json({ error: 'Missing picoclawAddress or agentName' }, { status: 400 });
    }

    const changeId = `${Date.now()}-${picoclawAddress.slice(2, 10)}`;
    const executableAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const change = {
      changeId,
      picoclawAddress,
      agentName,
      isAdd: true,
      queuedAt: Date.now(),
      executableAt,
      executed: false,
      cancelled: false,
    };

    const queueKey = `swarm:member-queue:${vaultName.toLowerCase()}`;
    const existing = await workerPost({ action: 'kvGet', key: queueKey });
    const queue: unknown[] = existing?.value ? JSON.parse(existing.value) : [];
    queue.push(change);

    await workerPost({ action: 'kvPut', key: queueKey, value: JSON.stringify(queue), ownerAddress });

    return NextResponse.json({
      ok: true,
      changeId,
      executableAt,
      message: `Swarm Member Queued (Timelock: 7 days) — ${agentName}`,
    });
  }

  if (action === 'queue-remove') {
    const { picoclawAddress } = body as { picoclawAddress?: string };
    if (!picoclawAddress) return NextResponse.json({ error: 'Missing picoclawAddress' }, { status: 400 });

    const changeId = `${Date.now()}-rm-${picoclawAddress.slice(2, 10)}`;
    const executableAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const change = {
      changeId,
      picoclawAddress,
      agentName: '',
      isAdd: false,
      queuedAt: Date.now(),
      executableAt,
      executed: false,
      cancelled: false,
    };

    const queueKey = `swarm:member-queue:${vaultName.toLowerCase()}`;
    const existing = await workerPost({ action: 'kvGet', key: queueKey });
    const queue: unknown[] = existing?.value ? JSON.parse(existing.value) : [];
    queue.push(change);
    await workerPost({ action: 'kvPut', key: queueKey, value: JSON.stringify(queue), ownerAddress });

    return NextResponse.json({ ok: true, changeId, executableAt });
  }

  if (action === 'execute') {
    const { changeId } = body as { changeId?: string };
    if (!changeId) return NextResponse.json({ error: 'Missing changeId' }, { status: 400 });

    const queueKey = `swarm:member-queue:${vaultName.toLowerCase()}`;
    const existing = await workerPost({ action: 'kvGet', key: queueKey });
    const queue: Array<{
      changeId: string; picoclawAddress: string; agentName: string;
      isAdd: boolean; executableAt: number; executed: boolean; cancelled: boolean;
    }> = existing?.value ? JSON.parse(existing.value) : [];

    const change = queue.find(c => c.changeId === changeId);
    if (!change) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
    if (change.executed || change.cancelled) return NextResponse.json({ error: 'Already done' }, { status: 409 });
    if (Date.now() < change.executableAt) {
      const remaining = Math.ceil((change.executableAt - Date.now()) / 86400000);
      return NextResponse.json({ error: `Timelock active — ${remaining} day(s) remaining` }, { status: 403 });
    }

    change.executed = true;
    await workerPost({ action: 'kvPut', key: queueKey, value: JSON.stringify(queue), ownerAddress });

    // Update member list
    const memberKey = `swarm:members:${vaultName.toLowerCase()}`;
    const existingMembers = await workerPost({ action: 'kvGet', key: memberKey });
    const members: Array<{ address: string; agentName: string; joinedAt: number }> =
      existingMembers?.value ? JSON.parse(existingMembers.value) : [];

    if (change.isAdd) {
      members.push({ address: change.picoclawAddress, agentName: change.agentName, joinedAt: Date.now() });
      await workerPost({ action: 'kvPut', key: memberKey, value: JSON.stringify(members), ownerAddress });
      return NextResponse.json({ ok: true, message: `Swarm Member Added ✓ — ${change.agentName}` });
    } else {
      const updated = members.filter(m => m.address.toLowerCase() !== change.picoclawAddress.toLowerCase());
      await workerPost({ action: 'kvPut', key: memberKey, value: JSON.stringify(updated), ownerAddress });
      return NextResponse.json({ ok: true, message: `Swarm Member Removed ✓` });
    }
  }

  if (action === 'cancel') {
    const { changeId } = body as { changeId?: string };
    if (!changeId) return NextResponse.json({ error: 'Missing changeId' }, { status: 400 });

    const queueKey = `swarm:member-queue:${vaultName.toLowerCase()}`;
    const existing = await workerPost({ action: 'kvGet', key: queueKey });
    const queue: Array<{ changeId: string; executed: boolean; cancelled: boolean }> =
      existing?.value ? JSON.parse(existing.value) : [];

    const change = queue.find(c => c.changeId === changeId);
    if (!change) return NextResponse.json({ error: 'Change not found' }, { status: 404 });
    if (change.executed || change.cancelled) return NextResponse.json({ error: 'Already done' }, { status: 409 });

    change.cancelled = true;
    await workerPost({ action: 'kvPut', key: queueKey, value: JSON.stringify(queue), ownerAddress });
    return NextResponse.json({ ok: true, message: 'Change cancelled' });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
