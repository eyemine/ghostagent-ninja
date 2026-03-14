import { NextRequest, NextResponse } from 'next/server';
import {
  buildSwarmConfig,
  addSwarmMember,
  removeSwarmMember,
  isSwarmActive,
  type SwarmStrategy,
  type SwarmMember,
} from '../../../services/vault-swarm-config';
import { WORKER_URL } from '../../../utils/config';


/** KV key for a vault's swarm config */
function swarmKey(vaultName: string) {
  return `swarm:${vaultName.toLowerCase()}`;
}

// ── GET /api/swarm/enable?vault=ghost-alpha ───────────────────────────────────
export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get('vault');
  if (!vault) return NextResponse.json({ error: 'Missing vault name' }, { status: 400 });

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getSwarmConfig', vaultName: vault.toLowerCase() }),
    });
    if (res.status === 404) return NextResponse.json({ exists: false, vault, swarmActive: false });
    const data = await res.json() as { config?: unknown; error?: string };
    if (!res.ok) return NextResponse.json({ error: data.error ?? 'Worker error' }, { status: res.status });
    const config = data.config as Parameters<typeof isSwarmActive>[0];
    return NextResponse.json({ exists: true, swarmActive: isSwarmActive(config), config });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}

// ── POST /api/swarm/enable ────────────────────────────────────────────────────
// Actions: init | add-member | remove-member | set-strategy
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'init' | 'add-member' | 'remove-member' | 'set-strategy';
      vaultName: string;
      safeAddress?: string;
      ownerAddress: string;
      strategy?: SwarmStrategy;
      maxMembers?: number;
      hackathonTag?: string;
      member?: Omit<SwarmMember, 'joinedAt'>;
      agentName?: string;
    };

    const { action, vaultName, ownerAddress } = body;
    if (!vaultName || !ownerAddress) {
      return NextResponse.json({ error: 'Missing vaultName or ownerAddress' }, { status: 400 });
    }

    const key = swarmKey(vaultName);

    // ── init: create a new swarm config ──
    if (action === 'init') {
      if (!body.safeAddress) return NextResponse.json({ error: 'Missing safeAddress' }, { status: 400 });
      const config = buildSwarmConfig({
        vaultName: vaultName.toLowerCase(),
        safeAddress: body.safeAddress,
        strategy: body.strategy,
        maxMembers: body.maxMembers,
        hackathonTag: body.hackathonTag,
      });
      await workerKvPut(key, config, ownerAddress);
      return NextResponse.json({ status: 'ok', swarmActive: false, config });
    }

    // ── all other actions: load existing config first ──
    const existing = await workerKvGet(key);
    if (!existing) return NextResponse.json({ error: 'Swarm not initialised — call init first' }, { status: 404 });

    if (action === 'add-member') {
      if (!body.member) return NextResponse.json({ error: 'Missing member' }, { status: 400 });
      const result = addSwarmMember(existing, body.member);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      await workerKvPut(key, result.config, ownerAddress);
      return NextResponse.json({ status: 'ok', swarmActive: isSwarmActive(result.config), config: result.config });
    }

    if (action === 'remove-member') {
      if (!body.agentName) return NextResponse.json({ error: 'Missing agentName' }, { status: 400 });
      const updated = removeSwarmMember(existing, body.agentName);
      await workerKvPut(key, updated, ownerAddress);
      return NextResponse.json({ status: 'ok', swarmActive: isSwarmActive(updated), config: updated });
    }

    if (action === 'set-strategy') {
      if (!body.strategy) return NextResponse.json({ error: 'Missing strategy' }, { status: 400 });
      const updated = { ...existing, strategy: body.strategy, updatedAt: Date.now() };
      await workerKvPut(key, updated, ownerAddress);
      return NextResponse.json({ status: 'ok', swarmActive: isSwarmActive(updated), config: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function workerKvGet(key: string) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kvGet', key }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { value?: string };
    return data.value ? JSON.parse(data.value) : null;
  } catch { return null; }
}

async function workerKvPut(key: string, value: unknown, ownerAddress: string) {
  await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'kvPut', key,
      value: JSON.stringify(value),
      ownerAddress: ownerAddress.toLowerCase(),
    }),
  });
}
