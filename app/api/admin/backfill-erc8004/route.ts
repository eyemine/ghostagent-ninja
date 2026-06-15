/// POST /api/admin/backfill-erc8004
/// Backfill missing ERC-8004 agentIds from on-chain to KV.
/// Body: { dryRun?: boolean, agentNames?: string[] }
/// Auth: Bearer ADMIN_SECRET

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbi } from 'viem';
import { gnosis } from 'viem/chains';
import { WORKER_URL } from '../../../utils/config';

const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const TREASURY_ADDRESS = '0xf251Ca37a80200f7AfefF398DA0338f4C1f01249'.toLowerCase();

const ABI = parseAbi([
  'function getAgent(uint256 agentId) view returns (address owner, string memory agentURI, uint256)',
  'function agentURIs(uint256 agentId) view returns (string memory)',
]);

async function scanChain(): Promise<Array<{name: string; agentId: number; owner: string}>> {
  const client = createPublicClient({ chain: gnosis, transport: http() });
  const found: Array<{name: string; agentId: number; owner: string}> = [];

  for (let id = 3199; id <= 3700; id++) {
    try {
      const uri = await client.readContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: 'agentURIs', args: [BigInt(id)] });
      if (!uri || uri.length === 0) continue;
      const match = uri.match(/agent=([^&]+)/);
      if (!match) continue;
      const agent = await client.readContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: 'getAgent', args: [BigInt(id)] });
      // Only include agents registered by ghostagent.ninja treasury
      if (agent[0].toLowerCase() !== TREASURY_ADDRESS) continue;
      found.push({ name: match[1], agentId: id, owner: agent[0] });
    } catch { /* skip */ }
  }
  return found;
}

async function getKvId(name: string): Promise<number | null> {
  const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET }, body: JSON.stringify({ action: 'getAgentIdentity', name }) });
  if (!res.ok) return null;
  const data = await res.json() as { erc8004AgentId?: number };
  return data.erc8004AgentId ?? null;
}

async function setKvId(name: string, agentId: number, owner: string, uri: string): Promise<boolean> {
  const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WORKER_SECRET }, body: JSON.stringify({ action: 'setErc8004AgentId', agentName: name, erc8004AgentId: agentId, agentURI: uri, chainId: 100, safeOwner: owner }) });
  return res.ok;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { dryRun?: boolean; agentNames?: string[]; secret?: string };
  const auth = req.headers.get('authorization')?.replace('Bearer ', '') ?? body?.secret ?? '';
  
  // Debug: log lengths to diagnose auth mismatch (don't log actual secrets)
  console.log('[backfill-erc8004] Auth received length:', auth.length, 'ADMIN_SECRET length:', ADMIN_SECRET.length);
  console.log('[backfill-erc8004] Auth match:', auth === ADMIN_SECRET);
  
  const validSecrets = [
    process.env.ADMIN_SECRET,
    process.env.WORKER_SECRET,
    process.env.WEBHOOK_SECRET,
  ].filter(Boolean);
  if (!auth || !validSecrets.includes(auth)) {
    return NextResponse.json({ error: 'Unauthorized', debug: { authLen: auth.length, validLens: validSecrets.map(s => s!.length) } }, { status: 401 });
  }
  const dryRun = body.dryRun ?? false;

  const chainAgents = await scanChain();
  const targetAgents = body.agentNames?.length ? chainAgents.filter(a => body.agentNames!.includes(a.name)) : chainAgents;

  const results = await Promise.all(targetAgents.map(async (agent) => {
    const kvId = await getKvId(agent.name);
    if (kvId === agent.agentId) return { name: agent.name, agentId: agent.agentId, action: 'skipped' as const };
    if (dryRun) return { name: agent.name, agentId: agent.agentId, action: 'dry_run' as const };
    const client = createPublicClient({ chain: gnosis, transport: http() });
    const uri = await client.readContract({ address: IDENTITY_REGISTRY, abi: ABI, functionName: 'agentURIs', args: [BigInt(agent.agentId)] }) as string;
    const success = await setKvId(agent.name, agent.agentId, agent.owner, uri);
    return { name: agent.name, agentId: agent.agentId, action: success ? 'backfilled' : 'failed' as const };
  }));

  return NextResponse.json({ dryRun, total: results.length, backfilled: results.filter(r => r.action === 'backfilled').length, results });
}
