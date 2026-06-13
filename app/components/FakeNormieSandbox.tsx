'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';

type MintState = 'idle' | 'minting' | 'minted' | 'already' | 'error';

interface FakeNormieSandboxProps {
  /** If true, renders in a 2-column grid context (wider layout). Default false. */
  wide?: boolean;
  /** Called after a successful mint so the parent can auto-fill the token ID. */
  onMinted?: (tokenId: string) => void;
}

export function FakeNormieSandbox({ wide = false, onMinted }: FakeNormieSandboxProps) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();
  const connectedWallet =
    wallets.find(w => w.walletClientType !== 'privy')?.address ?? wallets[0]?.address ?? null;

  const [state, setState]     = useState<MintState>('idle');
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [error, setError]     = useState('');

  const handleMint = useCallback(async () => {
    if (!connectedWallet) return;
    setState('minting');
    try {
      const res = await fetch('/api/demo-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientAddress: connectedWallet }),
      });
      const data = await res.json() as {
        success?: boolean; alreadyMinted?: boolean;
        tokenId?: string; error?: string;
      };
      if (data.alreadyMinted) { setState('already'); return; }
      if (!data.success) { setError(data.error ?? 'Mint failed'); setState('error'); return; }
      const tid = data.tokenId ?? null;
      setTokenId(tid);
      setState('minted');
      if (tid) onMinted?.(tid);
      // Redirect to fakenormies page where user can see their agent
      router.push('/fakenormies');
    } catch {
      setError('Network error — try again');
      setState('error');
    }
  }, [connectedWallet, onMinted]);

  return (
    <div className={`w-full rounded-2xl border border-pink-500/30 bg-pink-500/5 p-5 space-y-3${wide ? ' col-span-2' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-pink-300">FakeNormie Sandbox</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Claim a free FakeNormie NFT on Gnosis Chain — then use it as your agent identity.
          </p>
        </div>
        <Link
          href="/fakenormies"
          className="shrink-0 rounded-lg border border-pink-500/30 bg-pink-500/10 px-3 py-1.5 text-[10px] font-semibold text-pink-300 hover:bg-pink-500/20 transition"
        >
          Learn more ↗
        </Link>
      </div>

      {!authenticated ? (
        <button
          onClick={login}
          className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600 transition"
        >
          Connect Wallet to Claim
        </button>
      ) : state === 'idle' ? (
        <button
          onClick={handleMint}
          className="w-full rounded-lg bg-pink-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-pink-600 transition"
        >
          Claim free FakeNormie →
        </button>
      ) : state === 'minting' ? (
        <div className="rounded-lg bg-gray-800/50 px-4 py-3 text-sm text-gray-300">
          Minting on Gnosis Chain…
        </div>
      ) : state === 'minted' ? (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-emerald-400">✓ Minted! Token ID: {tokenId}</p>
          <p className="text-xs text-[var(--muted)]">
            Select <span className="font-semibold text-[#f2eee4]">FAKENORMIE ON GNOSIS</span> above and enter token ID{' '}
            <span className="font-mono text-pink-300">{tokenId}</span> to pair your agent.
          </p>
          <Link
            href="/fakenormies"
            className="inline-block text-[11px] text-sky-400 hover:underline"
          >
            Set up your agent inbox →
          </Link>
        </div>
      ) : state === 'already' ? (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-amber-400">You already have a FakeNormie</p>
          <p className="text-xs text-[var(--muted)]">
            Check Gnosisscan for your token ID, then select FAKENORMIE above.
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-sky-400 hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
