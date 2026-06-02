'use client';

import { usePathname } from 'next/navigation';
import { AppNav } from './AppNav';
import { Footer } from './Footer';

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isEmbed = pathname?.startsWith('/embed');
  return (
    <>
      {!isEmbed && <AppNav />}
      {children}
      {!isEmbed && <Footer />}
    </>
  );
}
