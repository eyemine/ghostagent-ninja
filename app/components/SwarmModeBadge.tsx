'use client';

import { useState } from 'react';

interface Props {
  memberCount: number;
  strategy?: string;
  hackathonTag?: string;
  size?: 'xs' | 'sm';
}

const TOOLTIP = 'Swarm Mode: vault.gno container with picoclaw.gno modules enabled';

export default function SwarmModeBadge({ memberCount, strategy, hackathonTag, size = 'xs' }: Props) {
  const [tip, setTip] = useState(false);
  const active = memberCount >= 2;
  const px = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-2 py-0.5 text-[9px]';

  if (!active) return null;

  return (
    <span className="relative inline-flex">
      <span
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        className={`inline-flex cursor-default items-center gap-1 rounded-full bg-violet-500/10 font-semibold text-violet-300 ring-1 ring-violet-500/20 ${px}`}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-400" />
        </span>
        Swarm Mode ✓
        {hackathonTag && (
          <span className="ml-0.5 rounded bg-violet-500/20 px-1 text-[8px] font-bold uppercase tracking-wide text-violet-200">
            {hackathonTag}
          </span>
        )}
      </span>
      {tip && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 shadow-lg">
          <span className="block text-[10px] text-[var(--muted)]">{TOOLTIP}</span>
          <span className="mt-0.5 block text-[10px] text-white/70">
            {memberCount} member{memberCount !== 1 ? 's' : ''}
            {strategy ? ` · ${strategy}` : ''}
          </span>
        </span>
      )}
    </span>
  );
}
