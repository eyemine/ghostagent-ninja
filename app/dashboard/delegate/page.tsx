'use client';

import { useState, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { DelegationWizard } from '../../components/DelegationWizard';
import type { SupportedChainName } from '../../utils/delegate-write';

const GHOSTVAULT_IMG = '/collection-icons/GhostVault.png';
const CI = '/collection-icons';
const ICONS = {
  ens: `${CI}/ens.svg`,
  normie: `${CI}/normie.png`,
  fakenormie: `${CI}/fakenormie.png`,
  chonk: `${CI}/chonk.svg`,
  mooncat: `${CI}/mooncat.png`,
  pownft: `${CI}/pownft.png`,
  other: `${CI}/other.png`,
};

const NORMIES_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const FAKE_NORMIE_CONTRACT = process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT ?? '';
type NftType = 'ens' | 'normie' | 'fakenormie' | 'chonk' | 'mooncat' | 'pownft' | 'other';

interface NftOption {
  k: NftType;
  l: string;
  img: string;
}

const NFT_OPTIONS: NftOption[] = [
  {k:'ens', l:'ENS', img:ICONS.ens},
  {k:'normie', l:'NORMIES\nON ETH', img:ICONS.normie},
  {k:'fakenormie', l:'FAKENORMIE\nON GNOSIS', img:ICONS.fakenormie},
  {k:'chonk', l:'CHONKS\nON BASE', img:ICONS.chonk},
  {k:'mooncat', l:'MOONCATS\nON ETH', img:ICONS.mooncat},
  {k:'pownft', l:'POWNFT\nON ETH', img:ICONS.pownft},
  {k:'other', l:'OTHER\nERC-721', img:ICONS.other},
];

const CHAIN_OPTIONS: {k: SupportedChainName; l: string}[] = [
  {k: 'ethereum', l: 'Ethereum'},
  {k: 'base', l: 'Base'},
  {k: 'gnosis', l: 'Gnosis'},
];

const NFT_TYPE_META: Record<NftType, { nameLabel: string; prefill: string; chain: SupportedChainName; tokenLabel: string; helper: string }> = {
  ens: { nameLabel: 'ENS NAME', prefill: '', chain: 'ethereum', tokenLabel: 'TOKEN ID', helper: 'e.g. vitalik.eth' },
  normie: { nameLabel: 'NORMIE NAME', prefill: 'Normie', chain: 'ethereum', tokenLabel: 'TOKEN ID', helper: 'Find your Normie on OpenSea' },
  fakenormie: { nameLabel: 'FAKENORMIE NAME', prefill: 'abnormie', chain: 'gnosis', tokenLabel: 'TOKEN ID', helper: 'Demo NFT on Gnosis Chain' },
  chonk: { nameLabel: 'CHONK NAME', prefill: 'chonk', chain: 'base', tokenLabel: 'CHONK TOKEN ID', helper: 'Find your Chonk on chonks.xyz' },
  mooncat: { nameLabel: 'MOONCAT NAME', prefill: 'mooncat', chain: 'ethereum', tokenLabel: 'TOKEN ID', helper: 'Find your Mooncat' },
  pownft: { nameLabel: 'ATOM NAME', prefill: 'atom', chain: 'ethereum', tokenLabel: 'TOKEN ID', helper: 'Find your Atom on pownft.com' },
  other: { nameLabel: 'COLLECTION ADDRESS', prefill: '', chain: 'gnosis', tokenLabel: 'TOKEN ID', helper: 'Enter contract address' },
};

export default function DelegatePage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [selectedNftType, setSelectedNftType] = useState<NftType>('normie');
  const [tokenId, setTokenId] = useState('');
  const [primaryName, setPrimaryName] = useState('');
  const [customContract, setCustomContract] = useState('');
  const [customChain, setCustomChain] = useState<SupportedChainName>('gnosis');
  const [demoMintState, setDemoMintState] = useState<'idle'|'minting'|'minted'|'already'|'error'>('idle');
  const [demoTokenId, setDemoTokenId] = useState<string|null>(null);
  const [demoError, setDemoError] = useState('');
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

  const handleNftTypeChange = (t: NftType) => {
    setSelectedNftType(t);
    const meta = NFT_TYPE_META[t];
    if (meta.prefill) setPrimaryName(meta.prefill);
    else setPrimaryName('');
    setTokenId('');
  };

  const resolvedContract = () => {
    if (selectedNftType === 'normie') return NORMIES_CONTRACT;
    if (selectedNftType === 'fakenormie') return FAKE_NORMIE_CONTRACT;
    return customContract;
  };

  const resolvedChain = (): SupportedChainName => {
    if (selectedNftType === 'other') return customChain;
    return NFT_TYPE_META[selectedNftType].chain;
  };

  const ic = "w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder-[var(--muted)] focus:border-[rgba(176,128,92,0.55)] focus:outline-none transition";
  const showMintButton = selectedNftType === 'normie' || selectedNftType === 'fakenormie';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <img src={GHOSTVAULT_IMG} alt="NFT Delegation" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">NFT Delegation</h1>
          <p className="pl-1 mt-0.5 text-xs text-[var(--muted)]">Delegate token-level proxy access without moving your NFT</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-sky-400 mb-1">Phase 1</div>
          <div className="text-xs font-semibold text-white mb-1">Delegate to hot wallet</div>
          <div className="text-[10px] text-gray-400">Connect cold vault, select NFT, verify ownership, sign once.</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-1">Phase 2</div>
          <div className="text-xs font-semibold text-white mb-1">Farcaster Proxy</div>
          <div className="text-[10px] text-gray-400">Mobile access via delegated hot wallet.</div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-orange-500/30 bg-[var(--card)] p-5 space-y-4">
        <p className="text-sm font-semibold text-[#f2eee4]">OG NFTs</p>
        <div>
          <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-2">NFT COLLECTION</label>
          <div className="grid grid-cols-7 gap-3">
            {NFT_OPTIONS.map(opt => (
              <button key={opt.k} onClick={() => handleNftTypeChange(opt.k)} className={`rounded-lg border p-3 ${selectedNftType===opt.k?'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300':'border-gray-700 bg-black/20 text-gray-400'}`}>
                <img src={opt.img} alt={opt.l} className="w-24 h-24 mx-auto mb-1" />
                <span className="text-[10px]">{opt.l}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1">{NFT_TYPE_META[selectedNftType].nameLabel}</label>
            <input className={ic} placeholder={NFT_TYPE_META[selectedNftType].helper} value={primaryName} onChange={e => setPrimaryName(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1">{NFT_TYPE_META[selectedNftType].tokenLabel}</label>
            <input className={ic} placeholder="e.g. 123" value={tokenId} onChange={e => setTokenId(e.target.value.replace(/[^0-9]/g,''))} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1">WALLET ADDRESS (must hold the NFT)</label>
            <div className="flex items-center gap-2 w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2">
              <span className="text-sm text-white truncate flex-1">{connectedWallet || 'Not connected'}</span>
              {connectedWallet && <span className="text-emerald-400 text-xs">✓ connected</span>}
            </div>
          </div>
          {!authenticated && (
            <button onClick={login} className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600">Connect Wallet</button>
          )}
          {authenticated && (
            <button className="w-full rounded-lg bg-sky-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-sky-600">Verify Ownership</button>
          )}
 
        </div>

        {authenticated && (
          <DelegationWizard nftContractAddress={resolvedContract()} nftCollectionName={NFT_TYPE_META[selectedNftType].nameLabel} chain={resolvedChain()} />
        )}
      </div>
      <div className="w-full rounded-2xl border border-pink-500/30 bg-pink-500/5 p-5 space-y-4">
        <p className="text-sm font-semibold text-pink-300">FakeNormie Sandbox</p>
        <p className="text-xs text-gray-400">Mint a demo FakeNormie NFT on Gnosis Chain to test delegation.</p>
        {!authenticated ? (
          <button onClick={login} className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600">Connect Wallet to Mint</button>
        ) : (
          <>
            {demoMintState === 'idle' && (
              <button onClick={handleDemoMint} className="w-full rounded-lg bg-pink-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-pink-600">Mint FakeNormie</button>
            )}
            {demoMintState === 'minting' && <div className="rounded-lg bg-gray-800/50 px-4 py-3 text-sm text-gray-300">Minting...</div>}
            {demoMintState === 'minted' && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                <div className="text-sm text-emerald-400 font-semibold">Minted! Token ID: {demoTokenId}</div>
                <p className="text-xs text-gray-400 mt-1">Select FAKENORMIE above and enter this Token ID to delegate.</p>
              </div>
            )}
            {demoMintState === 'already' && <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-400">You already have a FakeNormie. Check your wallet!</div>}
            {demoMintState === 'error' && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
                <div className="text-sm text-red-400">{demoError}</div>
                <button onClick={() => setDemoMintState('idle')} className="mt-2 text-xs text-sky-400 hover:underline">Try again</button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="text-center text-[10px] text-gray-500">
        Powered by <a href="https://delegate.xyz" target="_blank" rel="noopener" className="text-sky-400">Delegate V2</a>
      </div>
    </div>
  );
}
