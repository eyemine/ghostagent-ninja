'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, decodeEventLog, keccak256, encodePacked, namehash } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, GNO_REGISTRARS } from '../utils/chains';
import type { Namespace } from './NamespaceSelect';
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

interface MintButtonProps {
  namespace: Namespace;
  agentName: string;
}

type MintState = 'idle' | 'minting' | 'success' | 'error';

interface InboxStatus {
  agent?: string;
  messages?: any[];
  count?: number;
  error?: string;
}

export function MintButton({ namespace, agentName }: MintButtonProps) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [state, setState] = useState<MintState>('idle');
  const [tbaAddress, setTbaAddress] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [inbox, setInbox] = useState<InboxStatus | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);

  const registrar = GNO_REGISTRARS[namespace];
  const fullName = `${agentName}.${namespace}.gno`;
  const emailName = `${agentName}_@nftmail.box`;

  const checkInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentName }),
      });
      const data = await res.json();
      setInbox(data as InboxStatus);
    } catch {
      setInbox({ error: 'Failed to reach inbox worker' });
    } finally {
      setInboxLoading(false);
    }
  }, [agentName]);

  const mint = useCallback(async () => {
    if (!authenticated || wallets.length === 0) {
      setError('Connect your wallet first');
      return;
    }
    if (!agentName.trim()) {
      setError('Enter an agent name');
      return;
    }

    setState('minting');
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

      // Call registrar.mintSubname(label, owner, storyData, tbaSalt)
      const hash = await walletClient.writeContract({
        address: registrar as `0x${string}`,
        abi: NamespaceRegistrarABI,
        functionName: 'mintSubname',
        args: [
          agentName,
          wallet.address as `0x${string}`,
          '0x' as `0x${string}`,
          '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        ],
      });

      setTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Parse TokenboundAccountCreated event to get TBA address
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: NamespaceRegistrarABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'TokenboundAccountCreated') {
            setTbaAddress((decoded.args as any).account);
          }
        } catch {
          // Not our event
        }
      }

      setState('success');
      setShowModal(true);
    } catch (err: any) {
      console.error('Mint failed:', err);
      setError(err?.shortMessage || err?.message || 'Mint failed');
      setState('error');
    }
  }, [authenticated, wallets, agentName, registrar]);

  if (!authenticated) return null;

  return (
    <>
      <button
        onClick={mint}
        disabled={state === 'minting' || !agentName.trim()}
        className="rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.12)] px-6 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === 'minting' ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
            </svg>
            Minting {fullName}...
          </span>
        ) : state === 'success' ? (
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Minted
          </span>
        ) : (
          `Mint ${agentName.trim() ? fullName : 'Agent'}`
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
              <div className="relative overflow-hidden bg-gradient-to-r from-[rgba(0,163,255,0.15)] to-[rgba(124,77,255,0.15)] px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Agent Minted</h3>
                    <p className="text-xs text-[var(--muted)]">{fullName}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {/* TBA */}
                {tbaAddress && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TOKEN BOUND ACCOUNT (TBA)</span>
                    <div className="flex items-center gap-2">
                      <code className="break-all text-sm text-[rgb(160,220,255)]">{tbaAddress}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(tbaAddress)}
                        className="shrink-0 text-xs text-[var(--muted)] hover:text-white"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                {/* Email */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">AGENT EMAIL</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-emerald-300">{emailName}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(emailName)}
                      className="shrink-0 text-xs text-[var(--muted)] hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">Routed via Cloudflare Worker KV — free tier messages clear after 8 days, inbox address permanent</span>
                </div>

                {/* Tx link */}
                {txHash && (
                  <a
                    href={`https://gnosisscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[rgb(160,220,255)] hover:underline"
                  >
                    {txHash.slice(0, 10)}...{txHash.slice(-8)} ↗
                  </a>
                )}

                {/* Check Inbox */}
                <div className="rounded-lg border border-[var(--border)] bg-black/20 p-3">
                  <button
                    onClick={checkInbox}
                    disabled={inboxLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    {inboxLoading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
                        </svg>
                        Checking...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="4" width="20" height="16" rx="2" />
                          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                        </svg>
                        Check Inbox
                      </>
                    )}
                  </button>
                  {inbox && (
                    <div className="mt-2 text-xs">
                      {inbox.error ? (
                        <span className="text-amber-400">{inbox.error}</span>
                      ) : (
                        <span className="text-[var(--muted)]">
                          {inbox.count === 0
                            ? 'Inbox empty — send an email to ' + emailName + ' to test'
                            : `${inbox.count} message${inbox.count === 1 ? '' : 's'} in inbox`}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Next Steps */}
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                  <div className="text-[10px] font-semibold tracking-wider text-amber-300/70">NEXT STEP</div>
                  <p className="mt-1 text-xs text-amber-300/80">
                    Install Brain module to awaken your agent for A2A email.
                  </p>
                  <a
                    href="/dashboard"
                    className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/15"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4v2H8V6a4 4 0 0 1 4-4z" />
                      <path d="M5 10h14l1 12H4L5 10z" />
                      <circle cx="12" cy="16" r="2" />
                    </svg>
                    Attach Agent → Install Brain
                  </a>
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-[var(--border)] px-6 py-4">
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
