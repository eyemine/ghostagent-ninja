/**
 * GET /api/agent/[name]/registration.json
 *
 * ERC-8004 Agent Registration JSON — served at a stable agentURI.
 * Schema: https://eips.ethereum.org/EIPS/eip-8004#registration-v1
 *
 * Used by:
 *   - ERC-8004 Identity Registry register(agentURI) call
 *   - Validation Registry validationRequest()
 *   - Any A2A agent discovery
 */

import { NextRequest, NextResponse } from 'next/server';

const WORKER_URL =
  process.env.NFTMAIL_WORKER_URL ||
  'https://nftmail-email-worker.richard-159.workers.dev';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

// ERC-8004 Identity Registry deployments (testnets)
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_REGISTRIES: Record<string, { chainId: number; address: string; name: string }> = {
  sepolia:      { chainId: 11155111, address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', name: 'Ethereum Sepolia' },
  baseSepolia:  { chainId: 84532,    address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', name: 'Base Sepolia' },
};

const DEFAULT_REGISTRY = ERC8004_REGISTRIES.baseSepolia;

export async function GET(
  _req: NextRequest,
  { params }: { params: { name: string } }
) {
  const agentName = params.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!agentName) {
    return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
  }

  // Fetch identity graph from worker
  let graph: Record<string, any> = {};
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', localPart: `${agentName}_` }),
    });
    if (res.ok) {
      graph = await res.json() as Record<string, any>;
    }
  } catch {}

  // Check if ERC-8004 agentId is already registered
  const erc8004AgentId: number | null = graph.erc8004AgentId ?? null;
  const tld = graph.tld || 'nftmail.box';
  const agentDomain = `${agentName}.${tld}`;
  const safeAddress = graph.safe || null;
  const storyIp = graph.storyIp || null;

  // Build ERC-8004 Registration JSON
  const registration = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: agentDomain,
    description: `GhostAgent AI Agent — ${agentDomain}. Non-custodial sovereign identity on Gnosis Chain. Inbox: ${agentName}_@nftmail.box`,
    image: `${APP_URL}/ghost-logo.png`,

    // Service endpoints
    services: [
      {
        name: 'A2A',
        endpoint: `${WORKER_URL}`,
        description: 'Agent-to-Agent messaging via nftmail.box Ghost-Wire protocol',
      },
      {
        name: 'email',
        endpoint: `${agentName}_@nftmail.box`,
        description: 'Sovereign NFT-bound email inbox on Gnosis Chain',
      },
      {
        name: 'audit',
        endpoint: `${APP_URL}/api/agent-lookup?q=${agentName}_`,
        description: 'Public identity graph — on-chain linkage, Safe, Story IP, tier',
      },
      {
        name: 'status',
        endpoint: `${APP_URL}/api/agent/${agentName}/registration.json`,
        description: 'ERC-8004 registration document (this endpoint)',
      },
      ...(safeAddress ? [{
        name: 'safe',
        endpoint: `https://app.safe.global/home?safe=gno:${safeAddress}`,
        description: 'Gnosis Safe treasury with DailyBudget + HumanInTheLoop modules',
      }] : []),
      ...(storyIp ? [{
        name: 'storyIP',
        endpoint: `https://portal.story.foundation/ipa/${storyIp}`,
        description: 'Story Protocol IP Asset — agent output IP registration',
      }] : []),
    ],

    // Trust model
    supportedTrust: ['reputation'],

    // Active flag — dormant if no messages and no safe
    active: graph.exists === true,

    // On-chain registrations (ERC-8004 agentId if registered, else empty)
    registrations: erc8004AgentId !== null ? [
      {
        agentId: erc8004AgentId,
        agentRegistry: `eip155:${DEFAULT_REGISTRY.chainId}:${DEFAULT_REGISTRY.address}`,
        registeredAt: graph.erc8004RegisteredAt ?? null,
      },
    ] : [],

    // GhostAgent extensions (non-standard, prefixed)
    'ghostagent:gnosis': {
      tba: graph.tbaAddress ?? null,
      safe: safeAddress,
      tld,
      tier: graph.accountTier ?? 'basic',
      inbox: graph.inbox ?? { count: 0 },
      heartbeat: graph.heartbeat ?? { isActive: false, lastBeat: null },
      surgeScore: graph.surgeScore ?? 0,
      storyIp,
      privacyTier: graph.privacyTier ?? 'exposed',
    },
  };

  return NextResponse.json(registration, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
