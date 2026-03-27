'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, decodeEventLog, keccak256, encodePacked, namehash } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, GHOST_REGISTRY, GNO_REGISTRARS } from '../utils/chains';
import GhostRegistryABI from '../abi/GhostRegistry.json';
import NamespaceRegistrarABI from '../abi/NamespaceRegistrar.json';

const GNS_REGISTRY = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as const;
const GNSRegistryABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface MintAgentBundleProps {
  agentName: string;
  safeAddress: `0x${string}`;
  namespace?: string;
  disabled?: boolean;
  ensProof?: { name: string };  // if set, qualifies for free agent.gno mint
  couponCode?: string;          // if set + valid, triggers gasless mint
}

// Namespaces where treasury pays gas — user signs nothing
const GASLESS_NAMESPACES = ['picoclaw'] as const;

type Step = 'idle' | 'gnosis' | 'story' | 'email' | 'done' | 'error';

// nftmail.gno is self-contained: no creation.ip required
const SELF_CONTAINED_NAMESPACES = ['nftmail'] as const;

interface BundleResult {
  tbaAddress?: string;
  gnosisTxHash?: string;
  storyTxHash?: string;
  ipAccount?: string;
  fullDomain?: string;
  email?: string;
}

export function MintAgentBundle({ agentName, safeAddress, namespace = 'agent', disabled = false, ensProof, couponCode }: MintAgentBundleProps) {
  const isSelfContained = (SELF_CONTAINED_NAMESPACES as readonly string[]).includes(namespace);
  const isGasless = (GASLESS_NAMESPACES as readonly string[]).includes(namespace)
    || (namespace === 'agent' && !!ensProof)
    || !!couponCode;
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [step, setStep] = useState<Step>('idle');
  const [result, setResult] = useState<BundleResult>({});
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const mintBundle = useCallback(async () => {
    if (!authenticated || wallets.length === 0) {
      setError('Connect your wallet first');
      return;
    }

    setStep('gnosis');
    setError(null);
    setResult({});

    const wallet = wallets[0];

    try {
      // ── GASLESS PATH: treasury pays gas (picoclaw.gno free tier / ENS-holder agent.gno) ──
      if (isGasless) {
        const gaslessRes = await fetch('/api/gasless-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: agentName,
            owner: wallet.address,
            namespace,
            ...(ensProof   ? { ensProof }   : {}),
            ...(couponCode ? { couponCode }  : {}),
          }),
        });
        const gaslessData = await gaslessRes.json() as {
          success?: boolean;
          txHash?: string;
          tbaAddress?: string;
          fullName?: string;
          email?: string;
          error?: string;
        };
        if (!gaslessData.success || gaslessData.error) {
          throw new Error(gaslessData.error || 'Gasless mint failed');
        }
        setResult({
          tbaAddress: gaslessData.tbaAddress,
          gnosisTxHash: gaslessData.txHash,
          fullDomain: gaslessData.fullName,
          email: gaslessData.email,
        });
        setStep('done');
        setShowModal(true);
        return;
      }

      // ── STANDARD PATH: user signs + pays gas ──────────────────────────────
      await wallet.switchChain(gnosis.id);
      const provider = await wallet.getEthereumProvider();

      const walletClient = createWalletClient({
        chain: gnosis,
        transport: custom(provider),
        account: wallet.address as `0x${string}`,
      });

      const publicClient = createPublicClient({
        chain: gnosis,
        transport: http(),
      });

      // On-chain duplicate check: verify subname doesn't already exist
      const parentNode = namehash(`${namespace}.gno`);
      const labelhash = keccak256(encodePacked(['string'], [agentName]));
      const subnode = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelhash]));
      const existingOwner = await publicClient.readContract({
        address: GNS_REGISTRY,
        abi: GNSRegistryABI,
        functionName: 'owner',
        args: [subnode],
      });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
        throw new Error(`${agentName}.${namespace}.gno is already minted.`);
      }

      // Mint via namespace registrar (owner = user's wallet)
      const registrar = GNO_REGISTRARS[namespace as keyof typeof GNO_REGISTRARS];
      const hash = await walletClient.writeContract({
        address: registrar,
        abi: NamespaceRegistrarABI,
        functionName: 'mintSubname',
        args: [
          agentName,
          wallet.address as `0x${string}`,
          '0x' as `0x${string}`,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let tbaAddress: string | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: NamespaceRegistrarABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'TokenboundAccountCreated') {
            tbaAddress = (decoded.args as any).account;
          }
        } catch {
          // Not our event
        }
      }

      if (!tbaAddress) {
        throw new Error('TBA address not found in mint events');
      }

      setResult(prev => ({ ...prev, tbaAddress, gnosisTxHash: hash }));

      if (isSelfContained) {
        // nftmail.gno: self-contained — skip Story L1, email is auto-routed
        setResult(prev => ({
          ...prev,
          email: `${agentName}.${agentName}@nftmail.box`,
          fullDomain: `${agentName}.${agentName}.nftmail.gno`,
        }));
        setStep('done');
        setShowModal(true);
      } else {
        // ── Step 2 + 3: Server-side Story mint + email provisioning ──
        setStep('story');

        const provisionRes = await fetch('/api/provision-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentName,
            tbaAddress,
            sld: namespace,
            ownerWallet: wallet.address,
          }),
        });

        const provisionData = (await provisionRes.json()) as {
          storyMint?: { txHash: string; ipAccount?: string; fullDomain: string };
          email?: string;
          error?: string;
        };

        if (provisionData.error) {
          throw new Error(provisionData.error);
        }

        setResult(prev => ({
          ...prev,
          storyTxHash: provisionData.storyMint?.txHash,
          ipAccount: provisionData.storyMint?.ipAccount,
          fullDomain: provisionData.storyMint?.fullDomain,
          email: provisionData.email,
        }));

        setStep('done');
        setShowModal(true);
      }
    } catch (err: any) {
      console.error('MintAgentBundle failed:', err);
      setError(err?.shortMessage || err?.message || 'Minting failed');
      setStep('error');
    }
  }, [authenticated, wallets, agentName, safeAddress, isGasless, namespace, ensProof, isSelfContained]);

  if (!authenticated) return null;

  const gnoName = isSelfContained
    ? `${agentName}.${agentName}.nftmail.gno`
    : `${agentName}.${namespace}.gno`;
  const emailName = isSelfContained
    ? `${agentName}.${agentName}@nftmail.box`
    : `${agentName}_@nftmail.box`;
  const ipName = isSelfContained ? null : `${agentName}.creation.ip`;

  const steps = isSelfContained
    ? [
        { key: 'gnosis', label: `Mint ${gnoName}`, chain: 'Gnosis' },
      ]
    : [
        { key: 'gnosis', label: `Mint ${gnoName}`, chain: 'Gnosis' },
        { key: 'story', label: `Mint ${ipName}`, chain: 'Story L1' },
      ];

  const stepIndex = step === 'gnosis' ? 0 : step === 'story' ? 1 : step === 'done' ? 2 : -1;

  return (
    <>
      {/* Progress Steps */}
      {step !== 'idle' && step !== 'error' && (
        <div className="mb-4 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                i < stepIndex
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : i === stepIndex
                  ? 'bg-blue-500/20 text-blue-400 animate-pulse'
                  : 'bg-white/5 text-[var(--muted)]'
              }`}>
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${
                i < stepIndex ? 'text-emerald-400' : i === stepIndex ? 'text-blue-300' : 'text-[var(--muted)]'
              }`}>
                {s.label}
              </span>
              {i < steps.length - 1 && <span className="text-[var(--muted)]">→</span>}
            </div>
          ))}
        </div>
      )}

      {/* Mint Button */}
      <button
        onClick={mintBundle}
        disabled={disabled || (step !== 'idle' && step !== 'error' && step !== 'done')}
        className="flex items-center gap-2 rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-5 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {step === 'idle' || step === 'error' ? (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M12 12h.01" />
              <path d="M17 12h.01" />
              <path d="M7 12h.01" />
            </svg>
            {isGasless ? 'Free Mint — No Gas Required' : 'Mint Agent Bundle'}
          </>
        ) : step === 'done' ? (
          <>
            <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Bundle Complete
          </>
        ) : (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
            </svg>
            {step === 'gnosis' ? 'Minting on Gnosis...' : isSelfContained ? 'Finalizing...' : 'Provisioning on Story + Email...'}
          </>
        )}
      </button>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {/* Success Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            >
              {/* Header */}
              <div className="relative overflow-hidden bg-gradient-to-r from-[rgba(0,163,255,0.15)] via-[rgba(124,77,255,0.15)] to-[rgba(16,185,129,0.15)] px-6 py-5">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Agent Bundle Minted</h3>
                    <p className="text-xs text-[var(--muted)]">{agentName} — {isSelfContained ? 'self-contained identity' : '3-chain identity'}</p>
                  </div>
                </motion.div>
              </div>

              {/* Body */}
              <div className="space-y-4 px-6 py-5">
                {/* Gnosis */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                    GNOSIS — {gnoName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-300">TBA</span>
                    <code className="break-all text-sm text-[rgb(160,220,255)]">
                      {result.tbaAddress}
                    </code>
                    {result.tbaAddress && (
                      <button
                        onClick={() => navigator.clipboard.writeText(result.tbaAddress!)}
                        className="shrink-0 text-xs text-[var(--muted)] hover:text-white"
                      >
                        Copy
                      </button>
                    )}
                  </div>
                  {result.gnosisTxHash && (
                    <a
                      href={`https://gnosisscan.io/tx/${result.gnosisTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--muted)] hover:underline"
                    >
                      {result.gnosisTxHash.slice(0, 10)}...{result.gnosisTxHash.slice(-8)} ↗
                    </a>
                  )}
                </div>

                {/* Story (only for non-self-contained namespaces) */}
                {!isSelfContained && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                      STORY L1 — {ipName}
                    </span>
                    {result.ipAccount && (
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-xs text-violet-300">IP Account</span>
                        <code className="break-all text-xs text-[rgb(200,180,255)]">{result.ipAccount}</code>
                      </div>
                    )}
                    {result.storyTxHash && (
                      <a
                        href={`https://www.storyscan.io/tx/${result.storyTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--muted)] hover:underline"
                      >
                        {result.storyTxHash.slice(0, 10)}...{result.storyTxHash.slice(-8)} ↗
                      </a>
                    )}
                  </div>
                )}

                {/* Email */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                    EMAIL — {emailName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300">Routed</span>
                    <code className="text-sm text-emerald-300">{emailName}</code>
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">Free tier: 8-day history window — inbox address permanent</span>
                </div>

                {/* Flow diagram */}
                <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">{gnoName}</span>
                    {!isSelfContained && (
                      <>
                        <span>→</span>
                        <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{ipName}</span>
                      </>
                    )}
                    <span>→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{emailName}</span>
                  </div>
                  <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                    {isSelfContained
                      ? 'Self-contained — same TBA address, zero dependency on creation.ip.'
                      : 'Same TBA address across all three — zero split, zero migration.'}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg bg-[rgba(0,163,255,0.12)] px-4 py-2 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)]"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
