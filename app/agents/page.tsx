'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import MintTab from './MintTab';

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

type PageTab = 'mint' | 'registry';

export default function AgentsPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'mint' ? 'mint' : 'registry';
  const [pageTab, setPageTab] = useState<PageTab>(initialTab);

  return (
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
          {(['mint', 'registry'] as const).map(t => (
            <button
              key={t}
              onClick={() => setPageTab(t)}
              className={`flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                pageTab === t
                  ? 'bg-[rgba(176,128,92,0.18)] text-[#f2eee4]'
                  : 'text-[var(--muted)] hover:text-[#f2eee4]'
              }`}
            >
              {t === 'mint' ? '🗂 Mint Agent' : '📡 Agent Registry'}
            </button>
          ))}
        </div>

        {/* ── Registry tab ── */}
        {pageTab === 'registry' && <RegistryTab />}

        {/* ── Mint tab ── */}
        {pageTab === 'mint' && <MintTab />}

      </div>
    </div>
  );
}
