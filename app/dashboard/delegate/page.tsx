'use client';

import { useState, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { DelegationWizard } from '../../components/DelegationWizard';
import type { SupportedChainName } from '../../utils/delegate-write';

const GHOSTAGENT_IMG = '/ghostagent-ninja.png';
const FAKENORMIE_IMG = '/fakenormie.png';
const NORMIES_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const FAKE_NORMIE_CONTRACT = process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT ?? '';
type NftType = 'normie' | 'fakenormie' | 'other';
const ICONS = { normie: '/collection-icons/normie.png', fakenormie: FAKENORMIE_IMG, other: '/collection-icons/other.png' };

export default function DelegatePage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [customContract, setCustomContract] = useState('');
  const [customChain, setCustomChain] = useState<SupportedChainName>('gnosis');
  const [demoMintState, setDemoMintState] = useState<'idle'|'minting'|'minted'|'already'|'error'>('idle');
  const [demoTokenId, setDemoTokenId] = useState<string|null>(null);
  const [demoTxHash, setDemoTxHash] = useState<string|null>(null);
  const [demoError, setDemoError] = useState('');
  const [selectedNftType, setSelectedNftType] = useState<NftType>('fakenormie');
  const [tokenId, setTokenId] = useState('');
  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy')?.address ?? wallets[0]?.address ?? null;
  const handleDemoMint = useCallback(async () => {
    if (!connectedWallet) return;
    setDemoMintState('minting');
    try {
      const res = await fetch('/api/demo-mint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientAddress: connectedWallet }) });
      const data = await res.json() as any;
      if (data.alreadyMinted) { setDemoMintState('already'); return; }
      if (!data.success) { setDemoError(data.error ?? 'Mint failed'); setDemoMintState('error'); return; }
      setDemoTokenId(data.tokenId ?? null); setDemoMintState('minted');
    } catch (e) { setDemoError('Network error'); setDemoMintState('error'); }
  }, [connectedWallet]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <img src={GHOSTAGENT_IMG} alt="NFT Delegation" className="h-28 w-28 shrink-0 rounded-xl border border-fuchsia-500/40 object-contain" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-white">NFT Delegation</h1>
          <p className="mt-1 pl-1 text-sm text-gray-400">Delegate token-level proxy access without moving your NFT</p>
        </div>
      </div>
      {/* Phase explainer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-400 mb-1">Phase 1 · Delegate to a hot wallet</div>
          <div className="text-xs font-semibold text-white mb-1">Desktop Setup</div>
          <div className="text-[10px] text-gray-400 leading-relaxed">Connect your EOA or cold vault that holds your NFT, select your NFT, sign one transaction. Your NFT stays put.</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-1">Phase 2 · Mobile</div>
          <div className="text-xs font-semibold text-white mb-1">Farcaster Proxy</div>
          <div className="text-[10px] text-gray-400 leading-relaxed">Scan the QR. Open nftmail.box in Farcaster. Chat as your agent from your Farcaster wallet.</div>
        </div>
      </div>
      {/* FakeNormie Sandbox */}
      <div className="w-full rounded-2xl border border-violet-500/35 bg-gray-900/50 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <img src={FAKENORMIE_IMG} alt="FakeNormie" className="h-16 w-16 rounded-lg object-contain" />
          <div>
            <p className="text-sm font-semibold text-white">FakeNormie Sandbox</p>
            <p className="text-[11px] text-gray-400">Test delegation flow with a free demo NFT</p>
          </div>
        </div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-[11px] text-gray-400">
          <div className="font-semibold text-white text-xs mb-2">Hackathon Demo Mode</div>
          <div>No real Normie required. Mint a free FakeNormie to your connected wallet.</div>
        </div>
        {!authenticated ? (
          <button onClick={login} className="w-full rounded-xl border border-violet-500/35 bg-violet-500/12 py-3 text-sm font-semibold text-violet-300">Connect Wallet to Start</button>
        ) : (
          <button onClick={handleDemoMint} disabled={demoMintState !== 'idle'} className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-3 text-sm font-semibold text-violet-300">{demoMintState === 'idle' ? 'Mint My FakeNormie (Free)' : demoMintState === 'minting' ? 'Minting...' : 'Done'}</button>
        )}
      </div>
      {/* OG NFTs Panel */}
      <div className="w-full rounded-2xl border border-orange-500/35 bg-gray-900/50 p-5 space-y-4">
        <p className="text-sm font-semibold text-white">OG NFTs</p>
        <p className="text-[11px] text-gray-400">Select your NFT collection and enter the token ID to delegate</p>
        {/* NFT type picker */}
        <div className="grid grid-cols-3 gap-3">
          {[{k:'fakenormie' as NftType,l:'FAKENORMIE',img:ICONS.fakenormie},{k:'normie' as NftType,l:'NORMIES',img:ICONS.normie},{k:'other' as NftType,l:'OTHER',img:ICONS.other}].map(opt => (
            <button key={opt.k} onClick={() => setSelectedNftType(opt.k)} className={`rounded-lg border p-3 font-semibold transition ${selectedNftType === opt.k ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300' : 'border-gray-700 bg-black/20 text-gray-400'}`}>
              <img src={opt.img} alt={opt.l} className="w-24 h-24 rounded object-contain mx-auto mb-2" />
              <span className="text-[10px]">{opt.l}</span>
            </button>
          ))}
        </div>
        {/* Token ID */}
        <div>
          <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-1">TOKEN ID</label>
          <input className="w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-sm text-white" placeholder="e.g. 123" value={tokenId} onChange={e => setTokenId(e.target.value.replace(/[^0-9]/g,''))} />
        </div>
        {/* Custom contract for Other */}
        {selectedNftType === 'other' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-1">NFT CONTRACT ADDRESS</label>
              <input type="text" placeholder="0x..." value={customContract} onChange={e => setCustomContract(e.target.value.trim())} className="w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 font-mono text-xs text-white" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-1">CHAIN</label>
              <select value={customChain} onChange={e => setCustomChain(e.target.value as SupportedChainName)} className="rounded-lg border border-gray-700 bg-black/80 px-3 py-2 text-xs text-white">
                <option value="gnosis">Gnosis</option>
                <option value="ethereum">Ethereum</option>
                <option value="base">Base</option>
              </select>
            </div>
          </div>
        )}
        {/* Wallet connection */}
        <div>
          <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-1">WALLET ADDRESS</label>
          {authenticated && connectedWallet ? (
            <div className="w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 flex items-center gap-2">
              <span className="truncate text-sm text-white">{connectedWallet}</span>
              <span className="text-[9px] text-emerald-400">connected</span>
            </div>
          ) : (
            <button onClick={login} className="w-full rounded-lg border border-sky-500/35 bg-sky-500/12 py-2 text-sm text-sky-300">Connect Wallet</button>
          )}
        </div>
        {/* DelegationWizard */}
        {authenticated && selectedNftType !== 'other' && (
          <DelegationWizard
            nftContractAddress={selectedNftType === 'fakenormie' ? FAKE_NORMIE_CONTRACT : NORMIES_CONTRACT}
            nftCollectionName={selectedNftType === 'fakenormie' ? 'FakeNormie' : 'Normies'}
            chain={selectedNftType === 'fakenormie' ? 'gnosis' : 'ethereum'}
          />
        )}
      </div>
      {/* Footer */}
      <div className="text-center text-[10px] text-gray-500">
        Delegation is powered by <a href="https://delegate.xyz" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Delegate V2</a>
      </div>
    </div>
  );
}
