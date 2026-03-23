'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { NFTLogin } from '../components/NFTLogin';
import { MintNFTMail } from '../components/MintNFTMail';

type Tier = 'none' | 'free' | 'pro';

const TREASURY = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4';
const TIER_XDAI: Record<string, number> = { lite: 10, pro: 24 };
const TIER_EURE: Record<string, number> = { lite: 10, pro: 22 };

// ─── Tier Upgrade Panel ───
function UpgradeTierPanel({ label, defaultTier }: { label: string; defaultTier: string }) {
  const { user } = usePrivy();
  const [selectedTier, setSelectedTier] = useState<'lite' | 'pro'>(defaultTier === 'pro' || defaultTier === 'premium' ? 'pro' : 'lite');
  const stageName = selectedTier === 'pro' ? 'Imago' : 'Pupa';
  const [txHash, setTxHash] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);
  const [paymentToken, setPaymentToken] = useState<'xdai' | 'eure'>('xdai');
  const [showGnosisPayTooltip, setShowGnosisPayTooltip] = useState(false);

  const ownerWallet = user?.wallet?.address || '';
  const xdaiAmount = TIER_XDAI[selectedTier];
  const eureAmount = TIER_EURE[selectedTier];

  const copyToClipboard = async (text: string, key: 'address' | 'amount') => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleUpgrade = useCallback(async () => {
    if (!ownerWallet) { setError('Connect wallet first'); return; }
    const hash = txHash.trim();
    if (!hash) { setError('Paste the tx hash from your payment'); return; }
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) { setError('Invalid tx hash — must be 0x followed by 64 hex characters'); return; }
    setUpgrading(true);
    setError('');
    try {
      const res = await fetch('/api/upgrade-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, ownerWallet, newTier: selectedTier === 'pro' ? 'premium' : selectedTier, paymentTxHash: hash, paymentToken }),
      });
      const data = await res.json() as { error?: string; [key: string]: any };
      if (!res.ok) throw new Error(data.error || 'Upgrade failed');
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpgrading(false);
    }
  }, [label, ownerWallet, selectedTier, txHash, paymentToken]);

  if (result) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg className="h-6 w-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <p className="text-lg font-semibold text-white">{result.newTier === 'premium' || result.newTier === 'pro' ? 'Imago' : result.newTier === 'lite' ? 'Pupa' : result.newTier === 'ghost' ? 'Agent' : result.newTier?.toUpperCase()} activated</p>
        <p className="text-sm text-[var(--muted)] text-center">{result.message}</p>
        {result.safe && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-center">
            <p className="text-[10px] text-[var(--muted)] mb-0.5">MIRROR BODY (GNOSIS SAFE)</p>
            <code className="text-[11px] text-emerald-300 break-all">{result.safe}</code>
          </div>
        )}
        {result.paymentValue && (
          <p className="text-[10px] text-[var(--muted)]">Payment verified: {result.paymentValue} xDAI from {result.paymentFrom?.slice(0,10)}...</p>
        )}
        <Link href={`/inbox/${label}`} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-6 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 transition">
          Open Inbox →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <div>
          <p className="text-sm font-semibold text-white">You are a Larva.</p>
          <p className="text-[11px] text-[var(--muted)]">{label}@nftmail.box · Your shell is temporary (8-day history). Cycle to next stage of metamorphosis.</p>
        </div>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 bg-amber-500/10 text-amber-300 ring-amber-500/20 whitespace-nowrap">LARVA</span>
      </div>

      {/* Tier selection cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => setSelectedTier('lite')}
          className={`rounded-xl border p-4 text-left transition ${selectedTier === 'lite' ? 'border-amber-500/40 bg-amber-500/8 ring-1 ring-amber-500/20' : 'border-[var(--border)] bg-black/20 hover:border-amber-500/30'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-white">Cycle to Pupa</p>
              <p className="text-[10px] text-[var(--muted)]">Lite tier</p>
            </div>
            <span className="text-lg font-bold text-amber-300">10 xDAI</span>
          </div>
          <ul className="space-y-1 text-[11px] text-[var(--muted)]">
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Deploy Mirror Body Safe</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Enable sending email</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 30-day cycle (renewable)</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Stake $SURGE for reputation</li>
          </ul>
        </button>
        <button
          onClick={() => setSelectedTier('pro')}
          className={`rounded-xl border p-4 text-left transition ${selectedTier === 'pro' ? 'border-violet-500/40 bg-violet-500/8 ring-1 ring-violet-500/20' : 'border-[var(--border)] bg-black/20 hover:border-violet-500/30'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-white">Emerge as Imago</p>
              <p className="text-[10px] text-[var(--muted)]">PRO tier · <span className="text-violet-300">SOVEREIGN</span></p>
            </div>
            <span className="text-lg font-bold text-violet-300">24 xDAI<span className="text-[11px] font-normal text-[var(--muted)]">/yr</span></span>
          </div>
          <ul className="space-y-1 text-[11px] text-[var(--muted)]">
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Everything in Pupa</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Infinite retention — no 8-day history window</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Encrypted KV storage — you own your keys</li>
            <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Enter GhostAgent molting stream</li>
          </ul>
        </button>
      </div>

      {/* Payment method toggle */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">PAYMENT METHOD</p>
        <div className="flex gap-2">
          <button
            onClick={() => setPaymentToken('xdai')}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              paymentToken === 'xdai'
                ? 'border-[rgba(0,163,255,0.4)] bg-[rgba(0,163,255,0.1)] text-[rgb(160,220,255)]'
                : 'border-[var(--border)] bg-black/20 text-[var(--muted)] hover:border-white/20'
            }`}
          >
            xDAI (native)
          </button>
          <div className="relative flex-1">
            <button
              onClick={() => setPaymentToken('eure')}
              onMouseEnter={() => setShowGnosisPayTooltip(true)}
              onMouseLeave={() => setShowGnosisPayTooltip(false)}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                paymentToken === 'eure'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[var(--border)] bg-black/20 text-[var(--muted)] hover:border-emerald-500/30'
              }`}
            >
              Gnosis Pay / EURe
            </button>
            {showGnosisPayTooltip && (
              <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-lg border border-emerald-500/20 bg-[#0a1a12] px-3 py-2 text-[10px] text-emerald-200/80 shadow-xl z-10">
                Surveillance-proof fiat-to-xDAI bridge. Your card, your Safe, your Sovereignty.
                <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-emerald-500/20" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment instructions */}
      <div className={`rounded-xl border p-4 space-y-4 ${selectedTier === 'pro' ? 'border-violet-500/20 bg-violet-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
        <div className="flex items-center gap-2">
          <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${selectedTier === 'pro' ? 'bg-violet-500/20 text-violet-300' : 'bg-amber-500/20 text-amber-300'}`}>1</div>
          <span className="text-xs font-semibold text-white">
            {paymentToken === 'eure' ? 'Send EURe via Gnosis Pay on Gnosis Chain' : 'Send xDAI on Gnosis Chain'}
          </span>
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">EXACT AMOUNT</p>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2">
            <code className={`flex-1 text-sm font-bold ${selectedTier === 'pro' ? 'text-violet-300' : 'text-amber-300'}`}>
              {paymentToken === 'eure' ? `${eureAmount}.00 EURe` : `${xdaiAmount}.0 xDAI`}
            </code>
            <button
              onClick={() => copyToClipboard(paymentToken === 'eure' ? `${eureAmount}.00` : `${xdaiAmount}.0`, 'amount')}
              className="text-[10px] text-[var(--muted)] hover:text-white transition px-2 py-0.5 rounded border border-[var(--border)] hover:border-white/20"
            >
              {copied === 'amount' ? '✓ copied' : 'copy'}
            </button>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TO ADDRESS (GNOSIS)</p>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2">
            <code className="flex-1 text-[11px] text-[rgb(160,220,255)] break-all">{TREASURY}</code>
            <button
              onClick={() => copyToClipboard(TREASURY, 'address')}
              className="flex-shrink-0 text-[10px] text-[var(--muted)] hover:text-white transition px-2 py-0.5 rounded border border-[var(--border)] hover:border-white/20"
            >
              {copied === 'address' ? '✓ copied' : 'copy'}
            </button>
          </div>
          <p className="text-[10px] text-[var(--muted)]">
            {paymentToken === 'eure'
              ? 'Chain: Gnosis (Chain ID 100) · Token: EURe (0xcB444e90D8198415266c6a2724b7900fb12FC56E)'
              : 'Chain: Gnosis (Chain ID 100) · Token: xDAI (native)'}
          </p>
        </div>

        {/* Gnosisscan link */}
        <a
          href={`https://gnosisscan.io/address/${TREASURY}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-white transition"
        >
          View treasury on Gnosisscan ↗
        </a>
      </div>

      {/* Step 2: paste tx hash */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${selectedTier === 'pro' ? 'bg-violet-500/20 text-violet-300' : 'bg-amber-500/20 text-amber-300'}`}>2</div>
          <span className="text-xs font-semibold text-white">Paste your transaction hash</span>
        </div>
        <input
          type="text"
          value={txHash}
          onChange={e => { setTxHash(e.target.value); setError(''); }}
          placeholder="0x... (64-char tx hash from Gnosisscan)"
          className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2.5 text-sm font-mono text-white placeholder-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)]"
          spellCheck={false}
        />
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="text-[11px] text-red-400">{error}</p>
          </div>
        )}
        <button
          onClick={handleUpgrade}
          disabled={upgrading || !txHash.trim()}
          className={`w-full rounded-lg border px-4 py-3 text-sm font-semibold transition disabled:opacity-40 ${
            selectedTier === 'pro'
              ? 'border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
          }`}
        >
          {upgrading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Verifying payment on-chain...
            </span>
          ) : `Verify & ${selectedTier === 'pro' ? 'Emerge as Imago' : 'Cycle to Pupa'} →`}
        </button>
        <p className="text-center text-[10px] text-[var(--muted)]">Payment verified on-chain — no trust required</p>
      </div>
    </div>
  );
}

export default function NftmailPage() {
  const { authenticated } = usePrivy();
  const searchParams = useSearchParams();

  const upgradeLabel = searchParams?.get('label') || '';
  const upgradeTier = searchParams?.get('upgrade') || '';
  const claimName = searchParams?.get('claim') || '';
  const isUpgradeFlow = !!(upgradeLabel && (upgradeTier === 'lite' || upgradeTier === 'pro' || upgradeTier === 'premium'));

  const [mintedName, setMintedName] = useState('');
  const [mintedTba, setMintedTba] = useState('');
  const [tier, setTier] = useState<Tier>('none');

  const email = mintedName ? `${mintedName}@nftmail.box` : '';

  // ── Upgrade flow: show tier upgrade panel directly ──
  if (isUpgradeFlow) {
    return (
      <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.12),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.10),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 md:px-6">
          <header className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
              <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
              <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
            </Link>
            <Link href={`/inbox/${upgradeLabel}`} className="text-[10px] text-[var(--muted)] hover:text-white transition">← Back to inbox</Link>
          </header>

          <section className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">You are a <span className="text-amber-300">Larva</span>.</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--muted)]">
              Your shell is temporary (8-day history). Cycle to next stage of metamorphosis.
            </p>
          </section>

          {/* Tier ladder overview */}
          <div className="rounded-xl border border-[var(--border)] bg-black/20 px-5 py-4">
            <div className="flex items-center gap-0 text-[10px] font-semibold text-[var(--muted)] overflow-x-auto">
              {['LARVA — free', 'PUPA — 10 xDAI', 'IMAGO — 24/yr', 'AGENT — sovereign'].map((t, i) => (
                <div key={t} className="flex items-center gap-0">
                  <span className={`px-3 py-1 rounded-full whitespace-nowrap ${
                    (i === 1 && upgradeTier === 'lite') || (i === 2 && (upgradeTier === 'pro' || upgradeTier === 'premium'))
                      ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                      : i === 0 ? 'text-amber-300/60' : ''
                  }`}>{t}</span>
                  {i < 3 && <span className="text-[var(--border)] px-1">→</span>}
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            {authenticated ? (
              <UpgradeTierPanel label={upgradeLabel} defaultTier={upgradeTier === 'premium' ? 'pro' : upgradeTier} />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted)]">Connect your wallet to upgrade.</p>
                <NFTLogin />
              </div>
            )}
          </section>

          <footer className="text-center text-[10px] text-[var(--muted)] pb-2">
            nftmail.box — Privacy is a Right, Sovereignty is an Upgrade
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_circle_at_20%_-10%,rgba(0,163,255,0.16),transparent_45%),radial-gradient(900px_circle_at_90%_10%,rgba(124,77,255,0.14),transparent_40%),linear-gradient(180deg,var(--background),#03040a)]">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10 md:px-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/nftmail-logo.png" alt="NFTMail" width={36} height={36} className="opacity-95" />
            <span style={{ fontFamily: "'Ayuthaya', serif", color: '#d8d4cf' }} className="text-base tracking-wide">nftmail.box</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://ghostagent.ninja"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[var(--border)] bg-black/20 px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-black/30"
            >
              GhostAgent.ninja
            </a>
          </div>
        </header>

        <section className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">nftmail.box</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--muted)]">
            Mint a self-contained email identity on Gnosis. You are born a Larva. Don't let your identity decay into the void.
          </p>
        </section>

        <div className="flex items-center justify-center gap-3">
          {[
            { key: 'free', label: 'Mint', icon: '1' },
            { key: 'pro', label: 'Evolve', icon: '2' },
          ].map((s, i) => {
            const tierOrder: Tier[] = ['none', 'free', 'pro'];
            const currentIdx = tierOrder.indexOf(tier);
            const stepIdx = tierOrder.indexOf(s.key as Tier);
            const isDone = currentIdx >= stepIdx;
            const isCurrent = currentIdx === stepIdx - 1;
            return (
              <div key={s.key} className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                      isDone
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                        : isCurrent
                        ? 'bg-[rgba(0,163,255,0.15)] text-[rgb(160,220,255)] ring-1 ring-[rgba(0,163,255,0.4)] animate-pulse'
                        : 'bg-white/5 text-[var(--muted)] ring-1 ring-[var(--border)]'
                    }`}
                  >
                    {isDone ? '✓' : s.icon}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isDone ? 'text-emerald-400' : isCurrent ? 'text-[rgb(160,220,255)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < 1 && <div className={`h-px w-8 ${isDone ? 'bg-emerald-500/40' : 'bg-[var(--border)]'}`} />}
              </div>
            );
          })}
        </div>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(0,163,255,0.12)] text-[10px] font-bold text-[rgb(160,220,255)]">
                {authenticated ? '✓' : '1'}
              </div>
              <h2 className="text-lg font-semibold text-white">Connect</h2>
            </div>
            <p className="mt-1 ml-8 text-xs text-[var(--muted)]">Sign in with wallet or email to get started.</p>
          </div>
          <div className="ml-8">
            <NFTLogin />
          </div>
        </section>

        {authenticated && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    tier !== 'none' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[rgba(0,163,255,0.12)] text-[rgb(160,220,255)]'
                  }`}
                >
                  {tier !== 'none' ? '✓' : '2'}
                </div>
                <h2 className="text-lg font-semibold text-white">Mint NFTmail</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">FREE</span>
              </div>
              <p className="mt-1 ml-8 text-xs text-[var(--muted)]">Mint [name1]-[name2].nftmail.gno → get [name1]-[name2]@nftmail.box. Free — you are born a Larva. 8-day history, receive only. Cycle to Pupa for a 30-day window.</p>
            </div>
            <div className="ml-8">
              {tier !== 'none' ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-emerald-300">{email}</span>
                  <span className="ml-auto text-[10px] text-[var(--muted)]">TBA: {mintedTba.slice(0, 8)}...</span>
                </div>
              ) : (
                <MintNFTMailWithCallback
                  initialName={claimName}
                  onMinted={(name, tba) => {
                    setMintedName(name);
                    setMintedTba(tba);
                    setTier('free');
                  }}
                />
              )}
            </div>
          </section>
        )}

        {tier === 'free' || tier === 'pro' ? (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    tier === 'pro' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-violet-500/15 text-violet-300'
                  }`}
                >
                  {tier === 'pro' ? '✓' : '2'}
                </div>
                <h2 className="text-lg font-semibold text-white">Evolve to Imago</h2>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-500/20">OPTIONAL</span>
              </div>
              <p className="mt-1 ml-8 text-xs text-[var(--muted)]">Pupa deploys a Mirror Body (Gnosis Safe) + enables sending. Imago anchors your inbox permanently — no 8-day decay.</p>
            </div>
            <div className="ml-8">
              {tier === 'pro' ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-sm text-emerald-300">Imago activated — sovereign identity</span>
                </div>
              ) : (
                <UpgradeTierPanel label={mintedName} defaultTier="pro" />
              )}
            </div>
          </section>
        ) : null}

        {(tier === 'free' || tier === 'pro') && (
          <section className="rounded-2xl border border-amber-500/20 bg-[var(--card)] p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <h2 className="text-lg font-semibold text-white">Molt from Pupa to an Agent</h2>
              </div>
              <p className="mt-1 ml-7 text-xs text-[var(--muted)]">
                Your identity can evolve into a full GhostAgent — same Mirror Body, same email, plus a Brain module for autonomous on-chain execution.
              </p>
            </div>
            <div className="ml-7">
              <a
                href="https://ghostagent.ninja"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-5 py-3 text-sm font-semibold text-amber-200 transition-all hover:bg-amber-500/15 hover:shadow-[0_0_24px_rgba(245,158,11,0.1)]"
              >
                Molt from Pupa to an Agent on GhostAgent.ninja
                <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </a>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-[var(--muted)]">nftmail.box — self-contained minting — no creation.ip required — zero dependency.</footer>
      </div>
    </div>
  );
}

function MintNFTMailWithCallback({ onMinted, initialName }: { onMinted: (name: string, tba: string) => void; initialName?: string }) {
  const [manualName, setManualName] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [nameType, setNameType] = useState<'human' | 'agent'>('human');

  const handleNameChange = (val: string) => {
    const lower = val.toLowerCase();
    if (nameType === 'agent') {
      // agent: allow letters, numbers, dots, hyphens, one trailing underscore
      setManualName(lower.replace(/[^a-z0-9._-]/g, ''));
    } else {
      // human: no underscore
      setManualName(lower.replace(/[^a-z0-9.-]/g, ''));
    }
  };

  const isValid = nameType === 'agent'
    ? /^[a-z0-9][a-z0-9._-]*_$/.test(manualName)   // must end with _
    : /^[a-z0-9][a-z0-9.-]+$/.test(manualName);      // standard human name

  return (
    <div className="space-y-4">
      {/* Human / Agent tab selector */}
      <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-[10px] font-semibold">
        <button
          onClick={() => { setNameType('human'); setManualName(''); }}
          className={`flex-1 px-3 py-2 transition ${nameType === 'human' ? 'bg-[rgba(0,163,255,0.15)] text-[rgb(160,220,255)]' : 'bg-black/20 text-[var(--muted)] hover:text-white'}`}
        >
          Human
        </button>
        <button
          onClick={() => { setNameType('agent'); setManualName(''); }}
          className={`flex-1 px-3 py-2 transition ${nameType === 'agent' ? 'bg-amber-500/15 text-amber-300' : 'bg-black/20 text-[var(--muted)] hover:text-white'}`}
        >
          Agent (NFTmail.gno)
        </button>
      </div>

      {nameType === 'human' ? (
        <MintNFTMail initialName={initialName} />
      ) : (
        <>
          <MintNFTMail initialName={initialName} />
          {!showManual ? (
            <button
              onClick={() => setShowManual(true)}
              className="w-full rounded-lg border border-[var(--border)] bg-black/20 px-4 py-2 text-xs text-[var(--muted)] transition hover:text-white"
            >
              Already minted? Enter details →
            </button>
          ) : (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-black/20 p-4">
              <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">ALREADY MINTED — AGENT</div>
              <input
                type="text"
                value={manualName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Agent name (e.g. ghostbot_)"
                className="w-full rounded-lg border border-[var(--border)] bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-[rgba(0,163,255,0.5)]"
              />
              {manualName && !isValid && (
                <p className="text-[10px] text-amber-400">Agent names must end with an underscore, e.g. <code>ghostbot_</code></p>
              )}
              <button
                onClick={() => { if (isValid) onMinted(manualName, ''); }}
                disabled={!isValid}
                className="w-full rounded-lg bg-[rgba(0,163,255,0.12)] px-4 py-2 text-xs font-semibold text-[rgb(160,220,255)] transition hover:bg-[rgba(0,163,255,0.2)] disabled:opacity-40"
              >
                Confirm → Evolve to Imago
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
