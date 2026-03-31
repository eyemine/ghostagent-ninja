'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// This page now redirects to /agents (Mint tab).
// All mint functionality has been merged into the unified /agents page.

export default function MintBodyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tab', 'mint');
    const ns = searchParams.get('namespace');
    const name = searchParams.get('name');
    const coupon = searchParams.get('coupon');
    if (ns) params.set('namespace', ns);
    if (name) params.set('name', name);
    if (coupon) params.set('coupon', coupon);
    router.replace(`/agents?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <p className="text-sm text-[var(--muted)]">Redirecting to Agent Registry…</p>
    </div>
  );
}
