'use client';

import { useEffect, useState, useCallback } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

type Step = 'loading' | 'entry' | 'naming' | 'provisioning' | 'success' | 'already' | 'error';

interface ProvisionResult {
  status: string;
  agentName?: string;
  humanEmail?: string;
  expiresAt?: number;
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
        setStep('already');
        return;
      }
      if (data.status === 'provisioned' && data.agentName) {
        setAgentName(data.agentName);
        setHumanEmail(data.humanEmail || `${data.agentName}@nftmail.box`);
        setExpiresAt(data.expiresAt || null);
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

  const openUpgrade = useCallback(() => {
    sdk.actions.openUrl(`${APP_URL}/byo-molt?agent=${agentName}`);
  }, [agentName]);

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
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
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
              Claim LARVA Agent →
            </button>
            <p className="text-gray-600 text-xs text-center">30-day free account · 8-day inbox history · Upgrade anytime</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'naming') {
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const displayName = name ? `${name}.fid-${fid}` : `fid-${fid}`;
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
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
    const expiresStr = expiresAt ? new Date(expiresAt).toLocaleDateString() : '30 days';
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-white font-bold text-2xl mb-2">Agent Created!</h2>
          <div className="bg-gray-900 border border-green-400 rounded-lg p-4 my-6">
            <p className="text-green-400 font-mono text-sm font-bold">{humanEmail}</p>
            <p className="text-gray-500 text-xs mt-1">LARVA · Active until {expiresStr} · 8-day inbox history</p>
          </div>
          <p className="text-gray-400 text-xs mb-6">Your emails are end-to-end encrypted. No one — including us — can read them.</p>
          <div className="space-y-3">
            <button onClick={openDashboard} className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition-colors">
              Open Dashboard →
            </button>
            <button onClick={openUpgrade} className="w-full bg-gray-900 border border-gray-700 hover:border-green-400 text-white py-3 rounded-lg text-sm transition-colors">
              Upgrade to PUPA →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'already') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 py-8">
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

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
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
