'use client';

import { usePrivy, useWallets } from '@privy-io/react-auth';

export function NavConnectButton() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { wallets } = useWallets();

  if (!ready) return null;

  if (authenticated && wallets.length > 0) {
    const addr = wallets[0].address;
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-[#b0805c]">
          {addr.slice(0, 6)}…{addr.slice(-4)}
        </span>
        <button
          onClick={logout}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)] transition hover:border-red-500/30 hover:text-red-400"
        >
          DISCONNECT
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-4 py-1.5 text-[11px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]"
    >
      CONNECT
    </button>
  );
}
