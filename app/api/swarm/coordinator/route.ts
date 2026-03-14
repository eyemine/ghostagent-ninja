import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';


/**
 * GET /api/swarm/coordinator?vault=acme
 * Returns coordinator state: agents, active tasks, completed tasks.
 */
export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get('vault');
  if (!vault) return NextResponse.json({ error: 'Missing vault' }, { status: 400 });

  const section = req.nextUrl.searchParams.get('section') ?? 'state';

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getCoordinatorState', vaultName: vault.toLowerCase(), section }),
    });
    if (res.status === 404) return NextResponse.json({ exists: false, vault, agents: [], tasks: [], rounds: [] });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return NextResponse.json({ error: (data as any).error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

/**
 * POST /api/swarm/coordinator
 * Actions:
 *   register-agent  — add picoclaw agent to coordinator
 *   remove-agent    — deactivate agent
 *   assign-task     — distribute incoming email to next available agent
 *   complete-task   — mark task done, log to Glass Box
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, vaultName } = body as { action: string; vaultName: string };

    if (!action || !vaultName) {
      return NextResponse.json({ error: 'Missing action or vaultName' }, { status: 400 });
    }

    // ── Consensus round creation ──────────────────────────────────────────────
    if (action === 'createConsensusRound') {
      const res = await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'swarmConsensus',
          subAction:   'createRound',
          vaultName:   vaultName.toLowerCase(),
          topic:       body.topic,
          payload:     body.payload,
          strategy:    body.strategy ?? 'consensus',
          xmtpEnabled: body.xmtpEnabled ?? false,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) return NextResponse.json({ error: (data as any).error ?? 'Worker error' }, { status: res.status });
      return NextResponse.json(data);
    }

    // ── Cast vote ─────────────────────────────────────────────────────────────
    if (action === 'castVote') {
      const res = await fetch(WORKER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'swarmConsensus',
          subAction: 'castVote',
          vaultName: vaultName.toLowerCase(),
          roundId:   body.roundId,
          agentName: body.agentName,
          vote:      body.vote,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) return NextResponse.json({ error: (data as any).error ?? 'Worker error' }, { status: res.status });
      return NextResponse.json(data);
    }

    // ── Legacy coordinator actions ────────────────────────────────────────────
    const ownerAddress = (body.walletAddress ?? body.ownerAddress ?? '') as string;
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:        'coordinatorAction',
        subAction:     action,
        vaultName:     vaultName.toLowerCase(),
        ownerAddress:  ownerAddress.toLowerCase(),
        agentName:     body.agentName,
        moduleAddress: body.moduleAddress,
        topic:         body.topic,
        payloadHash:   body.payloadHash,
        taskId:        body.taskId,
        resultHash:    body.resultHash,
      }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) return NextResponse.json({ error: (data as any).error ?? 'Worker error' }, { status: res.status });
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
