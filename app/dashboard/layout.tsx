'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PropsWithChildren } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'My Agents', icon: NavIconAgents },
  { href: '/dashboard/work-receipts', label: 'Work Receipts', icon: NavIconReceipts },
  { href: '/dashboard/marketplace', label: 'Marketplace', icon: NavIconMarketplace },
  { href: '/', label: 'Mint Agent', icon: NavIconMint },
];

function NavIconAgents() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </svg>
  );
}

function NavIconReceipts() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 10h8" />
      <path d="M8 14h4" />
    </svg>
  );
}

function NavIconMarketplace() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
    </svg>
  );
}

function NavIconMint() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export default function DashboardLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-30 flex h-screen w-56 flex-col border-r border-[var(--border)] bg-[var(--card-2)]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)]" />
          <span className="text-xs font-bold tracking-[0.14em] text-[rgb(160,220,255)]">
            GHOSTAGENT
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href) && item.href !== '/dashboard';
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                    : 'text-[var(--muted)] hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-5 py-3">
          <div className="text-[10px] text-[var(--muted)]">
            ghostagent.ninja v0.1
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 p-8">
        {children}
      </main>
    </div>
  );
}
