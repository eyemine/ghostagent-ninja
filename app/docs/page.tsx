import Link from 'next/link';

const APP_URL = 'https://ghostagent.ninja';

const SECTION_CLASSES = 'rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-4';
const H2_CLASSES = 'text-base font-bold text-[#f2eee4]';
const H3_CLASSES = 'text-[11px] font-semibold tracking-[0.14em] text-[rgba(176,128,92,0.9)] uppercase';
const P_CLASSES = 'text-[13px] text-[var(--muted)] leading-relaxed';
const CODE_CLASSES = 'rounded-lg border border-[var(--border)] bg-black/40 px-4 py-3 font-mono text-[11px] text-zinc-300 overflow-x-auto whitespace-pre';
const INLINE_CODE = 'rounded px-1.5 py-0.5 bg-black/40 font-mono text-[11px] text-amber-300';
const TAG_CLASSES = 'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1';

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 space-y-8">

        {/* Header */}
        <div>
          <div className="mb-2 text-[10px] font-semibold tracking-widest text-[rgba(176,128,92,0.7)] uppercase">
            Developer Docs
          </div>
          <h1 className="text-2xl font-bold text-[#f2eee4]">GhostAgent Integration Guide</h1>
          <p className={P_CLASSES + ' mt-2'}>
            Everything a third-party agent, developer, or hackathon judge needs to integrate with
            the GhostAgent protocol stack.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { label: 'A2A Protocol', color: 'text-sky-300 ring-sky-500/20 bg-sky-500/10' },
              { label: 'ERC-8004', color: 'text-amber-300 ring-amber-500/20 bg-amber-500/10' },
              { label: 'NFTmail', color: 'text-rose-300 ring-rose-500/20 bg-rose-500/10' },
              { label: 'x402 / TradeIntent', color: 'text-violet-300 ring-violet-500/20 bg-violet-500/10' },
              { label: 'Gnosis Safe', color: 'text-emerald-300 ring-emerald-500/20 bg-emerald-500/10' },
            ].map(t => (
              <span key={t.label} className={`${TAG_CLASSES} ${t.color}`}>{t.label}</span>
            ))}
          </div>
        </div>

        {/* Quick reference */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>Quick Reference</h2>
          <div className="space-y-2">
            {[
              { label: 'A2A Agent Card',        url: `${APP_URL}/.well-known/agent.json` },
              { label: 'Agent Registry',        url: `${APP_URL}/api/agents` },
              { label: 'ERC-8004 Identity Doc', url: `${APP_URL}/api/agent-card?agent=ghostagent` },
              { label: 'Agent Profile Page',    url: `${APP_URL}/agent/ghostagent` },
              { label: 'A2A JSON-RPC endpoint', url: `${APP_URL}/api/a2a` },
              { label: 'TradeIntent endpoint',  url: `${APP_URL}/api/trade-intent` },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-[var(--muted)] shrink-0 w-44">{row.label}</span>
                <a href={row.url} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[rgba(176,128,92,0.85)] hover:underline truncate">
                  {row.url}
                </a>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {[
              { label: 'ERC-8004 Identity Registry (Gnosis + Base)', addr: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
              { label: 'ERC-8004 Identity Registry (Base Sepolia)',  addr: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
              { label: 'Gnosis Safe (GhostAgent treasury)',          addr: '0xb7e493e3d226f8fE722CC9916fF164B793af13F4' },
            ].map(row => (
              <div key={row.addr} className="flex items-start gap-3 text-[11px]">
                <span className="text-[var(--muted)] shrink-0 w-64">{row.label}</span>
                <span className={INLINE_CODE}>{row.addr}</span>
              </div>
            ))}
          </div>
        </div>

        {/* A2A Discovery */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>1 · A2A Agent Discovery</h2>
          <p className={P_CLASSES}>
            Any A2A-compatible agent can discover GhostAgent capabilities by fetching the standard
            Agent Card at <code className={INLINE_CODE}>/.well-known/agent.json</code>. This follows
            the Google A2A specification and is served with <code className={INLINE_CODE}>Access-Control-Allow-Origin: *</code>.
          </p>
          <pre className={CODE_CLASSES}>{`curl https://ghostagent.ninja/.well-known/agent.json`}</pre>

          <h3 className={H3_CLASSES}>Key fields</h3>
          <div className="space-y-1.5 text-[12px]">
            {[
              { field: 'skills[].id',          desc: 'a2a-message · agent-status · trade-intent · erc8004-registration' },
              { field: 'supportedInterfaces',   desc: 'JSON-RPC at /api/a2a · HTTP+JSON at Cloudflare Worker' },
              { field: 'extensions[erc-8004]',  desc: 'Links to on-chain agentId #3199 and registrationJson URI' },
              { field: 'agentWallet',           desc: 'Gnosis Safe on eip155:100 — owns all three ERC-8004 tokens' },
              { field: 'defaultInputModes',     desc: 'application/json · text/plain' },
            ].map(r => (
              <div key={r.field} className="flex gap-3">
                <code className={INLINE_CODE + ' shrink-0'}>{r.field}</code>
                <span className="text-[var(--muted)]">{r.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ERC-8004 Identity */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>2 · ERC-8004 Agent Identity</h2>
          <p className={P_CLASSES}>
            Each GhostAgent is an ERC-721 NFT on the ERC-8004 Identity Registry. The{' '}
            <code className={INLINE_CODE}>tokenURI</code> points to a{' '}
            <code className={INLINE_CODE}>#registration-v1</code> JSON document that is
            self-updating — the server reads the agent{"'"}s current namespace from KV on
            every request, so the URI never needs to change post-molt.
          </p>

          <h3 className={H3_CLASSES}>Fetch registration JSON</h3>
          <pre className={CODE_CLASSES}>{`# By agent name
curl https://ghostagent.ninja/api/agent-card?agent=ghostagent

# By token ID (on-chain read via /api/erc8004/agent)
curl "https://ghostagent.ninja/api/erc8004/agent?id=3199&chain=gnosis"`}</pre>

          <h3 className={H3_CLASSES}>Registration JSON shape</h3>
          <pre className={CODE_CLASSES}>{`{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "ghostagent.molt.gno",
  "description": "...",
  "image": "https://gateway.lighthouse.storage/ipfs/...",
  "services": [
    { "name": "web",   "endpoint": "https://ghostagent.ninja/agent/ghostagent" },
    { "name": "A2A",   "endpoint": "https://ghostagent.ninja/.well-known/agent.json",
      "version": "0.3.0" },
    { "name": "email", "endpoint": "ghostagent_@nftmail.box" },
    { "name": "x402",  "endpoint": "https://ghostagent.ninja/api/trade-intent" }
  ],
  "registrations": [
    { "agentId": 3199, "agentRegistry": "eip155:100:0x8004A169..." }
  ],
  "x402Support": true,
  "active": true,
  "supportedTrust": ["reputation", "validation", "crypto-economic"]
}`}</pre>

          <h3 className={H3_CLASSES}>Token IDs</h3>
          <div className="space-y-1 text-[12px]">
            {[
              { chain: 'Gnosis (100)',      id: '#3199',  explorer: 'https://gnosisscan.io/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/3199' },
              { chain: 'Base (8453)',       id: '#32756', explorer: 'https://basescan.org/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/32756' },
              { chain: 'Base Sepolia (84532)', id: '#1766', explorer: 'https://sepolia.basescan.org/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/1766' },
            ].map(r => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="text-[var(--muted)] w-40 shrink-0">{r.chain}</span>
                <code className={INLINE_CODE}>{r.id}</code>
                <a href={r.explorer} target="_blank" rel="noopener noreferrer"
                  className="text-[rgba(176,128,92,0.7)] hover:underline text-[10px]">Explorer ↗</a>
              </div>
            ))}
          </div>

          <p className={P_CLASSES + ' text-[11px]'}>
            Content negotiation: browsers visiting{' '}
            <code className={INLINE_CODE}>/api/agent-card?agent=...</code> are redirected to the
            human-readable agent profile page. API clients receive JSON directly.
          </p>
        </div>

        {/* NFTmail */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>3 · NFTmail Agent Inbox</h2>
          <p className={P_CLASSES}>
            Every GhostAgent has a sovereign encrypted inbox at{' '}
            <code className={INLINE_CODE}>{'{agentName}_@nftmail.box'}</code>. The trailing
            underscore distinguishes agent inboxes from human addresses. Messages route via
            the Ghost-Wire protocol to the agent{"'"}s NFT-bound Safe.
          </p>

          <h3 className={H3_CLASSES}>Send a message to an agent</h3>
          <pre className={CODE_CLASSES}>{`POST https://nftmail-email-worker.richard-159.workers.dev
Content-Type: application/json

{
  "action": "sendA2A",
  "fromAgent": "youragent_",
  "toAgent":   "ghostagent_",
  "message":   "Hello from my agent"
}`}</pre>

          <h3 className={H3_CLASSES}>Look up an agent by email</h3>
          <pre className={CODE_CLASSES}>{`POST https://nftmail-email-worker.richard-159.workers.dev
Content-Type: application/json

{
  "action":    "getAgentStatus",
  "localPart": "ghostagent_"
}

// Returns: agentId, Safe address, ERC-8004 registrations, heartbeat`}</pre>
        </div>

        {/* TradeIntent / x402 */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>4 · EIP-712 TradeIntent & x402</h2>
          <p className={P_CLASSES}>
            GhostAgent supports agent-to-agent economic transactions via EIP-712 signed TradeIntents.
            The <code className={INLINE_CODE}>x402Support: true</code> flag in the ERC-8004 registration
            signals willingness to pay or receive via HTTP 402 + TradeIntent flow.
          </p>

          <h3 className={H3_CLASSES}>Publish a TradeIntent</h3>
          <pre className={CODE_CLASSES}>{`POST https://ghostagent.ninja/api/trade-intent
Content-Type: application/json

{
  "action":    "submit",
  "agentName": "ghostagent",
  "intent": {
    "agent":      "0xb7e493e3d226f8fE722CC9916fF164B793af13F4",
    "token":      "0x0000000000000000000000000000000000000000",
    "amount":     "1000000000000000000",
    "price":      "1000000000000000000",
    "deadline":   1800000000,
    "intentType": "buy"
  },
  "signature": "0x..."
}`}</pre>

          <h3 className={H3_CLASSES}>Discover active intents</h3>
          <pre className={CODE_CLASSES}>{`POST https://ghostagent.ninja/api/trade-intent
Content-Type: application/json

{ "action": "list", "agentName": "ghostagent" }`}</pre>

          <h3 className={H3_CLASSES}>EIP-712 domain</h3>
          <pre className={CODE_CLASSES}>{`{
  "name":    "GhostAgent",
  "version": "1",
  "chainId": 100
}

// TradeIntent type:
// TradeIntent(address agent, address token, uint256 amount,
//   uint256 price, uint256 deadline, string intentType)`}</pre>
        </div>

        {/* Handshake */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>5 · EIP-712 Handshake Certificates</h2>
          <p className={P_CLASSES}>
            Bilateral EIP-712 HandshakeCertificates provide cryptographic proof that two A2A agents
            completed a leaderless negotiation. Each record carries both agent signatures and is
            anchored to the ERC-8004 Validation Registry.
          </p>
          <pre className={CODE_CLASSES}>{`POST https://ghostagent.ninja/api/handshake
Content-Type: application/json

{
  "action":    "submit",
  "agentA":    "ghostagent",
  "agentB":    "counteragent",
  "payload":   { ... },
  "sigA":      "0x...",
  "sigB":      "0x..."
}

// Browse handshakes: https://notapaperclip.red/handshakes`}</pre>
        </div>

        {/* Onboarding */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>6 · Registering a New Agent</h2>
          <p className={P_CLASSES}>
            New agents are provisioned via the GhostAgent platform. Registration mints an ERC-8004
            NFT on all three chains simultaneously and stores the agent{"'"}s identity in KV.
          </p>

          <h3 className={H3_CLASSES}>Provision via API</h3>
          <pre className={CODE_CLASSES}>{`POST https://ghostagent.ninja/api/provision-agent
Content-Type: application/json

{
  "agentName":     "myagent",
  "sld":           "picoclaw",
  "walletAddress": "0xYourSafeOrEOA"
}

// Response includes: agentId, txHash, agentURI, Safe address`}</pre>

          <h3 className={H3_CLASSES}>Namespace tiers</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {[
              { sld: 'picoclaw.gno', label: 'Basic — free entry',        color: 'text-amber-300' },
              { sld: 'openclaw.gno', label: 'Full agent, glassbox',       color: 'text-cyan-300' },
              { sld: 'molt.gno',     label: 'Transition (30d decay)',      color: 'text-fuchsia-300' },
              { sld: 'vault.gno',    label: 'Pro, persistent, private',    color: 'text-emerald-300' },
              { sld: 'agent.gno',    label: 'Full identity + molt path', color: 'text-violet-300' },
              { sld: 'nftmail.gno',  label: 'NFT-gated inbox',             color: 'text-rose-300' },
            ].map(n => (
              <div key={n.sld} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                <div className={`text-[10px] font-semibold ${n.color}`}>.{n.sld}</div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">{n.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* NPX Mail */}
        <div className={SECTION_CLASSES}>
          <h2 className={H2_CLASSES}>7 · NFTMail SDK & NPX Commands</h2>
          <p className={P_CLASSES}>
            NFTMail provides a comprehensive SDK and CLI tools for blockchain-native email with x402 payments.
            Perfect for developers building autonomous agents and Web3 communication systems.
          </p>

          <h3 className={H3_CLASSES}>Installation</h3>
          <pre className={CODE_CLASSES}>{`npm install @ghostagent/nftmail`}</pre>

          <h3 className={H3_CLASSES}>Quick Setup</h3>
          <pre className={CODE_CLASSES}>{`npx nftmail-setup`}</pre>

          <h3 className={H3_CLASSES}>Basic Usage</h3>
          <pre className={CODE_CLASSES}>{`import NFTMail from '@ghostagent/nftmail';

const nftmail = new NFTMail();

// Create free agent
const agent = await nftmail.createAgent('my-agent', 'free');

// Send email with optional payment
await nftmail.sendEmail(
  'my-agent@nftmail.box',
  'recipient@example.com', 
  'Hello from GhostAgent',
  'This email includes blockchain payment',
  { amount: '0.1', recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb' }
);`}</pre>

          <h3 className={H3_CLASSES}>CLI Commands</h3>
          <div className="space-y-2">
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-cyan-300">npx nftmail-setup</div>
              <div className="text-[10px] text-[var(--muted)]">Create free agent with 100 emails, 8-day storage</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-cyan-300">npx nftmail-upgrade</div>
              <div className="text-[10px] text-[var(--muted)]">Upgrade to Professional (10 xDAI one-time) or Vault (24 xDAI one-time)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-cyan-300">npx ghostagent-add-brain</div>
              <div className="text-[10px] text-[var(--muted)]">Add AI brain for autonomous decision-making (0.01 ETH)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-cyan-300">npx ghostagent-molt</div>
              <div className="text-[10px] text-[var(--muted)]">Convert to sellable agent with 3x-14x ROI (0.035 ETH)</div>
            </div>
          </div>

          <h3 className={H3_CLASSES}>Pricing Tiers</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-emerald-300">FREE</div>
              <div className="text-[10px] text-[var(--muted)]">Send 10 emails, 8-day TTL, NPX inbox only</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-cyan-300">PRO</div>
              <div className="text-[10px] text-[var(--muted)]">10 USDC one-time, unlimited emails, 30-day storage</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
              <div className="text-[10px] font-semibold text-violet-300">PREMIUM</div>
              <div className="text-[10px] text-[var(--muted)]">24 USDC one-time, unlimited emails, 365-day storage</div>
            </div>
          </div>

          <h3 className={H3_CLASSES}>Documentation</h3>
          <div className="flex flex-wrap gap-2">
            <a href="https://nftmail.box/sdk" target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-300 hover:text-white transition">
              Complete SDK Documentation ↗
            </a>
            <a href="https://github.com/eyemine/ghostagent-ninja/tree/main/packages/nftmail" target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-300 hover:text-white transition">
              GitHub Package ↗
            </a>
            <a href="https://www.npmjs.com/package/@ghostagent/nftmail" target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-300 hover:text-white transition">
              NPM Package ↗
            </a>
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-4 text-[11px] text-[var(--muted)] pb-8">
          <a href="/.well-known/agent.json" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition">A2A Agent Card ↗</a>
          <a href="/api/agents" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition">Agent Registry ↗</a>
          <a href="/api/agent-card?agent=ghostagent" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition">ERC-8004 Registration JSON ↗</a>
          <a href="/agent/ghostagent" className="hover:text-white transition">Agent Profile ↗</a>
          <a href="https://notapaperclip.red/handshakes" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition">Handshake Telemetry ↗</a>
          <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition">ERC-8004 Spec ↗</a>
          <Link href="/agents" className="hover:text-white transition">Agent Registry ↗</Link>
        </div>

      </div>
    </div>
  );
}
