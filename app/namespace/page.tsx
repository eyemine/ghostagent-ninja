'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import type { AgentRegistryEntry } from '../api/agents/route';

// ── TLD metadata ──────────────────────────────────────────────────────────────
const TLD_META: Record<string, { label: string; color: string; bg: string; ring: string; icon: string }> = {
  'agent.gno':    { label: 'agent.gno',    color: 'text-sky-300',     bg: 'bg-sky-500/10',     ring: 'ring-sky-500/25',     icon: '🤖' },
  'molt.gno':     { label: 'molt.gno',     color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', ring: 'ring-fuchsia-500/25', icon: '🐚' },
  'nftmail.gno':  { label: 'nftmail.gno',  color: 'text-amber-300',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/25',   icon: '✉️' },
  'openclaw.gno': { label: 'openclaw.gno', color: 'text-cyan-300',    bg: 'bg-cyan-500/10',    ring: 'ring-cyan-500/25',    icon: '🦞' },
  'picoclaw.gno': { label: 'picoclaw.gno', color: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/25', icon: '🌱' },
  'vault.gno':    { label: 'vault.gno',    color: 'text-violet-300',  bg: 'bg-violet-500/10',  ring: 'ring-violet-500/25',  icon: '🔐' },
};

const ALL_TLDS = Object.keys(TLD_META);

function tldMeta(tld: string | null) {
  if (!tld) return { label: 'unknown', color: 'text-zinc-400', bg: 'bg-zinc-500/10', ring: 'ring-zinc-500/20', icon: '👾' };
  return TLD_META[tld] ?? { label: tld, color: 'text-zinc-400', bg: 'bg-zinc-500/10', ring: 'ring-zinc-500/20', icon: '👾' };
}

function hasErc8004(entry: AgentRegistryEntry) {
  return Object.keys(entry.erc8004 ?? {}).length > 0;
}

function SubnameBadge({ tld }: { tld: string | null }) {
  const m = tldMeta(tld);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${m.color} ${m.bg} ${m.ring}`}>
      {m.icon} {m.label}
    </span>
  );
}

function ChainDots({ erc8004 }: { erc8004: AgentRegistryEntry['erc8004'] }) {
  const chains = [
    erc8004?.gnosis      && { label: 'GNO', color: 'bg-emerald-400' },
    erc8004?.base        && { label: 'BASE', color: 'bg-blue-400' },
    erc8004?.baseSepolia && { label: 'SEP', color: 'bg-zinc-500' },
  ].filter(Boolean) as { label: string; color: string }[];

  if (chains.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {chains.map(c => (
        <span key={c.label} className={`h-1.5 w-1.5 rounded-full ${c.color}`} title={c.label} />
      ))}
    </div>
  );
}

function AgentBeaconCard({ entry }: { entry: AgentRegistryEntry }) {
  const m = tldMeta(entry.tld);
  const subname = entry.tld ? `${entry.name}.${entry.tld}` : entry.name;

  return (
    <Link
      href={entry.profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-black/30 p-4 transition-all hover:border-[rgba(176,128,92,0.4)] hover:bg-black/50"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="truncate font-mono text-xs font-semibold text-[#f2eee4]">
            {subname}
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {entry.name}_@nftmail.box
          </span>
        </div>
        <ChainDots erc8004={entry.erc8004} />
      </div>

      {/* TLD badge */}
      <div className="flex items-center gap-2">
        <SubnameBadge tld={entry.tld} />
        {hasErc8004(entry) && (
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
            ERC-8004 ✓
          </span>
        )}
      </div>

      {/* ERC-8004 agent IDs */}
      {hasErc8004(entry) && (
        <div className="flex flex-wrap gap-1">
          {entry.erc8004?.gnosis && (
            <span className="font-mono text-[9px] text-zinc-500">
              gno#{entry.erc8004.gnosis.agentId}
            </span>
          )}
          {entry.erc8004?.base && (
            <span className="font-mono text-[9px] text-zinc-500">
              base#{entry.erc8004.base.agentId}
            </span>
          )}
        </div>
      )}

      {/* Arrow */}
      <div className="mt-auto flex items-center justify-end">
        <span className="text-[10px] text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100">
          View agent ↗
        </span>
      </div>
    </Link>
  );
}

type SortKey = 'name' | 'tld' | 'erc8004';

export default function NamespacePage() {
  const [entries, setEntries] = useState<AgentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tldFilter, setTldFilter] = useState<string>('all');
  const [erc8004Filter, setErc8004Filter] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then((data: { agents: AgentRegistryEntry[]; total: number }) => {
        setEntries(data.agents ?? []);
      })
      .catch(e => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const tldCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    for (const e of entries) {
      const t = e.tld ?? 'unknown';
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (tldFilter !== 'all') list = list.filter(e => e.tld === tldFilter);
    if (erc8004Filter) list = list.filter(e => hasErc8004(e));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || (e.tld ?? '').includes(q));
    }
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'tld')  list = [...list].sort((a, b) => (a.tld ?? '').localeCompare(b.tld ?? ''));
    if (sort === 'erc8004') list = [...list].sort((a, b) => Number(hasErc8004(b)) - Number(hasErc8004(a)));
    return list;
  }, [entries, tldFilter, erc8004Filter, search, sort]);

  const erc8004Count = entries.filter(hasErc8004).length;

  return (
    <div className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🗺️</span>
            <h1 className="text-xl font-semibold text-[#f2eee4]" style={{ fontFamily: 'Ayuthaya, monospace' }}>
              Namespace Gallery
            </h1>
          </div>
          <p className="text-sm text-[var(--muted)] max-w-xl">
            Every agent beacon and nftmail account minted under GhostAgent's <span className="text-[#b0805c] font-mono">*.gno</span> SLDs.
            Subnames are permanent — sovereignty is tied to the parent domain.
          </p>

          {/* SLD ownership strip */}
          <div className="mt-4 flex flex-wrap gap-2">
            {ALL_TLDS.map(tld => {
              const m = TLD_META[tld];
              return (
                <span key={tld} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-mono font-semibold ring-1 ${m.color} ${m.bg} ${m.ring}`}>
                  {m.icon} {m.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        {!loading && !error && (
          <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {[
              { label: 'Total', value: entries.length, color: 'text-[#f2eee4]' },
              { label: 'ERC-8004', value: erc8004Count, color: 'text-emerald-300' },
              ...ALL_TLDS.map(tld => ({
                label: TLD_META[tld].icon + ' ' + tld.replace('.gno', ''),
                value: tldCounts[tld] ?? 0,
                color: TLD_META[tld].color,
              })),
            ].map(s => (
              <div key={s.label} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--muted)]">{s.label}</div>
                <div className={`mt-0.5 text-base font-bold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search name or TLD…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-black/30 px-3 text-xs text-[#f2eee4] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[rgba(176,128,92,0.5)] w-48"
          />

          {/* TLD filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {['all', ...ALL_TLDS].map(tld => {
              const active = tldFilter === tld;
              const m = tld === 'all' ? null : TLD_META[tld];
              return (
                <button
                  key={tld}
                  onClick={() => setTldFilter(tld)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 transition-all ${
                    active
                      ? (m ? `${m.color} ${m.bg} ${m.ring}` : 'text-[#b0805c] bg-[rgba(176,128,92,0.15)] ring-[rgba(176,128,92,0.3)]')
                      : 'text-[var(--muted)] bg-transparent ring-[var(--border)] hover:text-[#f2eee4]'
                  }`}
                >
                  {tld === 'all' ? `All (${tldCounts.all ?? 0})` : `${m!.icon} ${tld.replace('.gno', '')} (${tldCounts[tld] ?? 0})`}
                </button>
              );
            })}
          </div>

          {/* ERC-8004 filter */}
          <button
            onClick={() => setErc8004Filter(f => !f)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 transition-all ${
              erc8004Filter
                ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25'
                : 'text-[var(--muted)] bg-transparent ring-[var(--border)] hover:text-[#f2eee4]'
            }`}
          >
            ERC-8004 only
          </button>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="h-8 rounded-lg border border-[var(--border)] bg-black/30 px-2 text-[10px] text-[var(--muted)] focus:outline-none"
          >
            <option value="name">Sort: Name</option>
            <option value="tld">Sort: TLD</option>
            <option value="erc8004">Sort: ERC-8004 first</option>
          </select>

          {/* Results count */}
          <span className="ml-auto text-[10px] text-[var(--muted)]">
            {filtered.length} subnames
          </span>
        </div>

        {/* Gallery grid */}
        {loading && (
          <div className="flex items-center justify-center py-24 text-[var(--muted)] text-sm">
            Loading namespace…
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center text-sm text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-[var(--muted)]">
            <span className="text-3xl">🫙</span>
            <span className="text-sm">No agents match this filter</span>
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map(entry => (
              <AgentBeaconCard key={entry.name} entry={entry} />
            ))}
          </div>
        )}

        {/* Footer note */}
        {!loading && !error && (
          <p className="mt-8 text-center text-[10px] text-[var(--muted)]">
            Subnames are permanent on-chain. Resolution validity is linked to parent SLD ownership.{' '}
            <Link href="/docs" className="text-[#b0805c] hover:underline">Learn more →</Link>
          </p>
        )}

      </div>
    </div>
  );
}
