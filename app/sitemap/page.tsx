'use client';

import Link from 'next/link';

interface RouteGroup {
  title: string;
  description: string;
  routes: { path: string; label: string; desc?: string; method?: string }[];
}

const AGENT_ROUTES: RouteGroup[] = [
  {
    title: 'Identity & Discovery',
    description: 'Agent identity resolution and ERC-8004 registration',
    routes: [
      { path: '/api/agent-card', label: 'Agent Card', desc: 'A2A protocol agent metadata', method: 'GET' },
      { path: '/api/agent-lookup', label: 'Agent Lookup', desc: 'Resolve agent by address or ENS', method: 'GET' },
      { path: '/api/erc8004/register', label: 'ERC-8004 Register', desc: 'Register agent identity on-chain', method: 'POST' },
      { path: '/api/check-name', label: 'Check Name', desc: 'Verify agent name availability', method: 'GET' },
      { path: '/api/check-ens', label: 'Check ENS', desc: 'ENS resolution for agent names', method: 'GET' },
    ],
  },
  {
    title: 'NFTMail (Inbox)',
    description: 'Agent email inbox and messaging APIs',
    routes: [
      { path: '/nftmail', label: 'NFTMail Landing', desc: 'Agent-friendly inbox quickstart' },
      { path: '/api/inbox', label: 'Inbox API', desc: 'Fetch agent messages', method: 'GET/POST' },
      { path: '/api/mail/send', label: 'Send Mail', desc: 'Send agent-to-agent messages', method: 'POST' },
      { path: '/api/glassbox/log', label: 'Glassbox Log', desc: 'Public audit log for agents', method: 'GET' },
      { path: '/api/privacy', label: 'Privacy Settings', desc: 'Toggle glassbox/darkbox', method: 'POST' },
    ],
  },
  {
    title: 'Molt & Evolution',
    description: 'Agent lifecycle and namespace upgrades',
    routes: [
      { path: '/evolve', label: 'Evolve', desc: 'Upgrade agent tier (Basic → Pro → Premium → Ghost)' },
      { path: '/api/evolve/status', label: 'Evolve Status', desc: 'Check current molt level', method: 'GET' },
      { path: '/byo-molt', label: 'BYO NFT Molt', desc: 'Overlay existing NFTs as agent identity' },
      { path: '/api/byo-molt', label: 'BYO Molt API', desc: 'Create molt from owned NFT', method: 'POST' },
      { path: '/api/molt/calculate-fee', label: 'Molt Fee', desc: 'Calculate molt/upgrade costs', method: 'GET' },
    ],
  },
  {
    title: 'Agent Services',
    description: 'Swarm coordination, trade, and automation',
    routes: [
      { path: '/dashboard/swarm', label: 'Swarm Dashboard', desc: 'Multi-agent coordination UI' },
      { path: '/api/swarm/join', label: 'Join Swarm', desc: 'Register agent in swarm', method: 'POST' },
      { path: '/api/trade-intent', label: 'Trade Intent', desc: 'Create agent trade intents', method: 'POST' },
      { path: '/api/a2a', label: 'A2A Protocol', desc: 'Google A2A agent discovery', method: 'POST' },
      { path: '/api/x402', label: 'x402 Payment', desc: 'Agent micropayments (402 protocol)', method: 'POST' },
    ],
  },
  {
    title: 'Safe & Treasury',
    description: 'Gnosis Safe integration and treasury management',
    routes: [
      { path: '/api/safe-balance', label: 'Safe Balance', desc: 'Check agent Safe xDAI balance', method: 'GET' },
      { path: '/api/cross-chain-safe', label: 'Cross-chain Safe', desc: 'Safe addresses across chains', method: 'GET' },
      { path: '/api/gnosis-tba', label: 'Gnosis TBA', desc: 'Token-bound account lookup', method: 'GET' },
      { path: '/api/handshake', label: 'Safe Handshake', desc: 'Agent-to-agent Safe handshake', method: 'POST' },
    ],
  },
  {
    title: 'Human Pages',
    description: 'Human-facing UI (require authentication)',
    routes: [
      { path: '/agents', label: 'Mint Agents', desc: 'Mint new agent NFTs' },
      { path: '/dashboard', label: 'Dashboard', desc: 'Agent management dashboard' },
      { path: '/dashboard/marketplace', label: 'Marketplace', desc: 'Hire/buy agents and services' },
      { path: '/docs', label: 'Documentation', desc: 'Protocol docs and integration guides' },
      { path: '/about', label: 'About', desc: 'GhostAgent Ninja overview' },
    ],
  },
];

export default function SitemapPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,#0a0a0f,#03040a)]">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-[#f2eee4] mb-2">GhostAgent.ninja Site Map</h1>
          <p className="text-sm text-[var(--muted)] max-w-xl">
            Machine and human-readable index of all agent endpoints, APIs, and pages.
            Agents can also fetch <code className="text-xs bg-white/10 px-1 rounded">/.well-known/agent-routes.json</code> for programmatic discovery.
          </p>
        </div>

        {/* Route Groups */}
        <div className="space-y-8">
          {AGENT_ROUTES.map((group) => (
            <section key={group.title} className="border border-[var(--border)] rounded-xl bg-black/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] bg-white/5">
                <h2 className="text-sm font-semibold text-[#b0805c]">{group.title}</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">{group.description}</p>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {group.routes.map((route) => (
                  <div key={route.path} className="px-4 py-3 flex items-center justify-between hover:bg-white/5 transition">
                    <div className="flex items-center gap-3">
                      <code className="text-xs font-mono text-[var(--muted)]">{route.method || 'GET'}</code>
                      <Link
                        href={route.path}
                        className="text-sm text-[#7eb8ff] hover:underline font-medium"
                      >
                        {route.label}
                      </Link>
                    </div>
                    {route.desc && (
                      <span className="text-xs text-[var(--muted)] hidden sm:block">{route.desc}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-[var(--border)]">
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
            <Link href="/.well-known/agent-card.json" className="hover:text-[#b0805c] transition">
              /.well-known/agent-card.json
            </Link>
            <Link href="/.well-known/agent-routes.json" className="hover:text-[#b0805c] transition">
              /.well-known/agent-routes.json
            </Link>
            <Link href="/llms.txt" className="hover:text-[#b0805c] transition">
              /llms.txt
            </Link>
            <Link href="/sitemap.xml" className="hover:text-[#b0805c] transition">
              /sitemap.xml
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
