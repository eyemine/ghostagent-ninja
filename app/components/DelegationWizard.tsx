'use client';

/**
 * DelegationWizard — Phase 1 "Security Vault" onboarding
 *
 * Allows the cold vault wallet to grant token-level delegation to a hot
 * Farcaster/mobile wallet directly inside GhostAgent, without ever visiting
 * delegate.xyz or leaving the app.
 *
 * Steps:
 *   1. Enter hot wallet address + select Normie NFT token ID
 *   2. Sign the delegateERC721 transaction with the cold wallet
 *   3. Success screen + QR code deep-link to the nftmail.box mini-app
 *
 * The component is chain-agnostic via the `chain` prop (defaults to gnosis).
 * For Normies on mainnet, pass chain="ethereum".
 */

import { useState, useCallback, useEffect } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { gnosis, mainnet, base } from 'viem/chains';
import { executeInAppDelegation, revokeInAppDelegation, type SupportedChainName } from '../utils/delegate-write';
import { checkDelegateForERC721 } from '../utils/delegate-verify';

const CHAIN_RPC: Record<SupportedChainName, string> = {
  gnosis:   'https://rpc.gnosischain.com',
  ethereum: 'https://eth.llamarpc.com',
  base:     'https://mainnet.base.org',
};

const CHAIN_EXPLORER: Record<SupportedChainName, string> = {
  gnosis:   'https://gnosisscan.io/tx',
  ethereum: 'https://etherscan.io/tx',
  base:     'https://basescan.org/tx',
};

const CHAIN_VIEM = { gnosis, ethereum: mainnet, base };

const MINI_APP_URL = 'https://nftmail.box/mini';

interface DelegationWizardProps {
  /** NFT contract to delegate (e.g. Normies contract) */
  nftContractAddress: string;
  /** Human label shown in the UI */
  nftCollectionName?: string;
  /** Chain the NFT lives on */
  chain?: SupportedChainName;
  /** Called after a successful delegation tx */
  onSuccess?: (txHash: string, hotWallet: string, tokenId: string) => void;
}

type WizardStep = 'form' | 'confirming' | 'success' | 'revoke-confirm' | 'revoking' | 'revoked';

function shortenAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function DelegationWizard({
  nftContractAddress,
  nftCollectionName = 'NFT',
  chain = 'gnosis',
  onSuccess,
}: DelegationWizardProps) {
  const { wallets } = useWallets();

  const [step, setStep]           = useState<WizardStep>('form');
  const [hotWallet, setHotWallet] = useState('');
  const [tokenId, setTokenId]     = useState('');
  const [txHash, setTxHash]       = useState('');
  const [error, setError]         = useState('');
  const [existingDelegation, setExistingDelegation] = useState<boolean | null>(null);
  const [checking, setChecking]   = useState(false);

  // Detect connected cold wallet
  const preferredWallet = wallets.find(w => w.walletClientType !== 'privy') ?? wallets[0] ?? null;
  const coldWalletAddress = preferredWallet?.address ?? null;

  // Check if delegation already exists whenever inputs are complete
  useEffect(() => {
    if (!hotWallet.match(/^0x[a-fA-F0-9]{40}$/) || !tokenId.match(/^\d+$/) || !coldWalletAddress) {
      setExistingDelegation(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    checkDelegateForERC721({
      hotWallet,
      vaultWallet: coldWalletAddress,
      contract:    nftContractAddress,
      tokenId,
      rpcUrl:      CHAIN_RPC[chain],
    }).then(result => {
      if (!cancelled) {
        setExistingDelegation(result.isDelegated);
        setChecking(false);
      }
    });
    return () => { cancelled = true; };
  }, [hotWallet, tokenId, coldWalletAddress, nftContractAddress, chain]);

  const handleDelegate = useCallback(async () => {
    setError('');
    if (!hotWallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Enter a valid hot wallet address (0x…)');
      return;
    }
    if (!tokenId.match(/^\d+$/)) {
      setError('Enter a valid token ID (integer)');
      return;
    }
    if (!coldWalletAddress) {
      setError('Connect your cold vault wallet first');
      return;
    }

    setStep('confirming');

    try {
      // Build a viem WalletClient from the Privy/injected wallet
      const viemChain = CHAIN_VIEM[chain];
      let walletClient;
      if (preferredWallet && typeof (preferredWallet as unknown as { getEthereumProvider?: () => unknown }).getEthereumProvider === 'function') {
        const provider = await (preferredWallet as unknown as { getEthereumProvider: () => Promise<unknown> }).getEthereumProvider();
        walletClient = createWalletClient({
          chain: viemChain,
          transport: custom(provider as Parameters<typeof custom>[0]),
        });
      }
      // Falls back to window.ethereum if walletClient is undefined

      const result = await executeInAppDelegation(
        { hotWalletAddress: hotWallet, nftContractAddress, tokenId: BigInt(tokenId), chain },
        walletClient,
      );

      if (!result.success) {
        setError(result.error ?? 'Transaction failed');
        setStep('form');
        return;
      }

      setTxHash(result.txHash ?? '');
      setStep('success');
      onSuccess?.(result.txHash ?? '', hotWallet, tokenId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStep('form');
    }
  }, [hotWallet, tokenId, coldWalletAddress, chain, nftContractAddress, preferredWallet, onSuccess]);

  const handleRevoke = useCallback(async () => {
    setError('');
    setStep('revoking');
    try {
      const viemChain = CHAIN_VIEM[chain];
      let walletClient;
      if (preferredWallet && typeof (preferredWallet as unknown as { getEthereumProvider?: () => unknown }).getEthereumProvider === 'function') {
        const provider = await (preferredWallet as unknown as { getEthereumProvider: () => Promise<unknown> }).getEthereumProvider();
        walletClient = createWalletClient({
          chain: viemChain,
          transport: custom(provider as Parameters<typeof custom>[0]),
        });
      }
      const result = await revokeInAppDelegation(
        { hotWalletAddress: hotWallet, nftContractAddress, tokenId: BigInt(tokenId), chain },
        walletClient,
      );
      if (!result.success) {
        setError(result.error ?? 'Revoke failed');
        setStep('revoke-confirm');
        return;
      }
      setTxHash(result.txHash ?? '');
      setStep('revoked');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStep('revoke-confirm');
    }
  }, [hotWallet, tokenId, chain, nftContractAddress, preferredWallet]);

  // ── Step: form ─────────────────────────────────────────────────────────────
  if (step === 'form') {
    return (
      <div className="w-full space-y-5">
        {/* Cold wallet display */}
        <div className="rounded-xl border border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.06)] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(160,220,255)] mb-1">
            Cold Vault (signing wallet)
          </div>
          {coldWalletAddress
            ? <div className="font-mono text-sm text-white">{coldWalletAddress}</div>
            : <div className="text-sm text-[var(--muted)]">Connect wallet above to continue</div>
          }
        </div>

        {/* Hot wallet input */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
            Hot / Farcaster Wallet Address
          </label>
          <input
            type="text"
            placeholder="0xFarcasterCustodyAddress…"
            value={hotWallet}
            onChange={e => setHotWallet(e.target.value.trim())}
            className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5 font-mono text-sm text-white placeholder:text-[var(--muted)] focus:border-[rgb(160,220,255)] focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Your Farcaster custody address or any mobile/hot EOA you trust as a proxy.
          </p>
        </div>

        {/* Token ID input */}
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wider">
            {nftCollectionName} Token ID
          </label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 4269"
            value={tokenId}
            onChange={e => setTokenId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2.5 font-mono text-sm text-white placeholder:text-[var(--muted)] focus:border-[rgb(160,220,255)] focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Only this specific token ID will be delegated — your vault remains fully secured.
          </p>
        </div>

        {/* Live delegation status */}
        {checking && (
          <div className="text-[11px] text-[var(--muted)]">Checking existing delegation…</div>
        )}
        {!checking && existingDelegation === true && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
            ✓ Delegation already active for token #{tokenId} → {shortenAddr(hotWallet)}
          </div>
        )}
        {!checking && existingDelegation === false && hotWallet && tokenId && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 px-3 py-2 text-[11px] text-[var(--muted)]">
            No active delegation found — sign below to grant access.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleDelegate}
            disabled={!coldWalletAddress || !hotWallet || !tokenId}
            className="w-full rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {existingDelegation ? '↺ Re-authorise Delegation' : '🔐 Authorise Delegation →'}
          </button>
          {existingDelegation && (
            <button
              onClick={() => setStep('revoke-confirm')}
              className="w-full rounded-xl border border-red-500/20 bg-red-500/8 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/16"
            >
              Revoke Delegation
            </button>
          )}
        </div>

        {/* Info callout */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-[11px] text-[var(--muted)] leading-relaxed space-y-1.5">
          <div className="font-semibold text-white text-xs mb-2">How it works</div>
          <div>🏦 Your NFT stays in cold storage. The hot wallet cannot move or sell it.</div>
          <div>📱 After authorising, open nftmail.box in Warpcast on mobile to chat as your agent.</div>
          <div>🔗 Powered by Delegate V2 — the same registry used by Blur, OpenSea, and Guild.</div>
          <div>⛓ Delegation is revocable on-chain at any time from this panel.</div>
        </div>
      </div>
    );
  }

  // ── Step: confirming ────────────────────────────────────────────────────────
  if (step === 'confirming') {
    return (
      <div className="flex flex-col items-center gap-5 py-8">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-[rgba(0,163,255,0.3)] border-t-[rgb(160,220,255)]" />
        <div className="text-center">
          <div className="text-sm font-semibold text-white mb-1">Waiting for signature…</div>
          <div className="text-[11px] text-[var(--muted)]">
            Confirm the <span className="font-mono text-[rgb(160,220,255)]">delegateERC721</span> transaction in your wallet.
          </div>
        </div>
        <div className="w-full max-w-xs rounded-xl border border-[var(--border)] bg-black/20 p-4 text-[11px] text-[var(--muted)] space-y-1">
          <div className="flex justify-between"><span>Hot wallet</span><span className="font-mono text-white">{shortenAddr(hotWallet)}</span></div>
          <div className="flex justify-between"><span>Token ID</span><span className="font-mono text-white">#{tokenId}</span></div>
          <div className="flex justify-between"><span>Registry</span><span className="font-mono text-white">Delegate V2</span></div>
          <div className="flex justify-between"><span>Rights</span><span className="text-white">All (for this token)</span></div>
        </div>
      </div>
    );
  }

  // ── Step: success ───────────────────────────────────────────────────────────
  if (step === 'success') {
    const miniAppWithHot = `${MINI_APP_URL}?hot=${hotWallet}&vault=${coldWalletAddress}&tokenId=${tokenId}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(miniAppWithHot)}&bgcolor=000000&color=43a574&margin=12`;
    const explorerUrl = txHash ? `${CHAIN_EXPLORER[chain]}/${txHash}` : null;

    return (
      <div className="flex flex-col items-center gap-5 py-4 text-center">
        <div className="text-4xl">🔒</div>
        <div>
          <div className="text-lg font-bold text-white mb-1">Identity Securely Delegated</div>
          <div className="text-[11px] text-[var(--muted)] max-w-xs">
            Your {nftCollectionName} #{tokenId} remains safely in your vault.{' '}
            <span className="text-[rgb(160,220,255)]">{shortenAddr(hotWallet)}</span> can now act as your proxy.
          </div>
        </div>

        {/* QR code for Warpcast deep-link */}
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt="Scan to open nftmail.box in Warpcast"
            className="rounded-xl border border-[rgba(0,163,255,0.3)]"
            width={200}
            height={200}
          />
          <div className="text-[10px] text-[var(--muted)]">
            Scan in Warpcast to open nftmail.box as your proxy
          </div>
        </div>

        <div className="w-full max-w-xs rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-[11px] text-emerald-300 space-y-1">
          <div className="flex justify-between"><span>Delegate</span><span className="font-mono">{shortenAddr(hotWallet)}</span></div>
          <div className="flex justify-between"><span>Token</span><span className="font-mono">{nftCollectionName} #{tokenId}</span></div>
          <div className="flex justify-between"><span>Status</span><span className="font-semibold">Active ✓</span></div>
          {explorerUrl && (
            <div className="flex justify-between">
              <span>Tx</span>
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2">
                {txHash.slice(0, 10)}…
              </a>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button
            onClick={() => { setStep('form'); setTxHash(''); setError(''); }}
            className="w-full rounded-xl border border-[var(--border)] bg-black/20 py-2.5 text-sm text-[var(--muted)] transition hover:text-white"
          >
            Delegate another token
          </button>
          <button
            onClick={() => setStep('revoke-confirm')}
            className="w-full rounded-xl border border-red-500/20 bg-red-500/8 py-2 text-[11px] text-red-400 transition hover:bg-red-500/16"
          >
            Revoke this delegation
          </button>
        </div>
      </div>
    );
  }

  // ── Step: revoke-confirm ────────────────────────────────────────────────────
  if (step === 'revoke-confirm') {
    return (
      <div className="flex flex-col items-center gap-5 py-8 text-center">
        <div className="text-3xl">⚠️</div>
        <div>
          <div className="text-base font-bold text-white mb-1">Revoke Delegation?</div>
          <div className="text-[11px] text-[var(--muted)] max-w-xs">
            This will remove proxy access for <span className="font-mono text-[rgb(160,220,255)]">{shortenAddr(hotWallet)}</span> on {nftCollectionName} #{tokenId}.
            The hot wallet will no longer be able to use this token for nftmail.box.
          </div>
        </div>
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300 w-full max-w-xs">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button
            onClick={handleRevoke}
            className="w-full rounded-xl border border-red-500/30 bg-red-500/10 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
          >
            Yes, Revoke Access
          </button>
          <button
            onClick={() => { setStep('form'); setError(''); }}
            className="w-full rounded-xl border border-[var(--border)] bg-black/20 py-2.5 text-sm text-[var(--muted)] transition hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Step: revoking ──────────────────────────────────────────────────────────
  if (step === 'revoking') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-red-500/30 border-t-red-400" />
        <div className="text-sm text-[var(--muted)]">Revoking delegation…</div>
      </div>
    );
  }

  // ── Step: revoked ───────────────────────────────────────────────────────────
  if (step === 'revoked') {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="text-3xl">🗑️</div>
        <div className="text-base font-bold text-white">Delegation Revoked</div>
        <div className="text-[11px] text-[var(--muted)] max-w-xs">
          {shortenAddr(hotWallet)} no longer has proxy access to {nftCollectionName} #{tokenId}.
        </div>
        <button
          onClick={() => { setStep('form'); setHotWallet(''); setTokenId(''); setTxHash(''); setError(''); setExistingDelegation(null); }}
          className="rounded-xl border border-[var(--border)] bg-black/20 px-4 py-2.5 text-sm text-[var(--muted)] transition hover:text-white"
        >
          ← Back
        </button>
      </div>
    );
  }

  return null;
}
