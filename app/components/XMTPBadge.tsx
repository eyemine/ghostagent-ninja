'use client';

import { useState } from 'react';

export type XMTPBadgeVariant = 'enabled' | 'disabled' | 'picoclaw';

interface Props {
  variant: XMTPBadgeVariant;
  size?: 'sm' | 'xs';
}

const TOOLTIP = 'XMTP enables E2EE agent-to-agent messaging';

export default function XMTPBadge({ variant, size = 'xs' }: Props) {
  const [tip, setTip] = useState(false);
  const px = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-2 py-0.5 text-[9px]';

  if (variant === 'disabled') return null;

  return (
    <span className="relative inline-flex">
      {variant === 'enabled' && (
        <span
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          className={`inline-flex cursor-default items-center gap-1 rounded-full bg-emerald-500/10 font-semibold text-emerald-300 ring-1 ring-emerald-500/20 ${px}`}
        >
          XMTP Verified ✓
        </span>
      )}
      {variant === 'picoclaw' && (
        <span
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          className={`inline-flex cursor-default items-center gap-1 rounded-full bg-amber-500/10 font-semibold text-amber-300 ring-1 ring-amber-500/20 ${px}`}
        >
          Upgrade to PUPA for XMTP
        </span>
      )}
      {tip && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[10px] text-[var(--muted)] shadow-lg">
          {TOOLTIP}
        </span>
      )}
    </span>
  );
}
