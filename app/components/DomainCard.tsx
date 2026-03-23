'use client';

export type Privacy = 'glassbox' | 'private';
export type EvolvePath = 'larva-only' | string;

export interface Domain {
  id: string;
  label: string;
  tld: string;
  tagline: string;
  mintFee: number | 'free';
  moltFee: number | 'free';
  evolvePath: string | null;
  privacyDefault: Privacy;
  decayDays: number | null;
  canEvolve: boolean;
  color: string;
  accentBg: string;
  accentRing: string;
  accentText: string;
  description: string;
}

interface DomainCardProps {
  domain: Domain;
  onMint: (domain: Domain) => void;
}

export function DomainCard({ domain, onMint }: DomainCardProps) {
  const mintLabel = domain.mintFee === 'free' ? 'Free' : `${domain.mintFee} xDAI`;
  const moltLabel = domain.moltFee === 'free' ? 'Free' : `${domain.moltFee} xDAI`;

  return (
    <div
      className={`flex flex-col justify-between rounded-2xl border bg-[var(--card)] p-5 transition hover:brightness-110 ${domain.accentRing}`}
    >
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={`text-lg font-bold ${domain.accentText}`}>
              .{domain.tld}
            </span>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{domain.tagline}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${domain.accentBg} ${domain.accentText} ring-1 ${domain.accentRing}`}
            >
              {domain.privacyDefault === 'glassbox' ? '⬜ Glassbox' : '🔒 Private'}
            </span>
            {domain.canEvolve ? (
              <span className="inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">
                ↑ Can Cycle
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-zinc-500/10 px-2 py-0.5 text-[9px] font-medium text-zinc-500 ring-1 ring-zinc-500/20">
                Larva-only
              </span>
            )}
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
          {domain.description}
        </p>

        {/* Fee + decay grid */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">MINT FEE</div>
            <div className={`mt-0.5 text-sm font-semibold ${domain.mintFee === 'free' ? 'text-emerald-300' : 'text-[#f2eee4]'}`}>
              {mintLabel}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">MOLT FEE</div>
            <div className={`mt-0.5 text-sm font-semibold ${domain.moltFee === 'free' ? 'text-emerald-300' : 'text-[#f2eee4]'}`}>
              {moltLabel}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">HISTORY</div>
            <div className="mt-0.5 text-sm font-semibold text-[#f2eee4]">
              {domain.decayDays ? `${domain.decayDays}d` : 'Persistent'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <div className="text-[9px] font-semibold tracking-wider text-[var(--muted)]">CYCLE TO</div>
            <div className={`mt-0.5 text-sm font-semibold ${domain.evolvePath ? domain.accentText : 'text-zinc-600'}`}>
              {domain.evolvePath ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={() => onMint(domain)}
        className={`mt-5 w-full rounded-xl py-2.5 text-sm font-semibold transition ${domain.accentBg} ${domain.accentText} ring-1 ${domain.accentRing} hover:brightness-125`}
      >
        Mint on .{domain.tld} →
      </button>
    </div>
  );
}
