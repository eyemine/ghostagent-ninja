/// GET /.well-known/agent-card.json
///
/// A2A Protocol RC v1.0 — AgentCard discovery document
/// Spec: https://a2a-protocol.org/latest/specification/#8-agent-discovery-the-agent-card
///
/// This is the PLATFORM-LEVEL A2A Agent Card for ghostagent.ninja.
/// Individual per-agent ERC-8004 docs live at /api/agent/[name]/registration.json
/// Individual per-agent ERC-8004 docs also at /api/agent-card?agent=<name>&sld=<sld>

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ghostagent.ninja';
const WORKER_URL = process.env.NFTMAIL_WORKER_URL  ?? 'https://nftmail-email-worker.richard-159.workers.dev';

export async function GET() {
  const agentCard = {
    name: 'GhostAgent',
    description:
      'Sovereign AI agent platform on Gnosis Chain. Each GhostAgent has a non-custodial ' +
      'NFT-bound identity (nftmail.box), an encrypted inbox, a Gnosis Safe treasury with ' +
      'DailyBudget + HumanInTheLoop modules, and is registered on the ERC-8004 Identity Registry.',
    iconUrl: `${APP_URL}/ghost-logo.png`,
    version: '1.0.0',
    documentationUrl: `${APP_URL}/docs`,

    // A2A interfaces — JSON-RPC primary per spec §9, worker HTTP+JSON secondary
    supportedInterfaces: [
      {
        url: `${APP_URL}/api/a2a`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
      {
        url: `${WORKER_URL}`,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
      },
    ],

    provider: {
      organization: 'Ghost Agent Ninja Pty Ltd',
      url: APP_URL,
      legalEntity: 'GHOST AGENT NINJA PTY LTD',
    },

    // EIP-155 chain binding — prevents cross-chain replay of signed trade intents
    chainBinding: {
      standard: 'EIP-155',
      chains: [
        { chainId: 100,      name: 'Gnosis Mainnet',  role: 'primary',  safe: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4' },
        { chainId: 11155111, name: 'Ethereum Sepolia', role: 'testnet',  safe: null },
      ],
      eip1271: true,
      note: 'Gnosis Safe satisfies EIP-1271 — the NFT handle belongs to the Safe which acts as agent brain/vault',
    },

    // Agent wallet — Gnosis Safe on primary chain
    agentWallet: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
    agentWalletChain: 'eip155:100',
    agentWalletType: 'GnosisSafe',

    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: true,
    },

    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],

    skills: [
      {
        id: 'a2a-message',
        name: 'Agent-to-Agent Messaging',
        description:
          'Send encrypted messages to any GhostAgent inbox via the nftmail.box ' +
          'Ghost-Wire protocol. Messages route to the agent\'s sovereign NFT-bound inbox on Gnosis Chain.',
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
          'Query live telemetry for any registered GhostAgent: inbox count, heartbeat, ' +
          'surge score, ERC-8004 agentId, Safe address, Story IP asset.',
        tags: ['status', 'telemetry', 'audit', 'erc8004'],
        examples: ['{"action":"getAgentStatus","localPart":"ghostagent_"}'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'trade-intent',
        name: 'EIP-712 TradeIntent',
        description:
          'Publish or discover signed EIP-712 TradeIntents for on-chain A2A trade ' +
          'negotiations. Intents are stored in KV and discoverable by counter-agents.',
        tags: ['trade', 'eip712', 'defi', 'intent', 'erc8004'],
        examples: ['{"action":"getTradeIntents","agentName":"ghostagent"}'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'erc8004-registration',
        name: 'ERC-8004 Agent Registration',
        description:
          'Fetch the ERC-8004 #registration-v1 document for any GhostAgent. ' +
          'Includes on-chain agentId, Gnosis Safe, Story IP, and service endpoints.',
        tags: ['erc8004', 'identity', 'registry', 'gnosis'],
        examples: [`${APP_URL}/api/agent/ghostagent/registration.json`],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],

    // ERC-8004 extension — links this A2A card to on-chain identity
    // Also declares EIP-712 domain for trade intent signing
    extensions: [
      {
        uri: 'https://eips.ethereum.org/EIPS/eip-8004',
        description: 'ERC-8004 Trustless Agents — on-chain identity registry',
        required: false,
        params: {
          agentId: 3180,
          identityRegistry:   'eip155:100:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
          reputationRegistry: 'eip155:100:0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
          registrationJson:   `${APP_URL}/api/agent/ghostagent/registration.json`,
        },
      },
      {
        uri: 'https://eips.ethereum.org/EIPS/eip-712',
        description: 'EIP-712 typed data signing — chain-bound TradeIntents prevent cross-chain replay',
        required: false,
        params: {
          domainName: 'GhostAgent',
          domainVersion: '1',
          primaryChainId: 100,
          tradeIntentType: 'TradeIntent(address agent,address token,uint256 amount,uint256 price,uint256 deadline,string intentType)',
        },
      },
      {
        uri: 'https://eips.ethereum.org/EIPS/eip-1271',
        description: 'EIP-1271 contract signature validation — Gnosis Safe owns the ERC-8004 NFT handle',
        required: false,
        params: {
          safeAddress: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4',
          safeChain: 'eip155:100',
        },
      },
    ],

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
