'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import Link from 'next/link';

const WORKER_URL = 'https://nftmail-email-worker.richard-159.workers.dev';

interface NftRow {
  type: 'ens' | 'collection';
  name: string;
  displayName: string;
  email: string;
  tokenId?: string;
  collection?: string;
  sovereign?: boolean;  // Path B: TBA-owned Safe — no .nftmail.gno mint needed
  // resolved after scan
  exists?: boolean | null; // null = checking, true = has inbox, false = unclaimed
}

interface EnsResult {
  ensName: string | null;
  ensLabel: string | null;
  hasEns: boolean;
  qualifiesForNftmail?: boolean;
  disqualifyReason?: string | null;
}

export function NFTLogin() {
  const { login, logout, authenticated, ready, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);

  // ENS resolution state
  const [ensResult, setEnsResult] = useState<EnsResult | null>(null);
  const [ensResolving, setEnsResolving] = useState(false);

  // NFT picker rows (ENS + collection NFTs merged)
  const [rows, setRows] = useState<NftRow[]>([]);
  const [scanningNfts, setScanningNfts] = useState(false);
  const [showNftPicker, setShowNftPicker] = useState(false);

  const preferredWallet = wallets.find((w: any) => w?.walletClientType === 'injected') || wallets[0];

  // Resolve existence for a single row and update state
  const checkRowExists = useCallback(async (email: string) => {
    const name = email.replace('@nftmail.box', '');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolveAddress', name }),
      });
      const data = await res.json() as { exists: boolean };
      setRows(prev => prev.map(r => r.email === email ? { ...r, exists: data.exists } : r));
    } catch {
      setRows(prev => prev.map(r => r.email === email ? { ...r, exists: false } : r));
    }
  }, []);

  // Resolve ENS primary name, then build rows
  const resolveEns = useCallback(async (address: string) => {
    setEnsResolving(true);
    setEnsResult(null);
    try {
      const res = await fetch(`/api/resolve-ens?address=${address}`);
      const data: EnsResult & { error?: string } = await res.json();
      if (data.error) throw new Error(data.error);
      setEnsResult(data);

      if (data.hasEns && data.ensLabel && data.qualifiesForNftmail) {
        // Path B ENS: rgbanksy.eth → email=rgbanksy@nftmail.box
        // TBA-owned Gnosis Safe IS the inbox — no .nftmail.gno subname mint, no TLD suffix
        const ensRow: NftRow = {
          type: 'ens',
          name: data.ensLabel,
          displayName: data.ensName || data.ensLabel,
          email: `${data.ensLabel}@nftmail.box`,
          sovereign: true,
          exists: null,
        };
        setRows(prev => {
          const already = prev.find(r => r.email === ensRow.email);
          if (already) return prev;
          return [ensRow, ...prev];
        });
        setShowNftPicker(true);
        checkRowExists(ensRow.email);
      }
    } catch {
      setEnsResult(null);
    }
    setEnsResolving(false);
  }, [checkRowExists]);

  // Scan wallet for collection NFTs (ENS already added via resolveEns)
  const scanNfts = useCallback(async (address: string) => {
    setScanningNfts(true);
    try {
      const res = await fetch(`/api/scan-wallet-nfts?address=${address}`);
      const data = await res.json();
      if (data.nfts && Array.isArray(data.nfts)) {
        const newRows: NftRow[] = (data.nfts as any[])
          .filter((n: any) => n.type !== 'ens') // ENS already in rows via resolveEns
          .map((n: any) => ({
            type: n.type,
            name: n.name,
            displayName: n.displayName,
            email: n.email,
            tokenId: n.tokenId,
            collection: n.collection,
            sovereign: true, // Path B: all collection NFTs use TBA-owned Safe
            exists: null,
          }));
        setRows(prev => {
          const merged = [...prev];
          for (const r of newRows) {
            if (!merged.find(x => x.email === r.email)) merged.push(r);
          }
          return merged;
        });
        // kick off existence checks for new rows
        for (const r of newRows) checkRowExists(r.email);
      }
    } catch {
      // Non-fatal
    }
    setScanningNfts(false);
  }, [checkRowExists]);

  // Auto-resolve ENS when wallet connects
  useEffect(() => {
    if (authenticated && preferredWallet?.address) {
      resolveEns(preferredWallet.address);
    }
  }, [authenticated, preferredWallet?.address, resolveEns]);

  if (!ready) return null;

  // ─── AUTHENTICATED WITH WALLET ───
  if (authenticated && wallets.length > 0) {
    const addr = preferredWallet.address;
    return (
      <div className="flex flex-col gap-3">
        {/* Wallet address + disconnect */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
            <div className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <span className="text-sm font-medium text-emerald-300">
              {addr.slice(0, 6)}...{addr.slice(-4)}
            </span>
          </div>
          <button
            onClick={logout}
            className="rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3 text-sm text-[var(--muted)] transition hover:border-red-500/30 hover:text-red-400"
          >
            Disconnect
          </button>
        </div>

        {/* ENS resolving spinner */}
        {ensResolving && (
          <div className="flex items-center gap-2 rounded-xl border border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.05)] px-4 py-3">
            <div className="h-3 w-3 animate-spin rounded-full border border-[rgba(0,163,255,0.4)] border-t-transparent" />
            <span className="text-xs text-[rgb(160,220,255)]">Resolving ENS name...</span>
          </div>
        )}

        {/* ENS not eligible notice */}
        {ensResult?.hasEns && ensResult.ensLabel && !ensResult.qualifiesForNftmail && !ensResolving && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-[10px] font-semibold text-amber-300">ENS NAME NOT ELIGIBLE</span>
            </div>
            <p className="text-xs text-white">{ensResult.ensName}</p>
            <p className="mt-1 text-[10px] text-amber-300/70">
              {ensResult.disqualifyReason || 'Does not meet nftmail.box character requirements.'}
            </p>
          </div>
        )}

        {/* NFT Picker toggle button */}
        <button
          onClick={() => {
            const next = !showNftPicker;
            setShowNftPicker(next);
            if (next && rows.filter(r => r.type !== 'ens').length === 0) {
              scanNfts(addr);
            }
          }}
          className="w-full rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-4 py-3 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)]"
        >
          {showNftPicker ? 'Hide NFT Picker' : 'NFT Picker'}
        </button>

        {/* NFT Picker panel */}
        {showNftPicker && (
          <div className="rounded-xl border border-[var(--border)] bg-black/20 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[rgb(160,220,255)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
                <span className="text-xs font-semibold text-white">NFTs in wallet</span>
              </div>
              {!scanningNfts && rows.filter(r => r.type !== 'ens').length === 0 && (
                <button
                  onClick={() => scanNfts(addr)}
                  className="text-[10px] text-[rgb(160,220,255)] hover:underline"
                >
                  Scan collection NFTs
                </button>
              )}
            </div>

            {(scanningNfts || ensResolving) && rows.length === 0 && (
              <div className="flex items-center gap-2 py-4 justify-center">
                <div className="h-3 w-3 animate-spin rounded-full border border-[rgba(0,163,255,0.4)] border-t-transparent" />
                <span className="text-xs text-[var(--muted)]">Scanning wallet...</span>
              </div>
            )}

            {!scanningNfts && !ensResolving && rows.length === 0 && (
              <p className="text-xs text-[var(--muted)] text-center py-4">
                No ENS names or verified collection NFTs found in this wallet.
              </p>
            )}

            {rows.length > 0 && (
              <div className="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: '272px' }}>
                {rows.map((row, i) => (
                  <div
                    key={`${row.email}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-black/10 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{row.displayName}</p>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${
                          row.type === 'ens'
                            ? 'text-[rgb(160,220,255)] bg-[rgba(0,163,255,0.08)] ring-[rgba(0,163,255,0.2)]'
                            : 'text-violet-300 bg-violet-500/8 ring-violet-500/20'
                        }`}>
                          {row.type === 'ens' ? 'ENS' : row.collection || 'NFT'}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--muted)] mt-0.5">{row.email}</p>
                    </div>
                    <div className="ml-3 flex-shrink-0">
                      {row.exists === null ? (
                        <div className="h-3 w-3 animate-spin rounded-full border border-[rgb(160,220,255)] border-t-transparent" />
                      ) : row.exists ? (
                        <Link
                          href={`/inbox/${row.name}${row.tokenId ? '.' + row.tokenId : ''}`}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20 whitespace-nowrap"
                        >
                          Check Mail
                        </Link>
                      ) : row.sovereign ? (
                        <Link
                          href={`/nftmail?claim=${row.name}${row.tokenId ? '.' + row.tokenId : ''}&sovereign=1`}
                          className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/20 whitespace-nowrap"
                        >
                          Claim Name
                        </Link>
                      ) : (
                        <Link
                          href={`/nftmail?claim=${row.name}${row.tokenId ? '.' + row.tokenId : ''}`}
                          className="rounded-lg border border-[rgba(0,163,255,0.3)] bg-[rgba(0,163,255,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.16)] whitespace-nowrap"
                        >
                          Claim
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2 text-center text-[10px] text-[var(--muted)]">
              Verified NFT Collections Coming Soon
            </p>

          </div>
        )}

        {error && <p className="text-center text-xs text-amber-400">{error}</p>}
      </div>
    );
  }

  // ─── AUTHENTICATED BUT NO WALLET ───
  if (authenticated && wallets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-sm text-amber-300">Logged in — connecting wallet...</span>
        </div>
        <button
          onClick={() => connectWallet()}
          className="w-full rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-6 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)]"
        >
          Connect External Wallet
        </button>
      </div>
    );
  }

  // ─── NOT AUTHENTICATED ───
  const handleLogin = async () => {
    setError(null);
    try {
      await login();
    } catch (err: any) {
      setError(err?.message || 'Connection failed. Try email login or a different wallet.');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={handleLogin}
        className="group relative w-full overflow-hidden rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-6 py-4 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] hover:shadow-[0_0_32px_rgba(0,163,255,0.12)]"
      >
        <div className="flex items-center justify-center gap-3">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M22 8l-10 5L2 8" />
          </svg>
          NFT Login
          <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </div>
      </button>
      <p className="text-center text-[10px] text-[var(--muted)]">Connect wallet to check ENS name or browse NFTs for your nftmail.box address</p>
      {error && <p className="text-center text-xs text-amber-400">{error}</p>}
    </div>
  );
}
