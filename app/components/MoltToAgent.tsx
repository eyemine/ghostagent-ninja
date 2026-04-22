'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, decodeEventLog } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, BRAIN_MODULE, GHOST_REGISTRY } from '../utils/chains';
import BrainModuleABI from '../abi/BrainModule.json';
import GhostRegistryABI from '../abi/GhostRegistry.json';

interface MoltToAgentProps {
  agentName: string;
  tbaAddress: string;
  email: string;
  safeAddress?: `0x${string}`;  // Optional: Safe already exists for BYO NFT molts
  byoOwnerAddress?: `0x${string}`;  // BYO NFT owner (governor) for Safe-first architecture
}

type MoltStep = 'idle' | 'deploying-safe' | 'installing-brain' | 'awakening' | 'done' | 'error';

interface MoltResult {
  safeAddress?: string;
  brainTxHash?: string;
  awakenTxHash?: string;
}

export function MoltToAgent({ agentName, tbaAddress, email, safeAddress, byoOwnerAddress }: MoltToAgentProps) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [step, setStep] = useState<MoltStep>('idle');
  const [result, setResult] = useState<MoltResult>({});
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  // For Safe-first architecture: BYO NFT owner is the governor of the Safe
  // For legacy architecture: TBA is the owner of the Safe
  const safeOwner = byoOwnerAddress ?? tbaAddress;

  const steps: { key: MoltStep; label: string }[] = [
    { key: 'deploying-safe', label: 'Deploy Safe' },
    { key: 'installing-brain', label: 'Install Brain' },
    { key: 'awakening', label: 'Awaken Agent' },
  ];

  const currentIndex = steps.findIndex(s => s.key === step);

  const molt = useCallback(async () => {
    if (!authenticated || wallets.length === 0) {
      setError('Connect your wallet first');
      return;
    }
    if (!tbaAddress) {
      setError('Mint your nftmail.gno identity first');
      return;
    }

    setStep('deploying-safe');
    setError(null);
    setResult({});

    try {
      const wallet = wallets[0];
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

      // Step 1: Register agent in GhostRegistry → deploys Safe + TBA
      // Skip if Safe already exists (for BYO NFT molts with Safe-first architecture)
      let finalSafeAddress: `0x${string}`;
      if (safeAddress) {
        finalSafeAddress = safeAddress;
        setResult(prev => ({ ...prev, safeAddress }));
      } else {
        const registerHash = await walletClient.writeContract({
          address: GHOST_REGISTRY,
          abi: GhostRegistryABI,
          functionName: 'register',
          args: [agentName, wallet.address as `0x${string}`],
        });

        const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });

        let registeredSafeAddress: string | undefined;
        for (const log of registerReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: GhostRegistryABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'Registered') {
              registeredSafeAddress = (decoded.args as any).safe;
            }
          } catch {}
        }

        if (!registeredSafeAddress) {
          throw new Error('Safe address not found in Registered event');
        }

        finalSafeAddress = registeredSafeAddress as `0x${string}`;
        setResult(prev => ({ ...prev, safeAddress: finalSafeAddress }));
      }

      // Step 2: Install Brain module into Safe
      setStep('installing-brain');

      const enableData = encodeFunctionData({
        abi: [{
          name: 'enableModule',
          type: 'function',
          inputs: [{ name: 'module', type: 'address' }],
          outputs: [],
          stateMutability: 'nonpayable',
        }],
        functionName: 'enableModule',
        args: [BRAIN_MODULE],
      });

      // For Safe-first architecture: use BYO NFT owner signature
      // For legacy architecture: use TBA signature
      if (!safeOwner) {
        throw new Error('Safe owner address required');
      }
      const ownerSig = (
        safeOwner.toLowerCase().padEnd(66, '0').slice(0, 66) +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '01'
      ) as `0x${string}`;

      const brainHash = await walletClient.writeContract({
        address: finalSafeAddress,
        abi: [{
          name: 'execTransaction',
          type: 'function',
          inputs: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
            { name: 'operation', type: 'uint8' },
            { name: 'safeTxGas', type: 'uint256' },
            { name: 'baseGas', type: 'uint256' },
            { name: 'gasPrice', type: 'uint256' },
            { name: 'gasToken', type: 'address' },
            { name: 'refundReceiver', type: 'address' },
            { name: 'signatures', type: 'bytes' },
          ],
          outputs: [{ name: 'success', type: 'bool' }],
          stateMutability: 'nonpayable',
        }],
        functionName: 'execTransaction',
        args: [
          finalSafeAddress,
          BigInt(0),
          enableData,
          0,
          BigInt(0),
          BigInt(0),
          BigInt(0),
          '0x0000000000000000000000000000000000000000' as `0x${string}`,
          '0x0000000000000000000000000000000000000000' as `0x${string}`,
          ownerSig,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: brainHash });
      setResult(prev => ({ ...prev, brainTxHash: brainHash }));

      // Step 3: Awaken agent via BrainModule
      setStep('awakening');

      // For Safe-first architecture: TBA is no longer owner, pass Safe address as both safe and tba
      // For legacy architecture: pass TBA address as tba
      const tbaParam = byoOwnerAddress ? finalSafeAddress : tbaAddress;
      if (!tbaParam) {
        throw new Error('TBA address required for awaken call');
      }

      const awakenHash = await walletClient.writeContract({
        address: BRAIN_MODULE,
        abi: BrainModuleABI,
        functionName: 'awaken',
        args: [finalSafeAddress, agentName],
      });

      await publicClient.waitForTransactionReceipt({ hash: awakenHash });
      setResult(prev => ({ ...prev, awakenTxHash: awakenHash }));

      setStep('done');
      setShowModal(true);
    } catch (err: any) {
      console.error('Molt failed:', err);
      setError(err?.shortMessage || err?.message || 'Molt failed');
      setStep('error');
    }
  }, [authenticated, wallets, agentName, tbaAddress, safeAddress, byoOwnerAddress, safeOwner]);

  if (!authenticated) return null;

  return (
    <>
      <div className="space-y-4">
        {/* What you get */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-3 text-center">
            <div className="text-lg font-bold text-[rgb(160,220,255)]">Safe</div>
            <p className="mt-1 text-[10px] text-[var(--muted)]">Gnosis Safe vault — multi-sig treasury</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-3 text-center">
            <div className="text-lg font-bold text-violet-300">Brain</div>
            <p className="mt-1 text-[10px] text-[var(--muted)]">Safe module — autonomous execution</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-3 text-center">
            <div className="text-lg font-bold text-emerald-300">A2A</div>
            <p className="mt-1 text-[10px] text-[var(--muted)]">Agent-to-agent email wire</p>
          </div>
        </div>

        {/* Progress steps */}
        {step !== 'idle' && step !== 'error' && (
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  i < currentIndex || step === 'done'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : i === currentIndex
                    ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                    : 'bg-white/5 text-[var(--muted)]'
                }`}>
                  {i < currentIndex || step === 'done' ? '✓' : i + 1}
                </div>
                <span className={`text-xs ${
                  i < currentIndex || step === 'done'
                    ? 'text-emerald-400'
                    : i === currentIndex
                    ? 'text-amber-300'
                    : 'text-[var(--muted)]'
                }`}>
                  {s.label}
                </span>
                {i < steps.length - 1 && <span className="text-[var(--muted)]">→</span>}
              </div>
            ))}
          </div>
        )}

        {/* Molt button */}
        <button
          onClick={molt}
          disabled={step !== 'idle' && step !== 'error' && step !== 'done'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-5 py-3.5 text-sm font-semibold text-amber-200 transition-all hover:bg-amber-500/15 hover:shadow-[0_0_24px_rgba(245,158,11,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {step === 'idle' || step === 'error' ? (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              Molt to Full Agent
            </>
          ) : step === 'done' ? (
            <>
              <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Agent Awakened
            </>
          ) : (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
              </svg>
              {step === 'deploying-safe' ? 'Deploying Safe...' : step === 'installing-brain' ? 'Installing Brain...' : 'Awakening Agent...'}
            </>
          )}
        </button>

        {error && <p className="text-center text-xs text-red-400">{error}</p>}

        {/* Pathway diagram */}
        <div className="rounded-xl border border-[var(--border)] bg-black/20 px-4 py-3">
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--muted)]">
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">nftmail.gno</span>
            <span>→</span>
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">+ Safe</span>
            <span>→</span>
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">+ Brain</span>
            <span>→</span>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">Full Agent</span>
          </div>
          <p className="mt-2 text-center text-[10px] text-[var(--muted)]">
            Same TBA, same email — your nftmail identity evolves into a full autonomous agent.
          </p>
        </div>
      </div>

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
              className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            >
              <div className="relative overflow-hidden bg-gradient-to-r from-amber-500/15 via-violet-500/15 to-emerald-500/15 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Agent Molted</h3>
                    <p className="text-xs text-[var(--muted)]">{agentName} is now a full autonomous agent</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {result.safeAddress && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">GNOSIS SAFE</span>
                    <div className="flex items-center gap-2">
                      <code className="break-all text-sm text-[rgb(160,220,255)]">{result.safeAddress}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(result.safeAddress!)}
                        className="shrink-0 text-xs text-[var(--muted)] hover:text-white"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EMAIL</span>
                  <code className="text-sm text-emerald-300">{email}</code>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TBA</span>
                  <code className="break-all text-xs text-[var(--muted)]">{tbaAddress}</code>
                </div>

                {result.awakenTxHash && (
                  <a
                    href={`https://gnosisscan.io/tx/${result.awakenTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[rgb(160,220,255)] hover:underline"
                  >
                    Awaken tx: {result.awakenTxHash.slice(0, 14)}...{result.awakenTxHash.slice(-8)} ↗
                  </a>
                )}

                <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                  <div className="flex items-center justify-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">nftmail.gno</span>
                    <span>→</span>
                    <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">Safe</span>
                    <span>→</span>
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Brain</span>
                    <span>→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">Awakened</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
                <a
                  href="/dashboard"
                  className="rounded-lg bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Go to Dashboard →
                </a>
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
