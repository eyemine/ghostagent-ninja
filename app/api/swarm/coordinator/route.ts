import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

/**
 * GET /api/swarm/coordinator?vault=acme
 * Returns coordinator state: agents, active tasks, completed tasks.
 */
export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get('vault');
  if (!vault) return NextResponse.json({ error: 'Missing vault' }, { status: 400 });

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getCoordinatorState', vaultName: vault.toLowerCase() }),
    });
    if (res.status === 404) return NextResponse.json({ exists: false, vault, agents: [], tasks: [] });
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
    const body = await req.json() as {
      action: 'register-agent' | 'remove-agent' | 'assign-task' | 'complete-task';
      vaultName: string;
      ownerAddress: string;
      agentName?: string;
      moduleAddress?: string;
      topic?: string;
      payloadHash?: string;
      taskId?: string;
      resultHash?: string;
    };

    const { action, vaultName, ownerAddress } = body;
    if (!action || !vaultName || !ownerAddress) {
      return NextResponse.json({ error: 'Missing action, vaultName, or ownerAddress' }, { status: 400 });
    }

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'coordinatorAction',
        subAction: action,
        vaultName: vaultName.toLowerCase(),
        ownerAddress: ownerAddress.toLowerCase(),
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
