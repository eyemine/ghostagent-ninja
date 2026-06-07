'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pair-nft', label: 'Pair My NFT' },
  { href: '/agents?tab=mint', label: 'Mint Agent ID' },
  { href: '/dashboard/marketplace', label: 'Marketplace' },
  { href: '/treasury', label: 'Treasury' },
  { href: '/docs', label: 'Docs' },
  { href: '/about', label: 'About' },
  // { href: '/host', label: '$HOST' }, // Hidden - staking prototype deprecated
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
      <header className="hidden md:grid fixed top-0 left-0 right-0 z-40 h-14 border-b border-[var(--border)] bg-[#0f0703]/[0.66] backdrop-blur-md px-8" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
        {/* Logo — left */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center gap-1.5 tracking-[0.18em] whitespace-nowrap" style={{ fontFamily: 'Ayuthaya, "Courier New", Courier, monospace', fontSize: '0.75rem', color: '#b0805c' }}>
            GHOSTAGENT.NINJA
            <span style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: '#b0805c', border: '1px solid #b0805c', borderRadius: '3px', padding: '0px 4px', opacity: 0.75, fontFamily: 'monospace', lineHeight: 1 }}>BETA</span>
          </Link>
        </div>
        {/* Nav — center */}
        <nav className="flex items-center gap-8">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[rgba(176,128,92,0.3)] text-[#b0805c]'
                    : 'text-[#b0805c] hover:bg-white/5 hover:text-[#ffca92]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* Connect — right */}
        <div className="flex items-center justify-end">
          <div id="nav-connect-slot" />
        </div>
      </header>

      {/* ── Mobile: hamburger dropdown ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 border-b border-[var(--border)] bg-[#0f0703]/[0.66] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-1.5 tracking-[0.18em]" style={{ fontFamily: 'Ayuthaya, "Courier New", Courier, monospace', fontSize: '0.75rem', color: '#b0805c' }} onClick={() => setMobileOpen(false)}>
            GHOSTAGENT.NINJA
            <span style={{ fontSize: '0.55rem', letterSpacing: '0.12em', color: '#b0805c', border: '1px solid #b0805c', borderRadius: '3px', padding: '0px 4px', opacity: 0.75, fontFamily: 'monospace', lineHeight: 1 }}>BETA</span>
          </Link>
          <div className="flex items-center gap-2">
            <div id="nav-connect-slot-mobile" />
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
                      ? 'bg-[rgba(176,128,92,0.3)] text-[#b0805c]'
                      : 'text-[#b0805c] hover:bg-white/5 hover:text-[#ffca92]'
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
