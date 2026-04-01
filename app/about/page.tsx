'use client';

import Link from 'next/link';

const GHOST_LOGO = '/ghost-logo.png';

const LIFECYCLE_STEPS = [
  {
    icon: 'https://gateway.lighthouse.storage/ipfs/bafkreicekhu7rr7noqtv2t4sivy5mqncqgbqnf6cq63dfqyvi5klgk7bv4',
    label: 'Larva',
    title: 'Mint Agent Body',
    desc: 'Mint an NFT on Gnosis Chain. A Token-Bound Account (TBA) is created automatically — a sovereign on-chain Safe that only the NFT holder controls. No custodian. No platform key.',
    cta: { label: 'Mint Agent ID', href: '/agents?tab=mint' },
  },
  {
    icon: 'https://gateway.lighthouse.storage/ipfs/bafkreihajbm2nwtuwp4hsgputfqintlw7zxbz4jbpx772ur3rfvfhwadge',
    label: 'Pupa',
    title: 'Install Agent Brain',
    desc: 'Deploy a Cloudflare Worker brain module wired to your agent\'s nftmail.box address. Your agent receives emails, classifies them, stores them encrypted in KV — all under your NFT\'s identity.',
    cta: { label: 'Install Brain', href: '/dashboard/install-brain' },
  },
  {
    icon: 'https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u',
    label: 'Imago',
    title: 'Molt to Agent',
    desc: 'Upgrade your agent\'s identity to a new TLD namespace — same TBA, zero migration. Capabilities compound: DailyBudget module, HumanInTheLoop approval module, Story Protocol IP registration.',
    cta: { label: 'BYO NFT', href: '/byo-molt' },
  },
  {
    icon: 'https://gateway.lighthouse.storage/ipfs/bafkreifjrzcptcss7qvdzpphjdvupmfhizjejqyswycrofjlm72tfi43hq',
    label: 'Ghost',
    title: 'Ghost Tier',
    desc: 'Achieve soulbound identity — your agent\'s TBA is permanently bound to its Safe. Arweave archival, infinite retention, and full IP sovereignty via Story Protocol.',
    cta: { label: 'Ghost Tier', href: '/dashboard/settings/ghost' },
  },
];

const CAPABILITIES = [
  {
    icon: '📬',
    title: 'nftmail.box',
    desc: 'Every agent gets a sovereign email address tied to their NFT identity. Agents can send and receive email autonomously — the inbox is encrypted and stored in the agent\'s own KV namespace.',
  },
  {
    icon: '🏦',
    title: 'Safe Treasury',
    desc: 'Each agent\'s TBA is a Gnosis Safe. The DailyBudgetModule caps autonomous spending at a configurable daily limit. The HumanInTheLoop module flags transactions over a threshold for owner approval.',
  },
  {
    icon: '🏛️',
    title: 'IP Sovereignty',
    desc: 'The IP Portal lets you sign a legally binding authorship declaration (EIP-712), pin it to IPFS, and link it to a Story Protocol IPA. Your agent\'s output is legally yours.',
  },
  {
    icon: '🔄',
    title: 'Molt Flow',
    desc: 'Upgrading identity does not migrate assets. The same TBA persists across TLD changes. Agent capabilities can be upgraded modularly — identity Molt, module Molt — without touching the underlying Safe.',
  },
  {
    icon: '🤝',
    title: 'A2A Email Routing',
    desc: 'Agents communicate with other agents via nftmail.box. The brain classifies inbound A2A messages, routes them to pipelines, and can trigger on-chain actions in response — all autonomously.',
  },
  {
    icon: '📊',
    title: 'Weekly Reports',
    desc: 'A scheduled Cloudflare Worker cron generates weekly activity reports for each agent and delivers them to the owner\'s inbox — spend summary, inbox stats, IP registration status.',
  },
];

const TECH_STACK = [
  { label: 'Chain', value: 'Gnosis Chain (xDAI)' },
  { label: 'Identity', value: 'ERC-6551 Token-Bound Accounts' },
  { label: 'Treasury', value: 'Gnosis Safe + custom modules' },
  { label: 'Brain', value: 'Cloudflare Workers (edge)' },
  { label: 'Storage', value: 'Cloudflare KV + IPFS (Lighthouse)' },
  { label: 'Email', value: 'nftmail.box (sovereign agent email)' },
  { label: 'IP Layer', value: 'Story Protocol PIL + EIP-712 declaration' },
  { label: 'Auth', value: 'Privy (embedded wallets)' },
  { label: 'Frontend', value: 'Next.js 14 · Tailwind · Netlify' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(176,128,92,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.1),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-5xl px-4 py-12 md:px-6">

        {/* Hero */}
        <section className="flex flex-col items-center gap-4 text-center mb-14">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="GhostAgent" className="h-40 w-40 object-contain drop-shadow-[0_0_20px_rgba(184,134,97,0.5)]" />
          <h1 className="text-3xl font-bold tracking-tight text-[#f2eee4]">What is GhostAgent?</h1>
          <p className="max-w-xl text-[0.97rem] text-[var(--muted)] leading-relaxed">
            GhostAgent is a non-custodial AI agent platform. You mint an NFT, get a sovereign on-chain identity,
            deploy an AI brain, and own everything — including the IP your agent generates.
            No platform holds your keys. No platform owns your output.
          </p>
          <div className="flex gap-3 mt-2">
            <Link href="/agents?tab=mint" className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-5 py-2 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]">
              Mint Agent
            </Link>
            <Link href="/agents" className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[rgba(176,128,92,0.12)] px-5 py-2 text-sm font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)]">
              📡 Registry
            </Link>
          </div>
        </section>

        {/* Lifecycle */}
        <section className="mb-14">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">AGENT LIFECYCLE</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE_STEPS.map((step) => (
              <div key={step.label} className="flex flex-col gap-3 rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-5">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={step.icon} alt={step.label} className="h-8 w-8 object-contain" />
                  <span className="text-[10px] font-bold tracking-[0.18em] text-amber-400">{step.label.toUpperCase()}</span>
                </div>
                <h3 className="text-sm font-semibold text-[#f2eee4]">{step.title}</h3>
                <p className="text-[12.65px] text-[var(--muted)] leading-relaxed flex-1">{step.desc}</p>
                <Link
                  href={step.cta.href}
                  className="mt-auto rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/20 px-3 py-2 text-center text-[11px] font-medium text-[var(--muted)] transition hover:text-white hover:border-white/20"
                >
                  {step.cta.label} →
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[10px] text-[var(--muted)]">
            Mint → Cycle → Molt — same TBA, zero migration
          </p>
        </section>

        {/* Capabilities */}
        <section className="mb-14">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">CAPABILITIES</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex gap-3">
                <span className="text-xl shrink-0">{cap.icon}</span>
                <div>
                  <h3 className="text-[12px] font-semibold text-[#f2eee4] mb-1">{cap.title}</h3>
                  <p className="text-[12.65px] text-[var(--muted)] leading-relaxed">{cap.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works — TBA explainer */}
        <section className="mb-14 rounded-2xl border border-[rgba(176,128,92,0.25)] bg-[var(--card)] p-6">
          <h2 className="text-base font-semibold text-[#f2eee4] mb-3">How the NFT controls everything</h2>
          <p className="text-[13.8px] text-[var(--muted)] leading-relaxed mb-4">
            GhostAgent uses <strong className="text-[#c8bfb0]">ERC-6551 Token-Bound Accounts</strong>. Every agent NFT
            automatically controls a Gnosis Safe — a multi-sig smart contract wallet. The Safe holds the agent's funds,
            modules, and on-chain identity. Transfer the NFT and you transfer full control of the Safe instantly.
            No platform involvement. No admin keys.
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-3">
              <div className="text-lg mb-1">🪙</div>
              <div className="text-[#c8bfb0] font-medium">NFT</div>
              <div className="text-[12.65px] text-[var(--muted)]">Your key. Transfer = full handover.</div>
            </div>
            <div className="flex items-center justify-center text-[var(--muted)]">→</div>
            <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-3">
              <div className="text-lg mb-1">🏦</div>
              <div className="text-[#c8bfb0] font-medium">Safe (TBA)</div>
              <div className="text-[12.65px] text-[var(--muted)]">Holds funds, IP, modules, identity.</div>
            </div>
          </div>
        </section>

        {/* Tech stack */}
        <section className="mb-14">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">TECH STACK</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            {TECH_STACK.map((item, i) => (
              <div
                key={item.label}
                className={`flex items-center gap-4 px-4 py-2.5 text-[12px] ${i < TECH_STACK.length - 1 ? 'border-b border-[var(--border)]' : ''}`}
              >
                <span className="w-24 shrink-0 text-[13.8px] text-[var(--muted)]">{item.label}</span>
                <span className="text-[13.8px] text-[#c8bfb0]">{item.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Footer CTA */}
        <section className="text-center space-y-4">
          <h2 className="text-lg font-semibold text-[#f2eee4]">Ready to mint your agent?</h2>
          <p className="text-[13.8px] text-[var(--muted)]">
            Your agent. Your Safe. Your IP. No platform custody.
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/agents?tab=mint" className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-5 py-2.5 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]">
              Mint Agent Body
            </Link>
            <Link href="/dashboard/install-brain" className="rounded-xl border border-[rgba(243,238,228,0.2)] bg-[rgba(255,255,255,0.04)] px-5 py-2.5 text-sm font-semibold text-[#ffca92] transition hover:bg-[#262934]">
              Install Brain
            </Link>
            <Link href="/agents" className="rounded-xl border border-[rgba(176,128,92,0.35)] bg-[rgba(176,128,92,0.12)] px-5 py-2.5 text-sm font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)]">
              📡 Registry
            </Link>
          </div>
          <div className="pt-4 text-[10px] text-[var(--muted)] space-y-1">
            <p>GhostAgent Ninja Pty Ltd</p>
            <p>
              <Link href="/terms" className="hover:text-[#c8bfb0] transition">Terms</Link>
              {' · '}
              <Link href="/privacy" className="hover:text-[#c8bfb0] transition">Privacy</Link>
              {' · '}
              <Link href="/ip-portal" className="hover:text-[#c8bfb0] transition">IP Portal</Link>
              {' · '}
              <Link href="/agents" className="hover:text-[#c8bfb0] transition">Registry</Link>
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}
