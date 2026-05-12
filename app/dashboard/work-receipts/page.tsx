'use client';

import { usePrivy } from '@privy-io/react-auth';

// Telemetry receipts coming soon — hidden per product request
// Original implementation backed up in git history

export default function WorkReceiptsPage() {
  const { authenticated } = usePrivy();

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
          <div className="mb-4 text-4xl">📊</div>
          <h1 className="text-xl font-bold text-[#f2eee4]">Agent Telemetry</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Detailed work receipts and performance analytics coming soon.
          </p>
          <div className="mt-6 text-xs text-[var(--muted)]">
            {authenticated ? (
              <span>Your agent activity is being tracked and will appear here.</span>
            ) : (
              <span>Connect your wallet to view agent telemetry.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
