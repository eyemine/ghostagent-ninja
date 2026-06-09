'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { DelegationWizard } from '../../components/DelegationWizard';
import type { SupportedChainName } from '../../utils/delegate-write';

const GHOST_LOGO = '/ghost-logo.png';

const NORMIES_CONTRACT  = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const NORMIES_CHAIN: SupportedChainName = 'ethereum';

// Set NEXT_PUBLIC_FAKE_NORMIE_CONTRACT after deploying FakeNormie.sol to Gnosis
const FAKE_NORMIE_CONTRACT = process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT ?? '';
const FAKE_NORMIE_CHAIN: SupportedChainName = 'gnosis';

type Tab = 'demo' | 'normies' | 'custom';
type DemoMintState = 'idle' | 'minting' | 'minted' | 'already' | 'error';

export default function DelegatePage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [tab, setTab] = useState<Tab>('demo');
  const [customContract, setCustomContract] = useState('');
  const [customChain, setCustomChain]       = useState<SupportedChainName>('gnosis');
  const [txHistory, setTxHistory]           = useState<Array<{ txHash: string; hot: string; tokenId: string; ts: number }>>([]);
  const [demoMintState, setDemoMintState]   = useState<DemoMintState>('idle');
  const [demoTokenId, setDemoTokenId]       = useState<string | null>(null);
  const [demoTxHash, setDemoTxHash]         = useState<string | null>(null);
  const [demoError, setDemoError]           = useState('');

  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy')?.address ?? wallets[0]?.address ?? null;

  const handleSuccess = (txHash: string, hot: string, tokenId: string) => {
    setTxHistory(prev => [{ txHash, hot, tokenId, ts: Date.now() }, ...prev].slice(0, 10));
  };

  const handleDemoMint = useCallback(async () => {
    if (!connectedWallet) return;
    setDemoMintState('minting');
    setDemoError('');
    try {
      const res = await fetch('/api/demo-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientAddress: connectedWallet }),
      });
      const data = await res.json() as { success?: boolean; alreadyMinted?: boolean; tokenId?: string; txHash?: string; error?: string };
      if (data.alreadyMinted) { setDemoMintState('already'); return; }
      if (!data.success || data.error) { setDemoError(data.error ?? 'Mint failed'); setDemoMintState('error'); return; }
      setDemoTokenId(data.tokenId ?? null);
      setDemoTxHash(data.txHash ?? null);
      setDemoMintState('minted');
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : 'Network error');
      setDemoMintState('error');
    }
  }, [connectedWallet]);

  const effectiveContract = tab === 'demo' ? FAKE_NORMIE_CONTRACT : tab === 'normies' ? NORMIES_CONTRACT : customContract;
  const effectiveChain    = tab === 'demo' ? FAKE_NORMIE_CHAIN    : tab === 'normies' ? NORMIES_CHAIN    : customChain;
  const effectiveName     = tab === 'demo' ? 'FakeNormie'          : tab === 'normies' ? 'Normies'         : 'NFT';

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.1),transparent_45%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GHOST_LOGO} alt="" className="h-8 w-8 rounded-lg opacity-80" />
          <div>
            <h1 className="text-xl font-bold text-white">Security Vault</h1>
            <p className="text-[11px] text-[var(--muted)]">Delegate token-level proxy access without moving your NFT</p>
          </div>
          <Link href="/dashboard" className="ml-auto text-[11px] text-[var(--muted)] hover:text-white transition">
            ← Dashboard
          </Link>
        </div>

        {/* Phase explainer */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.06)] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(160,220,255)] mb-1">Phase 1 · Now</div>
            <div className="text-xs font-semibold text-white mb-1">Desktop Setup</div>
            <div className="text-[10px] text-[var(--muted)] leading-relaxed">
              Connect your cold vault, select your Normie, sign one transaction. Your NFT stays put.
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/6 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-1">Phase 2 · Mobile</div>
            <div className="text-xs font-semibold text-white mb-1">Farcaster Proxy</div>
            <div className="text-[10px] text-[var(--muted)] leading-relaxed">
              Scan the QR. Open nftmail.box in Warpcast. Chat as your agent from your Farcaster wallet.
            </div>
          </div>
        </div>

        {/* Auth gate */}
        {!authenticated ? (
          <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-8 text-center space-y-4">
            <div className="text-2xl">🔐</div>
            <div className="text-sm font-semibold text-white">Connect your cold vault wallet to continue</div>
            <div className="text-[11px] text-[var(--muted)]">
              This page requires the vault wallet that holds your NFT. Use MetaMask, Rabby, or a hardware wallet.
            </div>
            <button
              onClick={login}
              className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-6 py-2.5 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.22)]"
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-6 space-y-5">

            {/* Tab selector */}
            <div className="flex gap-2 flex-wrap">
              {(['demo', 'normies', 'custom'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t
                      ? 'bg-[rgba(0,163,255,0.18)] border border-[rgba(0,163,255,0.35)] text-[rgb(160,220,255)]'
                      : 'border border-[var(--border)] text-[var(--muted)] hover:text-white'
                  }`}
                >
                  {t === 'demo' ? '👻 FakeNormie Demo' : t === 'normies' ? '🎃 Normies' : '⚙️ Custom NFT'}
                </button>
              ))}
            </div>

            {/* Demo tab — gasless FakeNormie mint */}
            {tab === 'demo' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/6 p-4 text-[11px] text-[var(--muted)] space-y-1 leading-relaxed">
                  <div className="font-semibold text-white text-xs mb-2">👻 Hackathon Demo Mode</div>
                  <div>No real Normie required. Mint a free <span className="text-violet-300 font-semibold">FakeNormie</span> to your connected wallet — then immediately delegate it to a hot wallet to demo the full proxy inbox flow.</div>
                  <div className="text-violet-300/70 pt-0.5">Minted on Gnosis · treasury pays gas · max 1 per wallet</div>
                </div>

                {demoMintState === 'idle' && (
                  <button onClick={handleDemoMint} disabled={!connectedWallet || !FAKE_NORMIE_CONTRACT}
                    className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-3 text-sm font-semibold text-violet-300 transition hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
                    {!FAKE_NORMIE_CONTRACT ? '⏳ Contract deploying…' : '👻 Mint My FakeNormie (Free)'}
                  </button>
                )}
                {demoMintState === 'minting' && (
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-400" />
                    <span className="text-sm text-[var(--muted)]">Minting on Gnosis…</span>
                  </div>
                )}
                {demoMintState === 'minted' && demoTokenId && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">👻</span>
                      <div>
                        <div className="text-sm font-bold text-white">FakeNormie #{demoTokenId} minted!</div>
                        <div className="text-[10px] text-[var(--muted)]">Now scroll down and delegate it to your hot wallet below.</div>
                      </div>
                    </div>
                    {demoTxHash && (
                      <a href={`https://gnosisscan.io/tx/${demoTxHash}`} target="_blank" rel="noopener noreferrer"
                        className="block text-[10px] font-mono text-violet-300 hover:underline truncate">{demoTxHash}</a>
                    )}
                  </div>
                )}
                {demoMintState === 'already' && (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4 text-[11px] text-emerald-300">
                    ✓ Your wallet already has a FakeNormie — skip to the delegation wizard below.
                  </div>
                )}
                {demoMintState === 'error' && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3 text-[11px] text-red-300 space-y-2">
                    <div>{demoError}</div>
                    <button onClick={() => { setDemoMintState('idle'); setDemoError(''); }} className="text-[10px] underline underline-offset-2">Try again</button>
                  </div>
                )}

                <div className="border-t border-[var(--border)] pt-4" />
              </div>
            )}

            {/* Custom contract inputs */}
            {tab === 'custom' && (
              <div className="space-y-3 rounded-xl border border-[var(--border)] bg-black/20 p-4">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                    NFT Contract Address
                  </label>
                  <input
                    type="text"
                    placeholder="0x…"
                    value={customContract}
                    onChange={e => setCustomContract(e.target.value.trim())}
                    className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 font-mono text-xs text-white placeholder:text-[var(--muted)] focus:border-[rgb(160,220,255)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
                    Chain
                  </label>
                  <select
                    value={customChain}
                    onChange={e => setCustomChain(e.target.value as SupportedChainName)}
                    className="rounded-lg border border-[var(--border)] bg-black/80 px-3 py-2 text-xs text-white focus:border-[rgb(160,220,255)] focus:outline-none"
                  >
                    <option value="gnosis">Gnosis</option>
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                  </select>
                </div>
              </div>
            )}

            {/* Wizard */}
            {(tab === 'demo' && FAKE_NORMIE_CONTRACT) || tab === 'normies' || (tab === 'custom' && customContract.match(/^0x[a-fA-F0-9]{40}$/)) ? (
              <DelegationWizard
                nftContractAddress={effectiveContract}
                nftCollectionName={effectiveName}
                chain={effectiveChain}
                onSuccess={handleSuccess}
              />
            ) : tab === 'custom' && (
              <div className="text-[11px] text-[var(--muted)] text-center py-4">
                Enter a valid contract address above to continue.
              </div>
            )}
          </div>
        )}

        {/* Tx history */}
        {txHistory.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-black/20 p-4 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Recent Delegations</div>
            {txHistory.map(entry => (
              <div key={entry.txHash} className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                <span>Token #{entry.tokenId} → {entry.hot.slice(0, 8)}…</span>
                <a
                  href={`https://etherscan.io/tx/${entry.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[rgb(160,220,255)] hover:underline"
                >
                  {entry.txHash.slice(0, 10)}…
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <div className="text-center text-[10px] text-[var(--muted)]">
          Delegation is powered by{' '}
          <a href="https://delegate.xyz" target="_blank" rel="noopener noreferrer" className="text-[rgb(160,220,255)] hover:underline">
            Delegate V2
          </a>
          {' '}— the open, immutable, permissionless registry. Same contract used by Blur, OpenSea, and Guild.
        </div>
      </div>
    </div>
  );
}
