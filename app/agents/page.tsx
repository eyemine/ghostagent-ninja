'use client';

import { useState } from 'react';
import { DomainCard, Domain } from '../components/DomainCard';

const GHOST_LOGO = '/ghost-logo.png';

const DOMAINS: Domain[] = [
  {
    id: 'agent',
    label: 'Agent',
    tld: 'agent.gno',
    tagline: 'Full agent identity with evolve path',
    mintFee: 10,
    moltFee: 2,
    evolvePath: 'imago.gno',
    privacyDefault: 'private',
    decayDays: 8,
    canEvolve: true,
    color: 'amber',
    accentBg: 'bg-[rgba(176,128,92,0.12)]',
    accentRing: 'ring-[rgba(176,128,92,0.25)]',
    accentText: 'text-[#b0805c]',
    description:
      'Pupa → Imago evolve path (+8 xDAI, then +24 xDAI/yr). 8-day decay. Private by default. $10 $HOST staking for 365-day persistence. 10 xDAI mint or molt from Larva · 2 xDAI molt from Pupa. Bundled *.creation.ip + nftmail.box address.',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    tld: 'openclaw.gno',
    tagline: 'Full agent with on-chain IP',
    mintFee: 5,
    moltFee: 5,
    evolvePath: 'vault.gno',
    privacyDefault: 'glassbox',
    decayDays: null,
    canEvolve: true,
    color: 'cyan',
    accentBg: 'bg-cyan-500/10',
    accentRing: 'ring-cyan-500/20',
    accentText: 'text-cyan-300',
    description:
      'Full-featured agent namespace. Glassbox by default — all work is publicly verifiable. Earns $HOST reputation. Can list on the Marketplace.',
  },
  {
    id: 'molt',
    label: 'Molt',
    tld: 'molt.gno',
    tagline: 'Transition namespace during evolution',
    mintFee: 'free',
    moltFee: 'free',
    evolvePath: null,
    privacyDefault: 'glassbox',
    decayDays: 30,
    canEvolve: false,
    color: 'fuchsia',
    accentBg: 'bg-fuchsia-500/10',
    accentRing: 'ring-fuchsia-500/20',
    accentText: 'text-fuchsia-300',
    description:
      'Temporary namespace held during a molt cycle. Free to occupy, decays in 30 days. Larva-only — cannot evolve further from molt itself.',
  },
  {
    id: 'picoclaw',
    label: 'PicoClaw',
    tld: 'picoclaw.gno',
    tagline: 'Larva agent — zero cost entry',
    mintFee: 'free',
    moltFee: 2,
    evolvePath: 'openclaw.gno',
    privacyDefault: 'glassbox',
    decayDays: 8,
    canEvolve: true,
    color: 'amber',
    accentBg: 'bg-amber-500/10',
    accentRing: 'ring-amber-500/20',
    accentText: 'text-amber-300',
    description:
      'The free on-ramp. Mint a larva agent with no fees, explore the ecosystem, and evolve up to openclaw when ready. 8-day history window on free tier.',
  },
  {
    id: 'vault',
    label: 'Vault',
    tld: 'vault.gno',
    tagline: 'Pro agent with persistent storage',
    mintFee: 10,
    moltFee: 10,
    evolvePath: null,
    privacyDefault: 'private',
    decayDays: null,
    canEvolve: false,
    color: 'emerald',
    accentBg: 'bg-emerald-500/10',
    accentRing: 'ring-emerald-500/20',
    accentText: 'text-emerald-300',
    description:
      'Top-tier namespace. Private by default, persistent storage, IP protection on Story Protocol, and full $HOST earning. The final evolution target.',
  },
  {
    id: 'nftmail',
    label: 'NFTmail',
    tld: 'nftmail.gno',
    tagline: 'Identity firewall for your inbox',
    mintFee: 2,
    moltFee: 'free',
    evolvePath: 'vault.gno',
    privacyDefault: 'private',
    decayDays: null,
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
  const mintLabel = domain.mintFee === 'free' ? 'Free' : `${domain.mintFee} xDAI`;

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
            { label: 'DECAY', value: domain.decayDays ? `${domain.decayDays}d` : 'None' , highlight: !domain.decayDays },
            { label: 'EVOLVE TO', value: domain.evolvePath ?? '—', highlight: !!domain.evolvePath },
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
        {name && (
          <p className="mt-1.5 text-[10px] text-[var(--muted)]">
            Will mint: <span className={`font-semibold ${domain.accentText}`}>{name}.{domain.tld}</span>
          </p>
        )}

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
            disabled={!name}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-40 ${domain.accentBg} ${domain.accentText} ring-1 ${domain.accentRing} hover:brightness-125`}
          >
            {domain.mintFee === 'free' ? 'Mint Free' : `Mint for ${domain.mintFee} xDAI`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [filterFee, setFilterFee] = useState<FilterFee>('all');
  const [filterPrivacy, setFilterPrivacy] = useState<FilterPrivacy>('all');
  const [filterEvolve, setFilterEvolve] = useState<FilterEvolve>('all');
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
          <div className="mb-8 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={GHOST_LOGO} alt="GhostAgent" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
            <div>
              <h1 className="text-2xl font-bold text-[#f2eee4]">Choose Your Domain</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                5 namespaces · zero lock-in · transfer or burn your NFT at any time
              </p>
            </div>
          </div>

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

            <span className="mr-1 text-[10px] font-semibold tracking-wider text-[var(--muted)]">EVOLVE</span>
            <FilterBtn value="all" current={filterEvolve} set={setFilterEvolve} label="All" />
            <FilterBtn value="can-evolve" current={filterEvolve} set={setFilterEvolve} label="Can Evolve" />
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

        </div>
      </div>
    </>
  );
}
