'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV = [
  { href: '/dashboard',            label: 'DASHBOARD' },
  { href: '/dashboard/marketplace', label: 'MARKETPLACE' },
  { href: '/dashboard/mint-body',   label: 'MINT AGENT BODY' },
  { href: '/dashboard/install-brain', label: 'INSTALL AGENT BRAIN' },
  { href: '/host',                  label: '$HOST' },
];

export function AppNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* ── Desktop: top bar ── */}
      <header className="hidden md:flex fixed top-0 left-0 right-0 z-40 h-14 items-center justify-between border-b border-[var(--border)] bg-[#0f0703]/[0.66] backdrop-blur-md px-8">
        <Link href="/" className="text-xs font-bold tracking-[0.18em] text-[#b0805c] hover:text-white transition-colors">
          GHOSTAGENT.NINJA
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-4 py-2 text-[11px] font-semibold tracking-[0.12em] transition-colors ${
                  active
                    ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                    : 'text-[#b0805c] hover:bg-white/5 hover:text-[rgb(160,220,255)]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* ── Mobile: hamburger dropdown ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 border-b border-[var(--border)] bg-[#0f0703]/[0.66] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="text-xs font-bold tracking-[0.18em] text-[#b0805c]" onClick={() => setMobileOpen(false)}>
            GHOSTAGENT.NINJA
          </Link>
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-black/30 text-[var(--muted)] transition hover:text-white"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
        </div>
        {mobileOpen && (
          <nav className="flex flex-col border-t border-[var(--border)] bg-[#0f0703]/[0.95] px-4 py-3 gap-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded-lg px-4 py-3 text-[11px] font-semibold tracking-[0.12em] transition-colors ${
                    active
                      ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                      : 'text-[#b0805c] hover:bg-white/5 hover:text-[rgb(160,220,255)]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {/* Spacers */}
      <div className="h-14" />
    </>
  );
}
