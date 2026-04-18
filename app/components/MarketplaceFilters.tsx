'use client';

export type DomainFilter  = 'all' | 'agent.gno' | 'openclaw.gno' | 'molt.gno' | 'picoclaw.gno' | 'vault.gno' | 'nftmail.gno';
export type LevelFilter   = 'all' | 'larva' | 'pupa' | 'imago' | 'ghost';
export type PrivacyFilter = 'all' | 'glassbox' | 'private';
export type TypeFilter    = 'all' | 'service' | 'body' | 'bundle';
export type CatFilter     = 'all' | 'data' | 'defi' | 'social' | 'content';

export interface Filters {
  type:    TypeFilter;
  cat:     CatFilter;
  domain:  DomainFilter;
  level:   LevelFilter;
  privacy: PrivacyFilter;
}

interface MarketplaceFiltersProps {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  counts: {
    total: number;
    filtered: number;
  };
}

const pill = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
    active
      ? 'bg-[rgba(176,128,92,0.18)] text-[#b0805c]'
      : 'text-[var(--muted)] hover:text-[#f2eee4]'
  }`;

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
  { value: 'all',     label: 'All' },
  { value: 'service', label: 'Hire' },
  { value: 'body',    label: 'Agent Bodies' },
  { value: 'bundle',  label: 'Bundles' },
];

const DOMAIN_TABS: { value: DomainFilter; label: string; color: string }[] = [
  { value: 'all',          label: 'All domains',    color: 'text-[var(--muted)]' },
  { value: 'agent.gno',    label: 'agent.gno',      color: 'text-blue-300' },
  { value: 'openclaw.gno', label: 'openclaw.gno',   color: 'text-rose-300' },
  { value: 'molt.gno',     label: 'molt.gno',       color: 'text-violet-300' },
  { value: 'picoclaw.gno', label: 'picoclaw.gno',   color: 'text-amber-300' },
  { value: 'vault.gno',    label: 'vault.gno',      color: 'text-emerald-300' },
  { value: 'nftmail.gno',  label: 'nftmail.gno',    color: 'text-cyan-300' },
];

const LEVEL_TABS: { value: LevelFilter; label: string; icon: string }[] = [
  { value: 'all',   label: 'Any level', icon: '' },
  { value: 'larva', label: 'Larva', icon: 'https://cloudflare-ipfs.com/ipfs/bafkreicekhu7rr7noqtv2t4sivy5mqncqgbqnf6cq63dfqyvi5klgk7bv4' },
  { value: 'pupa',  label: 'Pupa',  icon: 'https://cloudflare-ipfs.com/ipfs/bafkreihajbm2nwtuwp4hsgputfqintlw7zxbz4jbpx772ur3rfvfhwadge' },
  { value: 'imago', label: 'Imago', icon: 'https://cloudflare-ipfs.com/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u' },
  { value: 'ghost', label: 'Ghost', icon: 'https://cloudflare-ipfs.com/ipfs/bafkreifjrzcptcss7qvdzpphjdvupmfhizjejqyswycrofjlm72tfi43hq' },
];

const PRIVACY_TABS: { value: PrivacyFilter; label: string }[] = [
  { value: 'all',       label: 'Any privacy' },
  { value: 'glassbox',  label: '🔍 Glass Box' },
  { value: 'private',   label: '🔒 Private' },
];

const Divider = () => (
  <div className="mx-1 w-px self-stretch bg-[var(--border)]" />
);

export function MarketplaceFilters({ filters, onChange, counts }: MarketplaceFiltersProps) {
  return (
    <div className="space-y-1.5">
      {/* Row 1: type */}
      <div className="flex flex-wrap items-center gap-1">
        {TYPE_TABS.map(t => (
          <button key={t.value} className={pill(filters.type === t.value)} onClick={() => onChange({ type: t.value })}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Row 2: domain */}
      <div className="flex flex-wrap items-center gap-1">
        {DOMAIN_TABS.map(d => (
          <button
            key={d.value}
            onClick={() => onChange({ domain: d.value })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              filters.domain === d.value
                ? `bg-[rgba(176,128,92,0.18)] ${d.color}`
                : 'text-[var(--muted)] hover:text-[#f2eee4]'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Row 3: level + privacy */}
      <div className="flex flex-wrap items-center gap-1">
        {LEVEL_TABS.map(l => (
          <button key={l.value} className={pill(filters.level === l.value)} onClick={() => onChange({ level: l.value })}>
            {l.icon
              ? <span className="inline-flex items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.icon} alt={l.label} className="h-3.5 w-3.5 object-contain" />
                  {l.label}
                </span>
              : l.label
            }
          </button>
        ))}

        <Divider />

        {PRIVACY_TABS.map(p => (
          <button key={p.value} className={pill(filters.privacy === p.value)} onClick={() => onChange({ privacy: p.value })}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Result count */}
      {(filters.domain !== 'all' || filters.level !== 'all' || filters.privacy !== 'all' || filters.type !== 'all') && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
          <span>Showing {counts.filtered} of {counts.total}</span>
          <button
            onClick={() => onChange({ type: 'all', cat: 'all', domain: 'all', level: 'all', privacy: 'all' })}
            className="text-[#b0805c] hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
