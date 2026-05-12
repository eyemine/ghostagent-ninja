'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, decodeEventLog, keccak256, encodePacked, namehash } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, GNO_REGISTRARS } from '../utils/chains';
import NamespaceRegistrarABI from '../abi/NamespaceRegistrar.json';

const GNS_REGISTRY = '0xA505e447474bd1774977510e7a7C9459DA79c4b9' as const;
const NFTMAIL_GNO_NAMEHASH = namehash('nftmail.gno');
const GNSRegistryABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

type MintStep = 'idle' | 'minting' | 'done' | 'error';

interface MintResult {
  name: string;
  email: string;
  tbaAddress: string;
  txHash: string;
}

export function MintNFTMail({ onMinted }: { onMinted?: (name: string, tba: string) => void }) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const [name1, setName1] = useState('');
  const [name2, setName2] = useState('');
  const [step, setStep] = useState<MintStep>('idle');
  const [result, setResult] = useState<MintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const registrar = GNO_REGISTRARS.nftmail;
  const label = name1 && name2 ? `${name1}.${name2}` : '';
  const fullGno = label ? `${label}.nftmail.gno` : '';
  const fullEmail = label ? `${label}@nftmail.box` : '';

  const preferredWallet = wallets.find((w: any) => w?.walletClientType === 'injected') || wallets[0];
  const injectedWallet = wallets.find((w: any) => w?.walletClientType === 'injected');

  const mint = useCallback(async () => {
    if (!authenticated || wallets.length === 0) {
      setError('Connect your wallet first');
      return;
    }
    if (!injectedWallet) {
      setError('Connect an external wallet (Rabby/MetaMask). Embedded wallets are not funded for gas.');
      return;
    }
    if (!name1 || name1.length < 2 || !name2 || name2.length < 2) {
      setError('Both name parts must be at least 2 characters');
      return;
    }

    setStep('minting');
    setError(null);

    try {
      const wallet = injectedWallet;
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

      const balanceWei = await publicClient.getBalance({
        address: wallet.address as `0x${string}`,
      });
      if (balanceWei === BigInt(0)) {
        throw new Error(`Wallet ${wallet.address} has 0 xDAI. Fund this wallet or connect a different wallet.`);
      }

      // On-chain duplicate check
      const labelhash = keccak256(encodePacked(['string'], [label]));
      const subnode = keccak256(encodePacked(['bytes32', 'bytes32'], [NFTMAIL_GNO_NAMEHASH, labelhash]));
      const existingOwner = await publicClient.readContract({
        address: GNS_REGISTRY,
        abi: GNSRegistryABI,
        functionName: 'owner',
        args: [subnode],
      });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') {
        throw new Error(`${label}.nftmail.gno is already minted. Choose a different name.`);
      }

      // Mint [name].nftmail.gno → self-contained, no creation.ip
      const hash = await walletClient.writeContract({
        address: registrar,
        abi: NamespaceRegistrarABI,
        functionName: 'mintSubname',
        args: [
          label,
          wallet.address as `0x${string}`,
          '0x',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Extract TBA from TokenboundAccountCreated event
      let tbaAddress = '';
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
        } catch {}
      }

      setResult({
        name: label,
        email: fullEmail,
        tbaAddress,
        txHash: hash,
      });
      setStep('done');
      setShowModal(true);
      onMinted?.(label, tbaAddress);
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || 'Minting failed');
      setStep('error');
    }
  }, [authenticated, wallets, name1, name2, registrar, fullEmail, label, injectedWallet]);

  if (!authenticated) return null;

  return (
    <>
      <div className="space-y-4">
        {/* Name input */}
        <div>
          <label className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">
            CHOOSE YOUR NAME
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              type="text"
              value={name1}
              onChange={(e) => {
                setName1(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                setError(null);
              }}
              placeholder="e.g. alice"
              disabled={step === 'minting'}
              className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
            />
            <input
              type="text"
              value={name2}
              onChange={(e) => {
                setName2(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                setError(null);
              }}
              placeholder="e.g. ops"
              disabled={step === 'minting'}
              className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="text-xs text-[var(--muted)]">
              {name1 || 'name1'}<span className="text-white/30">.</span>{name2 || 'name2'}<span className="text-white/30">.nftmail.gno</span>
            </div>
          </div>
          {label && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-[rgb(160,220,255)]">
                {fullGno} → {fullEmail}
              </p>
              <p className="text-[10px] text-[var(--muted)]">
                Self-contained — same TBA, zero dependency on creation.ip
              </p>
            </div>
          )}
        </div>

        {/* Mint button */}
        <button
          onClick={mint}
          disabled={!label || name1.length < 2 || name2.length < 2 || step === 'minting'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-5 py-3 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] hover:shadow-[0_0_24px_rgba(0,163,255,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {step === 'minting' ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4m0 12v4m-7.07-3.93 2.83-2.83m8.48-8.48 2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83" />
              </svg>
              Minting on Gnosis...
            </>
          ) : step === 'done' ? (
            <>
              <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Minted — {fullEmail}
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M22 8l-10 5L2 8" />
              </svg>
              Mint NFTMail Address
            </>
          )}
        </button>

        {error && <p className="text-center text-xs text-red-400">{error}</p>}

        {/* Tier info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-amber-500/20 bg-[var(--card)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-widest text-amber-300">LITE TIER</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300 ring-1 ring-amber-500/20">10 xDAI one time</span>
            </div>
            <ul className="space-y-1 text-[11px] text-[var(--muted)]">
              <li className="flex items-center gap-1.5"><span className="text-amber-400">·</span> KV sovereign inbox</li>
              <li className="flex items-center gap-1.5"><span className="text-amber-400">·</span> 30-day history</li>
              <li className="flex items-center gap-1.5"><span className="text-amber-400">·</span> Send emails</li>
              <li className="flex items-center gap-1.5"><span className="text-amber-400">·</span> A2A email via Cloudflare Worker</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-[var(--card)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold tracking-widest text-violet-300">PREMIUM TIER</span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-semibold text-violet-300 ring-1 ring-violet-500/20">24 xDAI Annually</span>
            </div>
            <ul className="space-y-1 text-[11px] text-[var(--muted)]">
              <li className="flex items-center gap-1.5"><span className="text-violet-400">·</span> Add Alias email</li>
              <li className="flex items-center gap-1.5"><span className="text-violet-400">·</span> Persistent storage</li>
              <li className="flex items-center gap-1.5"><span className="text-violet-400">·</span> Calendar + tasks</li>
              <li className="flex items-center gap-1.5"><span className="text-violet-400">·</span> Unlimited send</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      <AnimatePresence>
        {showModal && result && (
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
              <div className="relative overflow-hidden bg-gradient-to-r from-[rgba(0,163,255,0.15)] to-emerald-500/15 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    <svg className="h-5 w-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">NFTMail Minted</h3>
                    <p className="text-xs text-[var(--muted)]">{result.name} — self-contained identity</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EMAIL ADDRESS</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-bold text-emerald-300">{result.email}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(result.email)}
                      className="text-xs text-[var(--muted)] hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">GNO DOMAIN</span>
                  <code className="text-sm text-[rgb(160,220,255)]">{result.name}.{result.name}.nftmail.gno</code>
                </div>

                {result.tbaAddress && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TBA</span>
                    <div className="flex items-center gap-2">
                      <code className="break-all text-xs text-[rgb(160,220,255)]">{result.tbaAddress}</code>
                      <button
                        onClick={() => navigator.clipboard.writeText(result.tbaAddress)}
                        className="shrink-0 text-xs text-[var(--muted)] hover:text-white"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TX</span>
                  <a
                    href={`https://gnosisscan.io/tx/${result.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[rgb(160,220,255)] hover:underline"
                  >
                    {result.txHash.slice(0, 14)}...{result.txHash.slice(-8)} ↗
                  </a>
                </div>

                <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">{result.name}.{result.name}.nftmail.gno</span>
                    <span>→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{result.email}</span>
                  </div>
                  <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                    Self-contained — same TBA address, zero dependency on creation.ip.
                  </p>
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
