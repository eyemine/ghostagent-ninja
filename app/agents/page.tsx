'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useWallets } from '@privy-io/react-auth';
import { DomainCard, Domain } from '../components/DomainCard';
import { useNameCheck, NameStatusBadge } from '../utils/ensCheck';

const GHOST_LOGO = '/ghost-logo.png';
const PAGE_SIZE = 20;

const SLD_COLORS: Record<string, string> = {
  'agent.gno':    'text-blue-300 bg-blue-500/10 ring-blue-500/20',
  'openclaw.gno': 'text-rose-300 bg-rose-500/10 ring-rose-500/20',
  'molt.gno':     'text-violet-300 bg-violet-500/10 ring-violet-500/20',
  'picoclaw.gno': 'text-amber-300 bg-amber-500/10 ring-amber-500/20',
  'vault.gno':    'text-emerald-300 bg-emerald-500/10 ring-emerald-500/20',
  'nftmail.gno':  'text-cyan-300 bg-cyan-500/10 ring-cyan-500/20',
};

interface RegistryEntry {
  name: string;
  tld: string | null;
  profileUrl: string;
  agentCardUrl: string;
  erc8004: {
    gnosis?:      { agentId: number };
    base?:        { agentId: number };
    baseSepolia?: { agentId: number };
  };
}

const COMPANY_REPO = 'eyemine/ghostagent-ninja';
const AGENTS_MD_BASE = `https://github.com/${COMPANY_REPO}/blob/main/agents`;

function InstallBanner() {
  const [copied, setCopied] = useState(false);
  const cmd = `npx companies.sh add ${COMPANY_REPO}`;
  function copy() {
    navigator.clipboard.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[rgba(176,128,92,0.06)] px-4 py-3 text-xs">
      <span className="shrink-0 rounded-full bg-[rgba(176,128,92,0.15)] px-2 py-0.5 text-[9px] font-bold tracking-wider text-[#b0805c] ring-1 ring-[rgba(176,128,92,0.25)]">
        COMPANIES.SH
      </span>
      <span className="text-[var(--muted)]">Agent Companies package — importable by any runtime</span>
      <div className="ml-auto flex items-center gap-2">
        <code className="rounded-md border border-[rgba(176,128,92,0.2)] bg-black/30 px-2.5 py-1 font-mono text-[10px] text-[#f2eee4]">
          {cmd}
        </code>
        <button
          onClick={copy}
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.25)] bg-[rgba(176,128,92,0.1)] px-2.5 py-1 text-[10px] font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <a
          href={`https://github.com/${COMPANY_REPO}/blob/main/COMPANY.md`}
          target="_blank" rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-[rgba(176,128,92,0.25)] bg-[rgba(176,128,92,0.1)] px-2.5 py-1 text-[10px] font-semibold text-[#b0805c] transition hover:bg-[rgba(176,128,92,0.18)]"
        >
          COMPANY.md ↗
        </a>
      </div>
    </div>
  );
}

function RegistryTab() {
  const [agents, setAgents]     = useState<RegistryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [sldFilter, setSldFilter] = useState('all');
  const [page, setPage]         = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch('/api/agents')
      .then(r => r.json())
      .then(data => { setAgents(data.agents ?? []); setLoading(false); })
      .catch(() => { setError('Failed to load registry'); setLoading(false); });
  }, []);

  const tlds = ['all', ...Array.from(new Set(agents.map(a => a.tld).filter(Boolean) as string[])).sort()];

  const filtered = agents.filter(a => {
    if (sldFilter !== 'all' && a.tld !== sldFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageAgents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const reset = useCallback(() => setPage(0), []);

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[rgba(176,128,92,0.3)] border-t-[rgba(176,128,92,0.9)]" />
    </div>
  );
  if (error) return <p className="py-10 text-center text-sm text-rose-400">{error}</p>;

  return (
    <div className="space-y-4">
      <InstallBanner />

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); reset(); }}
          placeholder="Search agents…"
          className="min-w-0 flex-1 bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-zinc-600"
        />
        <div className="mx-2 h-4 w-px bg-[var(--border)]" />
        <div className="flex flex-wrap gap-1">
          {tlds.map(t => (
            <button
              key={t}
              onClick={() => { setSldFilter(t); reset(); }}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition ${
                sldFilter === t
                  ? 'bg-[rgba(176,128,92,0.2)] text-[#f2eee4]'
                  : 'text-[var(--muted)] hover:text-[#f2eee4]'
              }`}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--muted)]">
          {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {pageAgents.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--muted)]">No agents match.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-2.5 text-left text-[9px] font-semibold tracking-wider text-[var(--muted)]">AGENT</th>
                <th className="px-4 py-2.5 text-left text-[9px] font-semibold tracking-wider text-[var(--muted)]">NAMESPACE</th>
                <th className="hidden px-4 py-2.5 text-left text-[9px] font-semibold tracking-wider text-[var(--muted)] sm:table-cell">ERC-8004</th>
                <th className="px-4 py-2.5 text-right text-[9px] font-semibold tracking-wider text-[var(--muted)]">PROFILE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--card)]/60">
              {pageAgents.map((a, i) => {
                const tldKey = a.tld ?? '';
                const colors = SLD_COLORS[tldKey] ?? 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20';
                const chains = Object.keys(a.erc8004 ?? {});
                return (
                  <tr key={i} className="hover:bg-white/[0.02] transition">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/sld-images/${tldKey.split('.')[0] || 'agent'}.png`}
                          alt=""
                          className="h-6 w-6 rounded-md object-cover shrink-0"
                        />
                        <span className="font-medium text-[#f2eee4]">{a.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {tldKey && (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${colors}`}>
                          {tldKey}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {chains.length === 0 ? (
                          <span className="text-zinc-600">—</span>
                        ) : chains.map(c => {
                          const chainColors: Record<string, string> = {
                            gnosis:      'text-violet-300 bg-violet-500/10 ring-violet-500/20',
                            base:        'text-blue-300 bg-blue-500/10 ring-blue-500/20',
                            baseSepolia: 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20',
                          };
                          const clr = chainColors[c] ?? 'text-zinc-400 bg-zinc-500/10 ring-zinc-500/20';
                          const aid = (a.erc8004 as Record<string, { agentId: number }>)[c]?.agentId;
                          return (
                            <a key={c}
                              href={`https://notapaperclip.red/erc8004?agent=${encodeURIComponent(a.name)}`}
                              target="_blank" rel="noopener noreferrer"
                              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 hover:brightness-125 ${clr}`}>
                              {c}{aid ? ` #${aid}` : ''}
                            </a>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <a
                          href={`${AGENTS_MD_BASE}/${a.name}/AGENTS.md`}
                          target="_blank" rel="noopener noreferrer"
                          className="rounded-lg border border-[rgba(176,128,92,0.15)] bg-black/10 px-2 py-1 text-[9px] font-medium text-[var(--muted)] transition hover:text-[#b0805c]"
                          title="View AGENTS.md spec"
                        >
                          AGENTS.md
                        </a>
                        <Link
                          href={`/agent/${a.name}`}
                          className="rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/20 px-2.5 py-1 text-[10px] font-medium text-[var(--muted)] transition hover:text-white"
                        >
                          View →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1 text-xs text-[var(--muted)]">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-white disabled:opacity-30"
          >
            ← Prev
          </button>
          <span>Page {page + 1} of {totalPages}</span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-white disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const DOMAINS: Domain[] = [
  {
    id: 'agent',
    label: 'Agent',
    tld: 'agent.gno',
    tagline: 'Full agent identity with cycle path',
    mintFee: 10,
    moltFee: 2,
    evolvePath: 'imago/ghost',
    privacyDefault: 'private',
    decayDays: 8,
    canEvolve: true,
    color: 'amber',
    accentBg: 'bg-[rgba(176,128,92,0.12)]',
    accentRing: 'ring-[rgba(176,128,92,0.25)]',
    accentText: 'text-[#b0805c]',
    description:
      'Pupa → Imago cycle path (+8 xDAI, then +24 xDAI/yr). 8-day history. Private by default. $10 $HOST staking for 365-day persistence. 10 xDAI mint or molt from Larva · 2 xDAI molt from Pupa. Bundled *.creation.ip + nftmail.box address.',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    tld: 'openclaw.gno',
    tagline: 'Full agent with on-chain IP',
    mintFee: 10,
    moltFee: 2,
    evolvePath: 'imago/ghost',
    privacyDefault: 'private',
    decayDays: 8,
    canEvolve: true,
    color: 'cyan',
    accentBg: 'bg-cyan-500/10',
    accentRing: 'ring-cyan-500/20',
    accentText: 'text-cyan-300',
    description:
      'Full-featured agent namespace. Private by default. Earns $HOST reputation. Can list on the Marketplace.',
  },
  {
    id: 'molt',
    label: 'Molt',
    tld: 'molt.gno',
    tagline: '#BuildInPublic / Public email audit trail',
    mintFee: 'free',
    moltFee: 'free',
    evolvePath: null,
    privacyDefault: 'glassbox',
    decayDays: 30,
    canEvolve: true,
    color: 'fuchsia',
    accentBg: 'bg-fuchsia-500/10',
    accentRing: 'ring-fuchsia-500/20',
    accentText: 'text-fuchsia-300',
    description:
      'Glassbox by default — all work is publicly verifiable. Public conversations (any OTP comm. protected) + Story Protocol .moltbook.ip IP registration. 30-day history.',
  },
  {
    id: 'picoclaw',
    label: 'PicoClaw',
    tld: 'picoclaw.gno',
    tagline: 'Larva agent — zero cost entry',
    mintFee: 'free',
    moltFee: 'free',
    evolvePath: null,
    privacyDefault: 'private',
    decayDays: 8,
    canEvolve: false,
    color: 'amber',
    accentBg: 'bg-amber-500/10',
    accentRing: 'ring-amber-500/20',
    accentText: 'text-amber-300',
    description:
      'The free on-ramp. Mint a larva agent with no fees, explore the ecosystem. 8-day inbox history window on free tier.',
  },
  {
    id: 'vault',
    label: 'Vault',
    tld: 'vault.gno',
    tagline: 'Pro agent with persistent storage',
    mintFee: 24,
    moltFee: 14,
    evolvePath: 'ghost',
    privacyDefault: 'private',
    decayDays: null,
    canEvolve: true,
    color: 'emerald',
    accentBg: 'bg-emerald-500/10',
    accentRing: 'ring-emerald-500/20',
    accentText: 'text-emerald-300',
    description:
      'Top-tier namespace. Private by default, persistent storage, IP protection on Story Protocol, and full $HOST earning. 24 xDAI includes 1 year subscription, then 24 xDAI annually.',
  },
  {
    id: 'nftmail',
    label: 'NFTmail',
    tld: 'nftmail.gno',
    tagline: 'Identity firewall for your inbox',
    mintFee: 2,
    moltFee: 10,
    evolvePath: 'imago/ghost',
    privacyDefault: 'private',
    decayDays: 30,
    canEvolve: true,
    color: 'rose',
    accentBg: 'bg-rose-500/10',
    accentRing: 'ring-rose-500/20',
    accentText: 'text-rose-300',
    description:
      'NFT-gated encrypted inbox. Your NFT is your key — transfer it to transfer access. No custodian, no middleman. Pairs with nftmail.box addresses.',
  },
];

type FilterFee = 'all' | 'free' | 'paid';
type FilterPrivacy = 'all' | 'glassbox' | 'private';
type FilterEvolve = 'all' | 'can-evolve' | 'larva-only';

function MintModal({ domain, onClose }: { domain: Domain; onClose: () => void }) {
  const [name, setName] = useState('');
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? '';
  const mintLabel = domain.mintFee === 'free' ? 'Free' : `${domain.mintFee} xDAI`;
  const nameStatus = useNameCheck(name, domain.tld, connectedWallet);
  const canMint = name.length >= 3 &&
    (nameStatus.state === 'available' || nameStatus.state === 'yours');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#f2eee4]">
              Mint on <span className={domain.accentText}>.{domain.tld}</span>
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{domain.tagline}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/5 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Fee summary */}
        <div className="mb-5 grid grid-cols-3 gap-2">
          {[
            { label: 'MINT FEE', value: mintLabel, highlight: domain.mintFee === 'free' },
            { label: 'HISTORY', value: domain.decayDays ? `${domain.decayDays}d` : 'Persistent', highlight: !domain.decayDays },
            { label: 'CYCLE TO', value: domain.evolvePath ?? '—', highlight: !!domain.evolvePath },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-center">
              <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">{label}</div>
              <div className={`mt-0.5 text-xs font-semibold ${highlight ? domain.accentText : 'text-zinc-500'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Name input */}
        <label className="mb-1.5 block text-xs font-semibold text-[var(--muted)]">
          AGENT NAME
        </label>
        <div className="flex items-center rounded-xl border border-[var(--border)] bg-black/30 px-3 py-2.5 focus-within:border-[rgba(255,255,255,0.2)]">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="your-agent"
            className="flex-1 bg-transparent text-sm text-[#f2eee4] outline-none placeholder:text-zinc-600"
          />
          <span className={`shrink-0 text-xs font-medium ${domain.accentText}`}>.{domain.tld}</span>
        </div>

        {/* Availability status */}
        <NameStatusBadge status={nameStatus} label={name} tld={domain.tld} />

        {/* Privacy notice */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span className="text-[10px] text-[var(--muted)]">
            Privacy default: <span className="text-[#f2eee4]">{domain.privacyDefault === 'glassbox' ? 'Glassbox (public)' : 'Private (encrypted)'}</span>.
            Zero lock-in — transfer or burn your NFT at any time.
          </span>
        </div>

        {/* Actions */}
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-[var(--border)] bg-black/20 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:text-white"
          >
            Cancel
          </button>
          <button
            disabled={!canMint}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-40 ${domain.accentBg} ${domain.accentText} ring-1 ${domain.accentRing} hover:brightness-125`}
          >
            {nameStatus.state === 'checking' ? 'Checking…' : domain.mintFee === 'free' ? 'Mint Free' : `Mint for ${domain.mintFee} xDAI`}
          </button>
        </div>
      </div>
    </div>
  );
}

type PageTab = 'domains' | 'registry';

export default function AgentsPage() {
  const [pageTab, setPageTab]       = useState<PageTab>('registry');
  const [filterFee, setFilterFee]   = useState<FilterFee>('all');
  const [filterPrivacy, setFilterPrivacy] = useState<FilterPrivacy>('all');
  const [filterEvolve, setFilterEvolve]   = useState<FilterEvolve>('all');
  const [mintTarget, setMintTarget] = useState<Domain | null>(null);

  const filtered = DOMAINS.filter((d) => {
    if (filterFee === 'free' && d.mintFee !== 'free') return false;
    if (filterFee === 'paid' && d.mintFee === 'free') return false;
    if (filterPrivacy === 'glassbox' && d.privacyDefault !== 'glassbox') return false;
    if (filterPrivacy === 'private' && d.privacyDefault !== 'private') return false;
    if (filterEvolve === 'can-evolve' && !d.canEvolve) return false;
    if (filterEvolve === 'larva-only' && d.canEvolve) return false;
    return true;
  });

  function FilterBtn<T extends string>({
    value,
    current,
    set,
    label,
  }: {
    value: T;
    current: T;
    set: (v: T) => void;
    label: string;
  }) {
    const active = value === current;
    return (
      <button
        onClick={() => set(value)}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          active
            ? 'bg-[rgba(176,128,92,0.25)] text-[#f2eee4]'
            : 'text-[#b0805c] hover:bg-[rgba(176,128,92,0.1)]'
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      {mintTarget && (
        <MintModal domain={mintTarget} onClose={() => setMintTarget(null)} />
      )}

      <div className="min-h-screen bg-[var(--background)] pt-14">
        <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">

          {/* Header */}
          <div className="mb-6 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={GHOST_LOGO} alt="GhostAgent" className="h-20 w-20 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
            <div>
              <h1 className="text-2xl font-bold text-[#f2eee4]">Agent Namespaces</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                6 namespaces · zero lock-in · transfer or burn your NFT at any time
              </p>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="mb-6 flex gap-1 rounded-xl border border-[rgba(176,128,92,0.15)] bg-[var(--card)] p-1">
            {(['domains', 'registry'] as const).map(t => (
              <button
                key={t}
                onClick={() => setPageTab(t)}
                className={`flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  pageTab === t
                    ? 'bg-[rgba(176,128,92,0.18)] text-[#f2eee4]'
                    : 'text-[var(--muted)] hover:text-[#f2eee4]'
                }`}
              >
                {t === 'domains' ? '🗂 Domain Catalogue' : '📡 Agent Registry'}
              </button>
            ))}
          </div>

          {/* ── Registry tab ── */}
          {pageTab === 'registry' && <RegistryTab />}

          {/* ── Domains tab ── */}
          {pageTab === 'domains' && <>
          {/* Filters */}
          <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span className="mr-1 text-[10px] font-semibold tracking-wider text-[var(--muted)]">FEE</span>
            <FilterBtn value="all" current={filterFee} set={setFilterFee} label="All" />
            <FilterBtn value="free" current={filterFee} set={setFilterFee} label="Free" />
            <FilterBtn value="paid" current={filterFee} set={setFilterFee} label="Paid" />

            <div className="mx-2 h-4 w-px bg-[var(--border)]" />

            <span className="mr-1 text-[10px] font-semibold tracking-wider text-[var(--muted)]">PRIVACY</span>
            <FilterBtn value="all" current={filterPrivacy} set={setFilterPrivacy} label="All" />
            <FilterBtn value="glassbox" current={filterPrivacy} set={setFilterPrivacy} label="Glassbox" />
            <FilterBtn value="private" current={filterPrivacy} set={setFilterPrivacy} label="Private" />

            <div className="mx-2 h-4 w-px bg-[var(--border)]" />

            <span className="mr-1 text-[10px] font-semibold tracking-wider text-[var(--muted)]">CYCLE</span>
            <FilterBtn value="all" current={filterEvolve} set={setFilterEvolve} label="All" />
            <FilterBtn value="can-evolve" current={filterEvolve} set={setFilterEvolve} label="Can Cycle" />
            <FilterBtn value="larva-only" current={filterEvolve} set={setFilterEvolve} label="Larva-only" />
          </div>

          {/* Domain grid */}
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-12 text-center text-sm text-[var(--muted)]">
              No domains match these filters.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((domain) => (
                <DomainCard key={domain.id} domain={domain} onMint={setMintTarget} />
              ))}
            </div>
          )}

          {/* Zero lock-in footer */}
          <p className="mt-8 text-center text-[10px] text-[var(--muted)]">
            All agent NFTs are non-custodial · transfer = transfer control · burn = destroy identity
          </p>
          </>}

        </div>
      </div>
    </>
  );
}
