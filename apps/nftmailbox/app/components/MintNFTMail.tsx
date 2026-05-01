'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { createWalletClient, createPublicClient, custom, http, decodeEventLog, keccak256, encodePacked, namehash } from 'viem';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { gnosis, GNO_REGISTRARS } from '../utils/chains';
import NamespaceRegistrarABI from '../abi/NamespaceRegistrar.json';

type MintStep = 'idle' | 'minting' | 'done' | 'error';
type MintMode = 'gasless' | 'wallet';
type NameStatus = 'idle' | 'checking' | 'available' | 'taken';

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

interface MintResult {
  name: string;
  email: string;
  tbaAddress: string;
  txHash: string;
  gasless?: boolean;
}

// Reusable availability checker hook
function useNameAvailability(label: string, emailLocal: string, enabled: boolean): NameStatus {
  const [status, setStatus] = useState<NameStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!enabled || !label || label.length < 2) { setStatus('idle'); return; }
    setStatus('checking');
    timer.current = setTimeout(async () => {
      try {
        let taken = false;
        try {
          const publicClient = createPublicClient({ chain: gnosis, transport: http() });
          const labelhash = keccak256(encodePacked(['string'], [label]));
          const subnode = keccak256(encodePacked(['bytes32', 'bytes32'], [NFTMAIL_GNO_NAMEHASH, labelhash]));
          const owner = await publicClient.readContract({ address: GNS_REGISTRY, abi: GNSRegistryABI, functionName: 'owner', args: [subnode] });
          taken = !!(owner && owner !== '0x0000000000000000000000000000000000000000');
        } catch {}
        if (taken) { setStatus('taken'); return; }
        try {
          const res = await fetch('https://nftmail-email-worker.richard-159.workers.dev', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resolveAddress', name: emailLocal }),
          });
          const data = await res.json() as any;
          if (data.exists) { setStatus('taken'); return; }
        } catch {}
        setStatus('available');
      } catch { setStatus('idle'); }
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [label, emailLocal, enabled]);
  return status;
}

export function MintNFTMail({ initialName }: { initialName?: string } = {}) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  // Detect ENS single-word claim (e.g. "rgbanksy") vs two-part (e.g. "mac.slave")
  const parseInitial = (v?: string): [string, string] => {
    if (!v) return ['', ''];
    const clean = v.toLowerCase().replace(/[^a-z0-9-.]/g, '');
    const sep = clean.indexOf('.') !== -1 ? '.' : clean.indexOf('-') !== -1 ? '-' : null;
    if (sep) { const idx = clean.indexOf(sep); return [clean.slice(0, idx), clean.slice(idx + 1)]; }
    return [clean, ''];
  };
  const [initN1, initN2] = parseInitial(initialName);
  // isEnsClaim: initialName is a single word with no separator → show dual card layout
  const isEnsClaim = !!(initialName && !initN2);

  // Standard (non-ENS) state
  const [name1, setName1] = useState(initN1);
  const [name2, setName2] = useState(initN2);

  // ENS dual-card: Card A = single name (initN1), Card B = split (initN1 + cardBPart2)
  const [cardBPart2, setCardBPart2] = useState('eth');

  const [step, setStep] = useState<MintStep>('idle');
  const [stepB, setStepB] = useState<MintStep>('idle');
  const [claimStep, setClaimStep] = useState<MintStep>('idle');
  const [claimStepC, setClaimStepC] = useState<MintStep>('idle');
  const [termsAgreed, setTermsAgreed] = useState(false);

  // Card C: collection NFT picker
  interface WalletNft { type: 'ens' | 'collection'; name: string; displayName: string; email: string; tokenId?: string; collection?: string; }
  const [collectionNfts, setCollectionNfts] = useState<WalletNft[]>([]);
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null);
  const [claimResultC, setClaimResultC] = useState<{ email: string } | null>(null);
  const [nftScanLoading, setNftScanLoading] = useState(false);
  const [result, setResult] = useState<MintResult | null>(null);
  const [resultB, setResultB] = useState<MintResult | null>(null);
  const [claimResult, setClaimResult] = useState<{ email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [mintMode, setMintMode] = useState<MintMode>('gasless');

  const registrar = GNO_REGISTRARS.nftmail;

  // Standard path derived values
  const isSingleName = !!(name1 && !name2);
  const label = name1 && name2 ? `${name1}-${name2}` : name1 ? name1 : '';
  const emailLocal = name1 && name2 ? `${name1}.${name2}` : name1 ? name1 : '';
  const fullGno = label ? `${label}.nftmail.gno` : '';
  const fullEmail = emailLocal ? `${emailLocal}@nftmail.box` : '';

  // ENS Card A: single-name
  const cardALabel = initN1;
  const cardAEmail = `${initN1}@nftmail.box`;
  // ENS Card B: split
  const cardBPart2Clean = cardBPart2.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const cardBLabel = cardBPart2Clean ? `${initN1}-${cardBPart2Clean}` : '';
  const cardBEmailLocal = cardBPart2Clean ? `${initN1}.${cardBPart2Clean}` : '';
  const cardBEmail = cardBEmailLocal ? `${cardBEmailLocal}@nftmail.box` : '';
  const cardBGno = cardBLabel ? `${cardBLabel}.nftmail.gno` : '';

  const injectedWallet = wallets.find((w: any) => w?.walletClientType === 'injected');
  const anyWallet = wallets[0];

  // Availability checks
  const statusA = useNameAvailability(cardALabel, initN1, isEnsClaim && initN1.length >= 2);
  const statusB = useNameAvailability(cardBLabel, cardBEmailLocal, isEnsClaim && cardBLabel.length >= 2);
  const nameStatus = useNameAvailability(label, emailLocal, !isEnsClaim && label.length >= 2 && (isSingleName || name2.length >= 2));

  // Generic gasless mint for any label
  const doGaslessMint = useCallback(async (
    mintLabel: string,
    mintEmail: string,
    setS: (s: MintStep) => void,
    setR: (r: MintResult) => void,
  ) => {
    const ownerAddress = (injectedWallet || anyWallet)?.address;
    if (!ownerAddress) { setError('No wallet address found'); return; }
    setS('minting');
    setError(null);
    try {
      const res = await fetch('/api/gasless-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: mintLabel, owner: ownerAddress }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gasless mint failed');
      setR({ name: mintLabel, email: mintEmail, tbaAddress: data.tbaAddress || '', txHash: data.txHash, gasless: true });
      setS('done');
      setShowModal(true);
      // Log terms agreement to Glass Box Audit (non-blocking)
      fetch('/api/record-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: ownerAddress, email: mintEmail }),
      }).catch(() => {});
    } catch (err: any) {
      setError(err?.message || 'Gasless mint failed');
      setS('error');
    }
  }, [injectedWallet, anyWallet]);

  // Generic wallet mint for any label
  const doWalletMint = useCallback(async (
    mintLabel: string,
    mintEmail: string,
    setS: (s: MintStep) => void,
    setR: (r: MintResult) => void,
  ) => {
    if (!injectedWallet) { setError('Connect an external wallet (Rabby/MetaMask). Embedded wallets are not funded for gas.'); return; }
    setS('minting');
    setError(null);
    try {
      const wallet = injectedWallet;
      await wallet.switchChain(gnosis.id);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider), account: wallet.address as `0x${string}` });
      const publicClient = createPublicClient({ chain: gnosis, transport: http() });
      const balanceWei = await publicClient.getBalance({ address: wallet.address as `0x${string}` });
      if (balanceWei === BigInt(0)) throw new Error(`Wallet ${wallet.address} has 0 xDAI.`);
      const labelhash = keccak256(encodePacked(['string'], [mintLabel]));
      const subnode = keccak256(encodePacked(['bytes32', 'bytes32'], [NFTMAIL_GNO_NAMEHASH, labelhash]));
      const existingOwner = await publicClient.readContract({ address: GNS_REGISTRY, abi: GNSRegistryABI, functionName: 'owner', args: [subnode] });
      if (existingOwner && existingOwner !== '0x0000000000000000000000000000000000000000') throw new Error(`${mintLabel}.nftmail.gno is already minted.`);
      const hash = await walletClient.writeContract({
        address: registrar, abi: NamespaceRegistrarABI, functionName: 'mintSubname',
        args: [mintLabel, wallet.address as `0x${string}`, '0x', '0x0000000000000000000000000000000000000000000000000000000000000000'],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      let tbaAddress = '';
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: NamespaceRegistrarABI, data: log.data, topics: log.topics });
          if (decoded.eventName === 'TokenboundAccountCreated') tbaAddress = (decoded.args as any).account;
        } catch {}
      }
      setR({ name: mintLabel, email: mintEmail, tbaAddress, txHash: hash });
      setS('done');
      setShowModal(true);
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || 'Minting failed');
      setS('error');
    }
  }, [injectedWallet, registrar]);

  // Standard (non-ENS) mint
  const mint = useCallback(async () => {
    if (!authenticated || wallets.length === 0) { setError('Connect your wallet first'); return; }
    if (!label || name1.length < 2) { setError('Name must be at least 2 characters'); return; }
    if (!isSingleName && (!name2 || name2.length < 2)) { setError('Second name part must be at least 2 characters'); return; }
    if (mintMode === 'gasless') await doGaslessMint(label, fullEmail, setStep, setResult);
    else await doWalletMint(label, fullEmail, setStep, setResult);
  }, [authenticated, wallets, label, name1, name2, isSingleName, mintMode, fullEmail, doGaslessMint, doWalletMint]);

  // Scan wallet for collection NFTs on mount (when isEnsClaim)
  useEffect(() => {
    if (!isEnsClaim) return;
    const ownerAddress = (injectedWallet || anyWallet)?.address;
    if (!ownerAddress) return;
    setNftScanLoading(true);
    fetch(`/api/scan-wallet-nfts?address=${encodeURIComponent(ownerAddress)}`)
      .then(r => r.json())
      .then((data: any) => {
        const cols: WalletNft[] = (data.nfts || []).filter((n: WalletNft) => n.type === 'collection');
        setCollectionNfts(cols);
        if (cols.length > 0) setSelectedNft(cols[0]);
      })
      .catch(() => {})
      .finally(() => setNftScanLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnsClaim, (injectedWallet || anyWallet)?.address]);

  // Card C: sovereign claim for a selected collection NFT
  const claimCardC = useCallback(async () => {
    if (!authenticated || wallets.length === 0) { setError('Connect your wallet first'); return; }
    if (!selectedNft) { setError('Select an NFT first'); return; }
    const ownerAddress = (injectedWallet || anyWallet)?.address;
    if (!ownerAddress) { setError('No wallet address found'); return; }
    setClaimStepC('minting');
    setError(null);
    try {
      const res = await fetch('/api/claim-sovereign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyType: 'nft-collection',
          keyId: `${selectedNft.collection}.${selectedNft.tokenId}`,
          ownerAddress,
          claimedEmail: selectedNft.email,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      setClaimResultC({ email: selectedNft.email });
      setClaimStepC('done');
    } catch (err: any) {
      setError(err?.message || 'Claim failed');
      setClaimStepC('error');
    }
  }, [authenticated, wallets, injectedWallet, anyWallet, selectedNft]);

  // ENS Card A: sovereign claim (no on-chain tx — ENS is the key)
  const claimCardA = useCallback(async () => {
    if (!authenticated || wallets.length === 0) { setError('Connect your wallet first'); return; }
    const ownerAddress = (injectedWallet || anyWallet)?.address;
    if (!ownerAddress) { setError('No wallet address found'); return; }
    setClaimStep('minting');
    setError(null);
    try {
      const res = await fetch('/api/claim-sovereign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyType: 'ens',
          keyId: `${initN1}.eth`,
          ownerAddress,
          claimedEmail: cardAEmail,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.error || 'Claim failed');
      setClaimResult({ email: cardAEmail });
      setClaimStep('done');
    } catch (err: any) {
      setError(err?.message || 'Claim failed');
      setClaimStep('error');
    }
  }, [authenticated, wallets, injectedWallet, anyWallet, initN1, cardAEmail]);

  // ENS Card B mint (split)
  const mintCardB = useCallback(async () => {
    if (!authenticated || wallets.length === 0) { setError('Connect your wallet first'); return; }
    if (!cardBLabel) { setError('Enter a second part first'); return; }
    if (mintMode === 'gasless') await doGaslessMint(cardBLabel, cardBEmail, setStepB, setResultB);
    else await doWalletMint(cardBLabel, cardBEmail, setStepB, setResultB);
  }, [authenticated, wallets, mintMode, cardBLabel, cardBEmail, doGaslessMint, doWalletMint]);

  const HINT = 'Free – 8-day inbox, receive only. Evolve to Pupa or Imago to Molt.';

  // ── Claim button (sovereign path — no NFT minted) ──
  const ClaimButton = ({ email }: { email: string }) => {
    if (claimStep === 'done' && claimResult) {
      return (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            <span className="text-sm font-semibold text-emerald-300">{claimResult.email}</span>
          </div>
          <Link
            href={`/inbox/${encodeURIComponent(claimResult.email.replace('@nftmail.box', ''))}`}
            className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] whitespace-nowrap"
          >Open Inbox →</Link>
        </div>
      );
    }
    return (
      <button
        onClick={claimCardA}
        disabled={claimStep === 'minting' || statusA === 'taken' || statusA === 'checking'}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/8 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/16 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {claimStep === 'minting' ? 'Activating inbox...' : `Claim – ${email}`}
      </button>
    );
  };

  if (!authenticated) return null;

  // ── Shared mint mode toggle ──
  const MintModeToggle = () => (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => setMintMode('gasless')}
        className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold tracking-wider transition ${
          mintMode === 'gasless' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-[var(--muted)] hover:text-white/60'
        }`}
      >FREE MINT</button>
      <button
        onClick={() => setMintMode('wallet')}
        className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold tracking-wider transition ${
          mintMode === 'wallet' ? 'bg-[rgba(0,163,255,0.15)] text-[rgb(160,220,255)] border border-[rgba(0,163,255,0.35)]' : 'text-[var(--muted)] hover:text-white/60'
        }`}
      >PAY GAS</button>
    </div>
  );

  // ── Mint button / success row for a given card ──
  const MintButton = ({
    cardStep, cardResult, onMint, mintLabel, mintEmail, status, disabled: extraDisabled,
  }: {
    cardStep: MintStep; cardResult: MintResult | null; onMint: () => void;
    mintLabel: string; mintEmail: string; status: NameStatus; disabled?: boolean;
  }) => {
    if (cardStep === 'done' && cardResult) {
      return (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            <span className="text-sm font-semibold text-emerald-300">{cardResult.email}</span>
          </div>
          <Link
            href={`/dashboard?email=${encodeURIComponent(cardResult.email)}`}
            className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] whitespace-nowrap"
          >Dashboard →</Link>
        </div>
      );
    }
    return (
      <button
        onClick={onMint}
        disabled={extraDisabled || !mintLabel || cardStep === 'minting' || status === 'taken' || status === 'checking'}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
          mintMode === 'gasless'
            ? 'border-emerald-500/35 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/16'
            : 'border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] text-[rgb(160,220,255)] hover:bg-[rgba(0,163,255,0.16)]'
        }`}
      >
        {cardStep === 'minting' ? 'Minting on Gnosis...' : `Mint – ${mintEmail}`}
      </button>
    );
  };

  // ── Status badge ──
  const StatusBadge = ({ status }: { status: NameStatus }) => (
    <>
      {status === 'checking' && <span className="text-[10px] text-[var(--muted)] animate-pulse">checking...</span>}
      {status === 'available' && <span className="text-[10px] text-emerald-400 font-semibold">✓ available</span>}
      {status === 'taken' && <span className="text-[10px] text-red-400 font-semibold">✗ already taken</span>}
    </>
  );

  return (
    <>
      <div className="space-y-4">
        <label className="text-[10px] font-semibold tracking-[0.18em] text-[var(--muted)]">
          {initialName ? 'CREATE A NEW NFT' : 'CHOOSE YOUR NAME'}
        </label>

        {isEnsClaim ? (
          /* ── ENS dual-card layout ── */
          <div className="space-y-4">
            <MintModeToggle />
            {mintMode === 'gasless' && (
              <p className="text-center text-[10px] text-emerald-300/60">No xDAI needed — gas sponsored by NFTMail treasury</p>
            )}

            {/* Card A: sovereign claim — ENS is the key, no NFT minted */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span className="text-[9px] font-semibold tracking-wider text-emerald-300">SOVEREIGN CLAIM — NO NFT MINTED</span>
              </div>
              <input
                type="text"
                value={`${initN1}.eth  →  ${cardAEmail}`}
                readOnly
                className="w-full rounded-lg border border-emerald-500/20 bg-black/40 px-4 py-2.5 text-sm text-emerald-200 outline-none opacity-80 cursor-default"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20 whitespace-nowrap">Authority: {initN1}.eth</span>
                <StatusBadge status={statusA} />
              </div>
              <p className="text-[10px] text-[var(--muted)]">{HINT}</p>
              <ClaimButton email={cardAEmail} />
            </div>

            {/* Card C: verified NFT collection claim */}
            {(collectionNfts.length > 0 || nftScanLoading) && (
              <div className="rounded-xl border border-[rgba(0,163,255,0.2)] bg-[rgba(0,163,255,0.04)] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 text-[rgb(160,220,255)] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                  <span className="text-[9px] font-semibold tracking-wider text-[rgb(160,220,255)]">VERIFIED NFT — SOVEREIGN CLAIM</span>
                </div>
                {nftScanLoading ? (
                  <p className="text-[11px] text-[var(--muted)] animate-pulse">Scanning wallet for verified NFTs...</p>
                ) : (
                  <>
                    <select
                      value={selectedNft?.email || ''}
                      onChange={e => setSelectedNft(collectionNfts.find(n => n.email === e.target.value) || null)}
                      disabled={claimStepC === 'minting'}
                      className="w-full rounded-lg border border-[rgba(0,163,255,0.25)] bg-black/40 px-4 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                    >
                      {collectionNfts.map(n => (
                        <option key={n.email} value={n.email}>{n.displayName} → {n.email}</option>
                      ))}
                    </select>
                    {selectedNft && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full bg-[rgba(0,163,255,0.1)] px-2 py-0.5 text-[9px] font-semibold text-[rgb(160,220,255)] ring-1 ring-[rgba(0,163,255,0.2)] whitespace-nowrap">Authority: {selectedNft.displayName}</span>
                      </div>
                    )}
                    <p className="text-[10px] text-[var(--muted)]">{HINT}</p>
                    {claimStepC === 'done' && claimResultC ? (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <svg className="h-4 w-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          <span className="text-sm font-semibold text-emerald-300">{claimResultC.email}</span>
                        </div>
                        <Link
                          href={`/inbox/${encodeURIComponent(claimResultC.email.replace('@nftmail.box', '').replace('.', '.'))}`}
                          className="rounded-lg border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] whitespace-nowrap"
                        >Open Inbox →</Link>
                      </div>
                    ) : (
                      <button
                        onClick={claimCardC}
                        disabled={!selectedNft || claimStepC === 'minting'}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(0,163,255,0.35)] bg-[rgba(0,163,255,0.08)] px-4 py-2.5 text-sm font-semibold text-[rgb(160,220,255)] transition-all hover:bg-[rgba(0,163,255,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {claimStepC === 'minting' ? 'Activating inbox...' : selectedNft ? `Claim – ${selectedNft.email}` : 'Select an NFT'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Card B: split with ENS TLD */}
            <div className="rounded-xl border border-[var(--border)] bg-black/20 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={initN1}
                  readOnly
                  className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white outline-none opacity-70 cursor-default"
                />
                <input
                  type="text"
                  value={cardBPart2}
                  onChange={(e) => setCardBPart2(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="eth"
                  disabled={stepB === 'minting'}
                  className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                />
              </div>
              {cardBLabel && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20 whitespace-nowrap">Mint New NFT</span>
                  <p className="text-xs text-[rgb(160,220,255)]">{cardBGno} → {cardBEmail}</p>
                  <StatusBadge status={statusB} />
                </div>
              )}
              <p className="text-[10px] text-[var(--muted)]">{HINT}</p>
              {!resultB && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={e => setTermsAgreed(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-400 cursor-pointer"
                />
                <span className="text-[10px] text-[var(--muted)]">
                  I agree to the{' '}
                  <Link href="/terms" target="_blank" className="text-[rgb(160,220,255)] underline underline-offset-2 hover:text-white transition">Terms of Use</Link>
                </span>
              </label>
            )}
            <MintButton cardStep={stepB} cardResult={resultB} onMint={mintCardB} mintLabel={cardBLabel} mintEmail={cardBEmail} status={statusB} disabled={!cardBLabel || cardBPart2Clean.length < 1 || !termsAgreed} />
            </div>
          </div>
        ) : (
          /* ── Standard two-part layout ── */
          <div className="space-y-4">
            <div>
              {isSingleName ? (
                <div className="mt-2">
                  <input
                    type="text"
                    value={name1}
                    onChange={(e) => { setName1(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setError(null); }}
                    placeholder="e.g. rgbanksy"
                    disabled={step === 'minting'}
                    className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                  />
                  <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                    Add a second part? Type it below — or mint as <span className="text-white">{name1}@nftmail.box</span>
                  </p>
                  <input
                    type="text"
                    value={name2}
                    onChange={(e) => { setName2(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setError(null); }}
                    placeholder="optional second part (e.g. eth)"
                    disabled={step === 'minting'}
                    className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                  />
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={name1}
                    onChange={(e) => { setName1(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setError(null); }}
                    placeholder="e.g. alice"
                    disabled={step === 'minting'}
                    className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                  />
                  <input
                    type="text"
                    value={name2}
                    onChange={(e) => { setName2(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setError(null); }}
                    placeholder="e.g. ops"
                    disabled={step === 'minting'}
                    className="rounded-lg border border-[var(--border)] bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-[rgba(0,163,255,0.5)] disabled:opacity-50"
                  />
                </div>
              )}
              {label && name1.length >= 2 && (isSingleName || name2.length >= 2) && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20 whitespace-nowrap">Mint New NFT</span>
                    <p className="text-xs text-[rgb(160,220,255)]">{fullGno} → {fullEmail}</p>
                    <StatusBadge status={nameStatus} />
                  </div>
                  <p className="text-[10px] text-[var(--muted)]">{HINT}</p>
                </div>
              )}
            </div>

            {step !== 'done' && (
              <>
                <MintModeToggle />
                {mintMode === 'gasless' && (
                  <p className="text-center text-[10px] text-emerald-300/60">No xDAI needed — gas sponsored by NFTMail treasury</p>
                )}
              </>
            )}

            {step !== 'done' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={e => setTermsAgreed(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-400 cursor-pointer"
                />
                <span className="text-[10px] text-[var(--muted)]">
                  I agree to the{' '}
                  <Link href="/terms" target="_blank" className="text-[rgb(160,220,255)] underline underline-offset-2 hover:text-white transition">Terms of Use</Link>
                </span>
              </label>
            )}
            <MintButton cardStep={step} cardResult={result} onMint={mint} mintLabel={label} mintEmail={fullEmail} status={nameStatus} disabled={!label || name1.length < 2 || (!isSingleName && name2.length < 2) || !termsAgreed} />
          </div>
        )}

        {error && <p className="text-center text-xs text-red-400">{error}</p>}
      </div>

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
                <h3 className="text-lg font-bold text-white">NFTMail Minted{result.gasless ? ' (Free)' : ''}</h3>
                <p className="text-xs text-[var(--muted)]">{result.name} — self-contained identity{result.gasless ? ' · gas sponsored' : ''}</p>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EMAIL ADDRESS</span>
                  <code className="text-sm font-bold text-emerald-300">{result.email}</code>
                </div>

                {result.tbaAddress && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TBA</span>
                    <code className="break-all text-xs text-[rgb(160,220,255)]">{result.tbaAddress}</code>
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
