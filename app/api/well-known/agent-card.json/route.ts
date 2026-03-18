/// GET /.well-known/agent-card.json
/// (also reachable at /api/well-known/agent-card.json)
///
/// A2A Protocol RC v1.0 — AgentCard discovery document
/// Spec: https://a2a-protocol.org/latest/specification/#8-agent-discovery-the-agent-card
///
/// This is the *platform-level* Agent Card for ghostagent.ninja.
/// Individual agent cards can be fetched via /api/agent-card?agent=<name>&sld=<sld>
/// and are referenced from the ERC-8004 registration.json services array.

import { NextResponse } from 'next/server';
import { WORKER_URL } from '../../../utils/config';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ghostagent.ninja';

export const dynamic = 'force-dynamic';

export async function GET() {
  const agentCard = {
    name: 'GhostAgent',
    description:
      'Sovereign AI agent platform on Gnosis Chain. Each GhostAgent has a non-custodial NFT-bound identity (nftmail.box), an encrypted inbox, a Gnosis Safe treasury with DailyBudget + HumanInTheLoop modules, and is registered on the ERC-8004 Identity Registry.',
    url: APP_URL,
    iconUrl: `${APP_URL}/ghost-logo.png`,
    version: '1.0.0',
    documentationUrl: `${APP_URL}/docs`,

    // A2A protocol interfaces — JSONRPC binding (primary)
    // Full task execution endpoint is on the roadmap; discovery is live now.
    supportedInterfaces: [
      {
        url: `${WORKER_URL}`,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      },
    ],

    provider: {
      organization: 'GhostAgent Ninja',
      url: APP_URL,
    },

    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },

    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],

    // Skills — discrete capabilities exposed to A2A clients
    skills: [
      {
        id: 'a2a-message',
        name: 'Agent-to-Agent Messaging',
        description:
          'Send encrypted messages to any GhostAgent inbox via nftmail.box Ghost-Wire protocol. Messages are routed to the agent\'s sovereign NFT-bound inbox on Gnosis Chain.',
        tags: ['messaging', 'email', 'a2a', 'nftmail', 'gnosis'],
        examples: [
          '{"action":"sendA2A","fromAgent":"alice_","toAgent":"bob_","message":"Hello from Alice"}',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'agent-status',
        name: 'Agent Status & Telemetry',
        description:
          'Query live telemetry for any registered GhostAgent: inbox count, heartbeat, surge score, ERC-8004 agentId, Safe address, Story IP asset.',
        tags: ['status', 'telemetry', 'audit', 'erc8004'],
        examples: [
          '{"action":"getAgentStatus","localPart":"ghostagent_"}',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'trade-intent',
        name: 'EIP-712 TradeIntent',
        description:
          'Publish or discover signed EIP-712 TradeIntents for on-chain A2A trade negotiations. Intents are stored in KV and discoverable by counter-agents.',
        tags: ['trade', 'eip712', 'defi', 'intent', 'erc8004'],
        examples: [
          '{"action":"getTradeIntents","agentName":"ghostagent"}',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'erc8004-registration',
        name: 'ERC-8004 Agent Registration',
        description:
          'Fetch the ERC-8004 #registration-v1 document for any GhostAgent. Includes on-chain agentId, Gnosis Safe, Story IP, and service endpoints.',
        tags: ['erc8004', 'identity', 'registry', 'gnosis'],
        examples: [
          `${APP_URL}/api/agent-card?agent=ghostagent`,
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],

    // ERC-8004 extension — links this A2A card to on-chain identity
    extensions: [
      {
        uri: 'https://eips.ethereum.org/EIPS/eip-8004',
        description: 'ERC-8004 Trustless Agents — on-chain identity registry',
        required: false,
        params: {
          agentId: 3199,
          identityRegistry: 'eip155:100:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
          reputationRegistry: 'eip155:100:0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
          registrationJson: `${APP_URL}/api/agent-card?agent=ghostagent`,
        },
      },
    ],

    // Security — no auth required for public skill endpoints
    securitySchemes: {},
    security: [],
  };

  return new NextResponse(JSON.stringify(agentCard, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
