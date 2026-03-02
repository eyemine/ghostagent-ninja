'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/marketplace', label: 'Marketplace' },
  { href: '/dashboard/mint-body', label: 'Mint Agent Body' },
  { href: '/dashboard/install-brain', label: 'Install Agent Brain' },
  { href: '/host', label: '$HOST' },
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
        <Link href="/" className="tracking-[0.18em] text-[#b0805c] hover:text-white transition-colors" style={{ fontFamily: 'Ayuthaya, serif', fontSize: '0.75rem' }}>
          GHOSTAGENT.NINJA
        </Link>
        <nav className="flex items-center gap-2">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[rgba(176,128,92,0.5)] text-[#f2eee4]'
                    : 'text-[#b0805c] hover:bg-white/5 hover:text-[#f2eee4]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ml-3 pl-3 border-l border-[var(--border)]">
            <div id="nav-connect-slot" />
          </div>
        </nav>
      </header>

      {/* ── Mobile: hamburger dropdown ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 border-b border-[var(--border)] bg-[#0f0703]/[0.66] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="tracking-[0.18em] text-[#b0805c]" style={{ fontFamily: 'Ayuthaya, serif', fontSize: '0.75rem' }} onClick={() => setMobileOpen(false)}>
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
                  className={`rounded-lg px-4 py-3 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[rgba(176,128,92,0.5)] text-[#f2eee4]'
                      : 'text-[#b0805c] hover:bg-white/5 hover:text-[#f2eee4]'
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
