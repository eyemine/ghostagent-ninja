'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, decodeEventLog } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, BRAIN_MODULE, GHOST_REGISTRY } from '../utils/chains';
import BrainModuleABI from '../abi/BrainModule.json';
import GhostRegistryABI from '../abi/GhostRegistry.json';

interface InstallBrainProps {
  agentName: string;
  safeAddress: `0x${string}`;
  tbaAddress?: `0x${string}`;  // Optional for Safe-first architecture (BYO NFT owner is governor)
  byoOwnerAddress?: `0x${string}`;  // BYO NFT owner (governor) for Safe-first architecture
}

type BrainStep = 'idle' | 'installing' | 'awakening' | 'done' | 'error';

export function InstallBrain({ agentName, safeAddress, tbaAddress, byoOwnerAddress }: InstallBrainProps) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [step, setStep] = useState<BrainStep>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  // For Safe-first architecture: BYO NFT owner is the governor of the Safe
  // For legacy architecture: TBA is the owner of the Safe
  const safeOwner = byoOwnerAddress ?? tbaAddress;

  const installBrain = useCallback(async () => {
    if (!authenticated || wallets.length === 0) {
      setError('Connect your wallet first');
      return;
    }

    setStep('installing');
    setError(null);

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

      // Step 1: Install Brain as module on Safe
      // The GhostRegistry is already a module on the Safe, so we use it
      // to call Safe.enableModule(brainAddress) via execTransactionFromModule
      const enableModuleData = encodeFunctionData({
        abi: [{ name: 'enableModule', type: 'function', inputs: [{ name: 'module', type: 'address' }], outputs: [], stateMutability: 'nonpayable' }],
        functionName: 'enableModule',
        args: [BRAIN_MODULE],
      });

      // Call via GhostRegistry which is already an enabled module on the Safe
      // GhostRegistry._execFromModule is private, so we need the Safe owner (TBA) to call directly
      // Since TBA is owned by the NFT holder (msg.sender), we call Safe.enableModule directly
      // But Safe.enableModule can only be called by the Safe itself or a module
      // So we need to go through the existing module (GhostRegistry)
      //
      // Alternative: user signs a Safe tx via the Safe Transaction Service
      // For MVP: we call enableModule via the Safe's execTransaction (requires owner sig)

      // The TBA owns the Safe. The user owns the NFT which controls the TBA.
      // For MVP, we encode enableModule and send it as a Safe transaction.
      const safeExecABI = [{
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
      }];

      // For a single-owner Safe where TBA is the owner (or BYO NFT owner is governor),
      // we can use a pre-approved hash signature (r=owner, s=0, v=1)
      if (!safeOwner) {
        throw new Error('Safe owner address required');
      }
      const ownerSig = (
        safeOwner.toLowerCase().padEnd(66, '0').slice(0, 66) +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '01'
      ) as `0x${string}`;

      const installHash = await walletClient.writeContract({
        address: safeAddress,
        abi: safeExecABI,
        functionName: 'execTransaction',
        args: [
          safeAddress,        // to: Safe calls itself
          BigInt(0),          // value
          enableModuleData,   // data: enableModule(brain)
          0,                  // operation: Call
          BigInt(0),          // safeTxGas
          BigInt(0),          // baseGas
          BigInt(0),          // gasPrice
          '0x0000000000000000000000000000000000000000' as `0x${string}`, // gasToken
          '0x0000000000000000000000000000000000000000' as `0x${string}`, // refundReceiver
          ownerSig,           // signatures
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: installHash });

      // Step 2: Awaken the agent
      setStep('awakening');

      // For Safe-first architecture: TBA is no longer owner, pass Safe address as both safe and tba
      // For legacy architecture: pass TBA address as tba
      const tbaParam = byoOwnerAddress ? safeAddress : tbaAddress;
      if (!tbaParam) {
        throw new Error('TBA address required for awaken call');
      }

      const awakenHash = await walletClient.writeContract({
        address: BRAIN_MODULE,
        abi: BrainModuleABI,
        functionName: 'awaken',
        args: [agentName, safeAddress, tbaParam],
      });

      setTxHash(awakenHash);
      await publicClient.waitForTransactionReceipt({ hash: awakenHash });

      setStep('done');
      setShowModal(true);
    } catch (err: any) {
      console.error('Install Brain failed:', err);
      setError(err?.shortMessage || err?.message || 'Installation failed');
      setStep('error');
    }
  }, [authenticated, wallets, agentName, safeAddress, tbaAddress, byoOwnerAddress, safeOwner]);

  if (!authenticated) return null;

  const emailName = `${agentName}_@nftmail.box`;

  return (
    <>
      {/* Progress */}
      {step !== 'idle' && step !== 'error' && step !== 'done' && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            step === 'installing' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'
          }`}>
            {step === 'awakening' ? '✓' : '1'}
          </div>
          <span className={step === 'installing' ? 'text-amber-300' : 'text-emerald-400'}>Install Module</span>
          <span className="text-[var(--muted)]">→</span>
          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
            step === 'awakening' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-white/5 text-[var(--muted)]'
          }`}>
            2
          </div>
          <span className={step === 'awakening' ? 'text-amber-300' : 'text-[var(--muted)]'}>Awaken</span>
        </div>
      )}

      {/* Install Button */}
      <button
        onClick={installBrain}
        disabled={step !== 'idle' && step !== 'error' && step !== 'done'}
        className="flex items-center gap-2 rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.08)] px-5 py-3 text-sm font-semibold text-amber-300 transition hover:bg-[rgba(251,191,36,0.14)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {step === 'idle' || step === 'error' ? (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4v2H8V6a4 4 0 0 1 4-4z" />
              <path d="M5 10h14l1 12H4L5 10z" />
              <circle cx="12" cy="16" r="2" />
            </svg>
            Install Brain
          </>
        ) : step === 'done' ? (
          <>
            <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Awakened
          </>
        ) : (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
            </svg>
            {step === 'installing' ? 'Installing Module...' : 'Awakening...'}
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
              className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            >
              {/* Header */}
              <div className="relative overflow-hidden bg-gradient-to-r from-[rgba(251,191,36,0.15)] to-[rgba(16,185,129,0.15)] px-6 py-5">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2, type: 'spring' }}
                  className="flex items-center gap-3"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
                    <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4v2H8V6a4 4 0 0 1 4-4z" />
                      <path d="M5 10h14l1 12H4L5 10z" />
                      <circle cx="12" cy="16" r="2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Agent Awakened</h3>
                    <p className="text-xs text-[var(--muted)]">{agentName} is now alive</p>
                  </div>
                </motion.div>
              </div>

              {/* Body */}
              <div className="space-y-4 px-6 py-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">BRAIN MODULE</span>
                  <code className="break-all text-xs text-amber-300">{BRAIN_MODULE}</code>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">SAFE</span>
                  <code className="break-all text-xs text-[var(--muted)]">{safeAddress}</code>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">A2A EMAIL</span>
                  <code className="text-sm text-emerald-300">{emailName}</code>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">FLOW</span>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Brain Installed</span>
                    <span>→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">Awakened</span>
                    <span>→</span>
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">A2A Active</span>
                  </div>
                </div>

                {txHash && (
                  <a
                    href={`https://gnosisscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--muted)] hover:underline"
                  >
                    {txHash.slice(0, 10)}...{txHash.slice(-8)} ↗
                  </a>
                )}

                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <p className="text-xs text-amber-300/80">
                    Brain module installed into Safe. Agent is now Awakened and can receive/send A2A email via {emailName}.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end border-t border-[var(--border)] px-6 py-4">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg bg-[rgba(251,191,36,0.12)] px-4 py-2 text-xs font-semibold text-amber-300 transition hover:bg-[rgba(251,191,36,0.2)]"
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
