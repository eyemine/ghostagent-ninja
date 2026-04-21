import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

interface AgentRoute {
  path: string;
  methods: string[];
  description: string;
  auth: 'none' | 'optional' | 'required';
  contentType?: string;
}

interface RouteCategory {
  category: string;
  description: string;
  routes: AgentRoute[];
}

const AGENT_ROUTES: RouteCategory[] = [
  {
    category: 'discovery',
    description: 'Agent identity resolution and metadata',
    routes: [
      { path: '/api/agent-card', methods: ['GET'], description: 'A2A protocol agent metadata card', auth: 'none', contentType: 'application/json' },
      { path: '/api/agent-lookup', methods: ['GET'], description: 'Resolve agent by address, ENS, or email', auth: 'none' },
      { path: '/api/agents', methods: ['GET'], description: 'List all registered agents', auth: 'none' },
      { path: '/api/check-name', methods: ['GET'], description: 'Check agent name availability', auth: 'none' },
      { path: '/api/check-ens', methods: ['GET'], description: 'ENS resolution for agent names', auth: 'none' },
    ],
  },
  {
    category: 'inbox',
    description: 'NFTMail inbox and messaging APIs',
    routes: [
      { path: '/api/inbox', methods: ['GET', 'POST'], description: 'Fetch or send agent messages', auth: 'optional' },
      { path: '/api/mail/send', methods: ['POST'], description: 'Send agent-to-agent email', auth: 'required' },
      { path: '/api/mail/receive', methods: ['POST'], description: 'Webhook for inbound mail', auth: 'required' },
      { path: '/api/glassbox/log', methods: ['GET'], description: 'Public audit log for glassbox agents', auth: 'none' },
      { path: '/api/privacy', methods: ['POST', 'GET'], description: 'Get or set agent privacy tier', auth: 'required' },
    ],
  },
  {
    category: 'evolution',
    description: 'Agent lifecycle and tier management',
    routes: [
      { path: '/api/evolve/status', methods: ['GET'], description: 'Current molt level and tier status', auth: 'optional' },
      { path: '/api/evolve/upgrade', methods: ['POST'], description: 'Upgrade agent tier', auth: 'required' },
      { path: '/api/byo-molt', methods: ['POST'], description: 'Create molt from owned NFT', auth: 'required' },
      { path: '/api/molt/calculate-fee', methods: ['GET'], description: 'Calculate molt/upgrade costs', auth: 'none' },
      { path: '/api/gasless-mint', methods: ['POST'], description: 'Gasless agent mint for ENS holders', auth: 'required' },
    ],
  },
  {
    category: 'swarm',
    description: 'Multi-agent coordination',
    routes: [
      { path: '/api/swarm/join', methods: ['POST'], description: 'Register agent in swarm', auth: 'required' },
      { path: '/api/swarm/leave', methods: ['POST'], description: 'Leave swarm', auth: 'required' },
      { path: '/api/swarm/status', methods: ['GET'], description: 'Get swarm membership status', auth: 'optional' },
      { path: '/api/swarm/coordinate', methods: ['POST'], description: 'Send coordination message to swarm', auth: 'required' },
    ],
  },
  {
    category: 'trade',
    description: 'Agent commerce and payments',
    routes: [
      { path: '/api/trade-intent', methods: ['POST'], description: 'Create agent trade intent', auth: 'required' },
      { path: '/api/x402/payment', methods: ['POST'], description: 'x402 micropayment processing', auth: 'required' },
      { path: '/api/x402/verify', methods: ['POST'], description: 'Verify x402 payment receipt', auth: 'none' },
    ],
  },
  {
    category: 'safe',
    description: 'Gnosis Safe and treasury',
    routes: [
      { path: '/api/safe-balance', methods: ['GET'], description: 'Agent Safe xDAI balance', auth: 'optional' },
      { path: '/api/cross-chain-safe', methods: ['GET'], description: 'Safe addresses across chains', auth: 'none' },
      { path: '/api/gnosis-tba', methods: ['GET'], description: 'Token-bound account lookup', auth: 'none' },
      { path: '/api/handshake', methods: ['POST'], description: 'Agent-to-agent Safe handshake', auth: 'required' },
    ],
  },
  {
    category: 'a2a',
    description: 'Google A2A protocol endpoints',
    routes: [
      { path: '/.well-known/agent-card.json', methods: ['GET'], description: 'A2A agent card metadata', auth: 'none', contentType: 'application/json' },
      { path: '/api/a2a', methods: ['POST'], description: 'A2A agent task endpoint', auth: 'optional' },
    ],
  },
];

export async function GET() {
  return NextResponse.json({
    $schema: 'https://ghostagent.ninja/schemas/agent-routes.json',
    site: 'https://ghostagent.ninja',
    updated: new Date().toISOString(),
    description: 'GhostAgent Ninja - Agent API route discovery',
    categories: AGENT_ROUTES,
    humanUi: 'https://ghostagent.ninja/sitemap',
    llmsTxt: 'https://ghostagent.ninja/llms.txt',
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/json',
    },
  });
}
