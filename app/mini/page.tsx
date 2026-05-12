'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3';
const BASE_USDC_CAIP19 = 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

type AccountTier = 'basic' | 'lite' | 'premium' | 'free';

const TIER_META: Record<AccountTier, {
  label: string;
  emoji: string;
  color: string;
  border: string;
  hoverBorder: string;
  description: string;
  features: Array<[string, string]>;
  upsell: React.ReactNode | null;
  cta: string;
  ctaUrl: string;
}> = {
  basic: {
    label: 'BASIC',
    emoji: '🪲',
    color: 'text-green-400',
    border: 'border-green-800',
    hoverBorder: 'hover:border-green-400',
    description: 'Free inbox secured by your Farcaster identity. No wallet required.',
    features: [
      ['Inbox history', '8 days'],
      ['Outbound sends', '10'],
      ['Account expiry', 'Never'],
      ['Identity', 'ERC-8004 permanent'],
    ],
    upsell: (
      <div className="space-y-2 text-xs text-gray-500">
        <p className="text-gray-400 font-semibold text-xs mb-1">Upgrade your agent</p>
        <p><span className="text-yellow-400 font-semibold">LITE</span> — Mint a BYO NFT → 30-day history, 50 sends, Gnosis Safe ownership</p>
        <p><span className="text-purple-400 font-semibold">PREMIUM</span> — Gold POW or Agent Normie → unlimited retention, 200 sends, multisig Safe</p>
      </div>
    ),
    cta: 'Upgrade at nftmail.box →',
    ctaUrl: 'https://nftmail.box',
  },
  free: {
    label: 'FREE',
    emoji: '⏱',
    color: 'text-orange-400',
    border: 'border-orange-800',
    hoverBorder: 'hover:border-orange-400',
    description: 'Trial inbox for API and SDK use. Expires after 30 days.',
    features: [
      ['Inbox history', '8 days'],
      ['Outbound sends', '10'],
      ['Account expiry', '30 days'],
      ['Identity', 'ERC-8004 permanent'],
    ],
    upsell: (
      <div className="space-y-2 text-xs text-gray-500">
        <p className="text-gray-400 font-semibold text-xs mb-1">Upgrade before expiry</p>
        <p><span className="text-yellow-400 font-semibold">LITE</span> — Mint a BYO NFT → permanent inbox, 30-day history, 50 sends</p>
        <p><span className="text-purple-400 font-semibold">PREMIUM</span> — Gold POW or Agent Normie → unlimited everything</p>
      </div>
    ),
    cta: 'Upgrade at nftmail.box →',
    ctaUrl: 'https://nftmail.box',
  },
  lite: {
    label: 'LITE',
    emoji: '🫘',
    color: 'text-yellow-400',
    border: 'border-yellow-800',
    hoverBorder: 'hover:border-yellow-400',
    description: 'Permanent inbox. Your NFT is the key — as long as you hold it, it\'s yours.',
    features: [
      ['Inbox history', '30 days'],
      ['Outbound sends', '50'],
      ['Account expiry', 'Never'],
      ['Gnosis Safe', 'On-chain controller'],
    ],
    upsell: (
      <div className="space-y-2 text-xs text-gray-500">
        <p className="text-gray-400 font-semibold text-xs mb-1">Reach PREMIUM</p>
        <p><span className="text-purple-400 font-semibold">PREMIUM</span> — Gold POW NFT or Agent Normie → unlimited retention, 200 sends, multisig modules, on-chain attestations</p>
      </div>
    ),
    cta: 'Explore PREMIUM at nftmail.box →',
    ctaUrl: 'https://nftmail.box',
  },
  premium: {
    label: 'PREMIUM',
    emoji: '👻',
    color: 'text-purple-400',
    border: 'border-purple-800',
    hoverBorder: 'hover:border-purple-400',
    description: 'Sovereign agent. Your Gnosis Safe is the controller. Trait-gated, on-chain identity.',
    features: [
      ['Inbox history', 'Unlimited'],
      ['Outbound sends', '200'],
      ['Gnosis Safe', 'Multisig controller'],
      ['Attestations', 'On-chain, ERC-8004'],
    ],
    upsell: (
      <div className="space-y-2 text-xs text-gray-500">
        <p className="text-gray-400 font-semibold text-xs mb-1">You have the full stack</p>
        <p>Manage modules, aliases, agent pipelines, and A2A commerce at <span className="text-white">ghostagent.ninja</span></p>
      </div>
    ),
    cta: 'Open ghostagent.ninja →',
    ctaUrl: 'https://ghostagent.ninja',
  },
};

function TierAboutModal({ tier, onClose }: { tier: AccountTier; onClose: () => void }) {
  const meta = TIER_META[tier];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-t-2xl p-6 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className={`${meta.color} font-mono text-xs font-bold tracking-widest uppercase`}>
            {meta.emoji} {meta.label}
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-gray-300 text-sm mb-4">{meta.description}</p>
        <div className="space-y-2 mb-5 text-xs text-gray-400">
          {meta.features.map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span>{k}</span><span className="text-white">{v}</span>
            </div>
          ))}
        </div>
        {meta.upsell && (
          <div className="border-t border-gray-800 pt-4 mb-5">
            {meta.upsell}
          </div>
        )}
        <button
          onClick={() => sdk.actions.openUrl(meta.ctaUrl)}
          className={`w-full bg-gray-900 border border-gray-700 ${meta.hoverBorder} text-white text-sm py-3 rounded-lg transition-colors`}
        >
          {meta.cta}
        </button>
      </div>
    </div>
  );
}

function TierBadge({ tier, onClick }: { tier: AccountTier; onClick: () => void }) {
  const meta = TIER_META[tier];
  return (
    <button
      onClick={onClick}
      className={`absolute top-4 right-4 bg-gray-900 border ${meta.border} ${meta.hoverBorder} ${meta.color} font-mono text-xs px-2.5 py-1 rounded-full transition-colors`}
    >
      {meta.emoji} {meta.label}
    </button>
  );
}

type Step = 'loading' | 'entry' | 'naming' | 'provisioning' | 'success' | 'already' | 'upgrade' | 'upgrading' | 'upgraded' | 'error';

interface ProvisionResult {
  status: string;
  agentName?: string;
  humanEmail?: string;
  expiresAt?: number;
  tier?: string;
  error?: string;
}

export default function MiniApp() {
  const [step, setStep] = useState<Step>('loading');
  const [fid, setFid] = useState<number | null>(null);
  const [customName, setCustomName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [humanEmail, setHumanEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showAbout, setShowAbout] = useState(false);
  const [accountTier, setAccountTier] = useState<AccountTier>('basic');
  const [upgradeLog, setUpgradeLog] = useState<string[]>([]);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const context = await sdk.context;
        const userFid = context?.user?.fid ?? null;
        setFid(userFid);
        setStep('entry');
      } catch {
        setStep('entry');
      } finally {
        await sdk.actions.ready();
      }
    };
    init();
  }, []);

  const provision = useCallback(async (name: string, visibility: 'hidden' | 'fid-only' | 'full') => {
    if (!fid) { setError('No FID detected — open this in Warpcast.'); setStep('error'); return; }
    setStep('provisioning');
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'provisionFidAgent',
          fid,
          preferredName: name.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
          farcasterVisibility: visibility,
          emailVisibility: 'hidden',
        }),
      });
      const data: ProvisionResult = await res.json();
      if (data.status === 'already_provisioned' && data.agentName) {
        setAgentName(data.agentName);
        const t = (data.tier as AccountTier | undefined);
        setAccountTier(t && t in TIER_META ? t : 'basic');
        setStep('already');
        return;
      }
      if (data.status === 'provisioned' && data.agentName) {
        setAgentName(data.agentName);
        setHumanEmail(data.humanEmail || `${data.agentName}@nftmail.box`);
        setExpiresAt(data.expiresAt || null);
        const t = (data.tier as AccountTier | undefined);
        setAccountTier(t && t in TIER_META ? t : 'basic');
        setStep('success');
        return;
      }
      setError(data.error || 'Provisioning failed — please try again.');
      setStep('error');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setStep('error');
    }
  }, [fid]);

  const openDashboard = useCallback(() => {
    sdk.actions.openUrl(`${APP_URL}/dashboard`);
  }, []);

  const openUpgrade = useCallback(() => setStep('upgrade'), []);

  function addUpgradeLog(msg: string) {
    setUpgradeLog(prev => [...prev, msg]);
  }

  const TIER_FEES_USDC: Record<AccountTier, number> = { basic: 10, free: 10, lite: 14, premium: 2 };
  const upgradeFee = TIER_FEES_USDC[accountTier] ?? 10;
  const upgradeTierTarget: string = accountTier === 'basic' || accountTier === 'free' ? 'lite' : accountTier === 'lite' ? 'premium' : '';

  async function handlePayAndUpgrade() {
    if (!fid || !agentName || upgrading) return;
    setUpgrading(true);
    try {
      // 1. Native 1-tap USDC send via Farcaster wallet
      const amountMicro = String(upgradeFee * 1_000_000); // USDC has 6 decimals
      const result = await sdk.actions.sendToken({
        token: BASE_USDC_CAIP19,
        amount: amountMicro,
        recipientAddress: TREASURY,
      });
      if (!result.success) {
        setUpgrading(false);
        if (result.reason !== 'rejected_by_user') {
          setError(result.error?.message ?? 'Payment failed');
          setStep('error');
        }
        return;
      }
      const confirmedTxHash = result.send.transaction;

      // 2. Server-side: verify payment + link wallet + upgrade tier
      setStep('upgrading');
      setUpgradeLog([]);
      addUpgradeLog('Payment confirmed. Verifying…');
      addUpgradeLog('Linking wallet & upgrading tier…');
      const res = await fetch('/api/mini-upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fid,
          agentName,
          txHash: confirmedTxHash,
          currentTier: accountTier,
        }),
      });
      const data = await res.json() as { status?: string; newTier?: string; error?: string };
      if (data.status !== 'upgraded') throw new Error(data.error || 'Upgrade failed');
      addUpgradeLog(`✓ Tier upgraded to ${(data.newTier ?? upgradeTierTarget).toUpperCase()}`);
      const newTier = (data.newTier ?? upgradeTierTarget) as AccountTier;
      setAccountTier(newTier in TIER_META ? newTier as AccountTier : 'lite');
      setStep('upgraded');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upgrade failed');
      setStep('error');
    } finally {
      setUpgrading(false);
    }
  }

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-green-400 font-mono text-sm">Initialising...</p>
        </div>
      </div>
    );
  }

  if (step === 'entry') {
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">👻</div>
            <h1 className="text-white font-bold text-2xl mb-2">nftmail.box</h1>
            <p className="text-gray-400 text-sm">Encrypted agent email · No wallet required</p>
            {fid && <p className="text-green-400 font-mono text-xs mt-2">FID: {fid}</p>}
          </div>
          <div className="space-y-3">
            <input
              type="text"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-sm placeholder-gray-500 focus:outline-none focus:border-green-400"
              placeholder={`Custom name (default: fid-${fid ?? '...'})`}
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              maxLength={32}
              autoComplete="off"
              autoCapitalize="none"
            />
            <button
              onClick={() => setStep('naming')}
              className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition-colors"
            >
              Claim BASIC Agent →
            </button>
            <p className="text-gray-600 text-xs text-center">Free forever · 8-day inbox history · Upgrade anytime</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'naming') {
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const displayName = name ? `${name}.fid-${fid}` : `fid-${fid}`;
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔒</div>
            <h2 className="text-white font-bold text-xl mb-1">Privacy Settings</h2>
            <p className="text-green-400 font-mono text-sm">{displayName}@nftmail.box</p>
          </div>
          <p className="text-gray-400 text-sm text-center mb-6">Who can see your Farcaster identity?</p>
          <div className="space-y-3">
            <button
              onClick={() => provision(name, 'hidden')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-green-400 text-white py-3 rounded-lg text-sm transition-colors"
            >
              🕵️ Hidden — No FID visible
            </button>
            <button
              onClick={() => provision(name, 'fid-only')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-green-400 text-white py-3 rounded-lg text-sm transition-colors"
            >
              👁 FID Only — Show FID number
            </button>
            <button
              onClick={() => provision(name, 'full')}
              className="w-full bg-gray-900 border border-gray-700 hover:border-green-400 text-white py-3 rounded-lg text-sm transition-colors"
            >
              🌐 Full Profile — Show username + avatar
            </button>
            <button
              onClick={() => setStep('entry')}
              className="w-full text-gray-500 text-sm py-2"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'provisioning') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-green-400 font-mono text-sm">Provisioning agent...</p>
          <p className="text-gray-600 text-xs mt-2">Generating keys · Writing to chain</p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-white font-bold text-2xl mb-2">Agent Created!</h2>
          <div className="bg-gray-900 border border-green-400 rounded-lg p-4 my-6">
            <p className="text-green-400 font-mono text-sm font-bold">{humanEmail}</p>
            <p className="text-gray-500 text-xs mt-1">{TIER_META[accountTier].label} · {TIER_META[accountTier].features[0][1]} inbox history · {TIER_META[accountTier].features[1][1]} sends</p>
          </div>
          <p className="text-gray-400 text-xs mb-6">Your emails are end-to-end encrypted. No one — including us — can read them.</p>
          <div className="space-y-3">
            <button onClick={openDashboard} className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition-colors">
              Open Dashboard →
            </button>
            <button onClick={openUpgrade} className="w-full bg-gray-900 border border-gray-700 hover:border-green-400 text-white py-3 rounded-lg text-sm transition-colors">
              Upgrade to LITE →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'already') {
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3">👻</div>
          <h2 className="text-white font-bold text-xl mb-2">Already Claimed</h2>
          <p className="text-green-400 font-mono text-sm mb-6">{agentName}@nftmail.box</p>
          <div className="space-y-3">
            <button onClick={openDashboard} className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition-colors">
              Open Dashboard →
            </button>
            <button onClick={openUpgrade} className="w-full bg-gray-900 border border-gray-700 text-white py-3 rounded-lg text-sm">
              Upgrade Tier →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'upgrade') {
    const nextTierMeta = upgradeTierTarget ? TIER_META[upgradeTierTarget as AccountTier] : null;
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">⬆️</div>
            <h2 className="text-white font-bold text-xl mb-1">Upgrade Tier</h2>
            <p className="text-gray-400 text-sm">
              {TIER_META[accountTier].label} → {nextTierMeta ? <span className={nextTierMeta.color}>{nextTierMeta.label}</span> : '—'}
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 space-y-2 text-xs text-gray-400">
            <div className="flex justify-between"><span>Fee</span><span className="text-white font-bold">{upgradeFee} USDC</span></div>
            <div className="flex justify-between"><span>Network</span><span className="text-white">Base · USDC</span></div>
            <div className="flex justify-between"><span>Account</span><span className="text-white font-mono">{agentName}@nftmail.box</span></div>
            {nextTierMeta && nextTierMeta.features.map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-gray-800 pt-2 first:border-0 first:pt-0">
                <span>{k}</span><span className={nextTierMeta.color}>{v}</span>
              </div>
            ))}
          </div>

          <button
            disabled={upgrading || !upgradeTierTarget}
            onClick={handlePayAndUpgrade}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-colors mb-3"
          >
            {upgrading ? 'Processing…' : `Pay ${upgradeFee} USDC & Upgrade`}
          </button>

          <button onClick={() => setStep('already')} className="w-full text-gray-600 text-sm py-2">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (step === 'upgrading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center w-full max-w-sm px-6">
          <div className="w-12 h-12 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-yellow-400 font-mono text-sm mb-4">Upgrading agent…</p>
          <div className="text-left space-y-1">
            {upgradeLog.map((l, i) => (
              <p key={i} className="text-gray-400 font-mono text-xs">{l}</p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (step === 'upgraded') {
    const meta = TIER_META[accountTier];
    return (
      <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
        <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3">{meta.emoji}</div>
          <h2 className="text-white font-bold text-2xl mb-2">{meta.label} Unlocked!</h2>
          <div className={`bg-gray-900 border ${meta.border} rounded-lg p-4 my-6`}>
            <p className={`${meta.color} font-mono text-sm font-bold`}>{agentName}@nftmail.box</p>
            <p className="text-gray-500 text-xs mt-1">{meta.features[0][1]} inbox history · {meta.features[1][1]} sends</p>
          </div>
          <p className="text-gray-400 text-xs mb-6">Your wallet is now the controller of this agent. Manage it at ghostagent.ninja.</p>
          <button onClick={openDashboard} className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition-colors">
            Open Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black flex flex-col items-center justify-center px-6">
      {showAbout && <TierAboutModal tier={accountTier} onClose={() => setShowAbout(false)} />}
      <TierBadge tier={accountTier} onClick={() => setShowAbout(true)} />
      <div className="w-full max-w-sm text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-white font-bold text-xl mb-3">Something went wrong</h2>
        <p className="text-red-400 font-mono text-xs mb-6 break-words">{error}</p>
        <button onClick={() => { setStep('entry'); setError(''); }} className="w-full bg-gray-900 border border-gray-700 text-white py-3 rounded-lg">
          Try Again
        </button>
      </div>
    </div>
  );
}
