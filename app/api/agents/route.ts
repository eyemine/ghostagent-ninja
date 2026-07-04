/// GET /api/agents
/// GET /api/agents?chain=gnosis|base|baseSepolia   (filter by chain)
/// GET /api/agents?erc8004=true                    (only agents with ERC-8004 registration)
///
/// Public ERC-8004 agent registry.
/// Returns all GhostAgents registered in KV, with their A2A card URLs,
/// ERC-8004 identity registry IDs, and TLD namespace.
///
/// This is the on-chain agent discovery endpoint — any A2A client can call this
/// to enumerate agents and locate their agent cards.

import { NextRequest, NextResponse } from 'next/server';
import { WORKER_URL } from '../../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ghostagent.ninja';
const WORKER_SECRET = process.env.WORKER_SECRET || process.env.WEBHOOK_SECRET || '';

export const dynamic = 'force-dynamic';

export interface AgentRegistryEntry {
  name:         string;
  tld:          string | null;
  profileUrl:   string;
  agentCardUrl: string;
  a2aCardUrl:   string;
  erc8004: {
    gnosis?:      { agentId: number; chainId: 100;   agentURI: string };
    base?:        { agentId: number; chainId: 8453;  agentURI: string };
    baseSepolia?: { agentId: number; chainId: 84532; agentURI: string };
  };
}

export interface AgentRegistry {
  description: string;
  platformA2ACard: string;
  platformERC8004Registry: string;
  total: number;
  agents: AgentRegistryEntry[];
}

export async function GET(req: NextRequest) {
  const chainFilter  = req.nextUrl.searchParams.get('chain') ?? null;
  const erc8004Only  = req.nextUrl.searchParams.get('erc8004') === 'true';

  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET },
      body:    JSON.stringify({ action: 'listAgents' }),
      cache:   'no-store',
    });

    console.log('[/api/agents] worker status:', res.status, 'ok:', res.ok);
    const bodyText = await res.text();
    console.log('[/api/agents] worker body:', bodyText.slice(0, 500));

    if (!res.ok) {
      return NextResponse.json(
        { error: `Worker error: ${res.status}`, body: bodyText },
        { status: 502 },
      );
    }

    const data = JSON.parse(bodyText) as { agents: AgentRegistryEntry[]; total: number };
    let agents: AgentRegistryEntry[] = data.agents ?? [];

    // Filter: only agents with at least one ERC-8004 registration
    if (erc8004Only) {
      agents = agents.filter(a => Object.keys(a.erc8004 ?? {}).length > 0);
    }

    // Filter: only agents registered on a specific chain
    if (chainFilter && ['gnosis', 'base', 'baseSepolia'].includes(chainFilter)) {
      agents = agents.filter(a => a.erc8004?.[chainFilter as keyof AgentRegistryEntry['erc8004']] != null);
    }

    const registry: AgentRegistry = {
      description:             'GhostAgent ERC-8004 on-chain agent registry. Each entry links to a sovereign AI agent with an NFTmail inbox, Gnosis Safe, and A2A-compatible agent card.',
      platformA2ACard:         `${APP_URL}/.well-known/agent-card.json`,
      platformERC8004Registry: 'eip155:100:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      total:                   agents.length,
      agents,
    };

    return new NextResponse(JSON.stringify(registry, null, 2), {
      headers: {
        'Content-Type':                'application/json',
        'Cache-Control':               'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Registry fetch failed' },
      { status: 500 },
    );
  }
}
