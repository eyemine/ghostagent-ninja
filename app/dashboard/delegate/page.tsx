'use client';

import { useState, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { DelegationWizard } from '../../components/DelegationWizard';
import type { SupportedChainName } from '../../utils/delegate-write';

const GHOSTAGENT_IMG = '/ghostagent-ninja.png';
const CI = '/collection-icons';
const ICONS = {
  normie: `${CI}/normie.png`,
  chonk: `${CI}/chonk.svg`,
  mooncat: `${CI}/mooncat.png`,
  pownft: `${CI}/pownft.png`,
  other: `${CI}/other.png`,
};

const NORMIES_CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
type NftType = 'normie' | 'chonk' | 'mooncat' | 'pownft' | 'other';

interface NftOption {
  k: NftType;
  l: string;
  img: string;
}

const NFT_OPTIONS: NftOption[] = [
  {k:'normie', l:'NORMIES', img:ICONS.normie},
  {k:'chonk', l:'CHONKS', img:ICONS.chonk},
  {k:'mooncat', l:'MOONCATS', img:ICONS.mooncat},
  {k:'pownft', l:'POWNFT', img:ICONS.pownft},
  {k:'other', l:'OTHER', img:ICONS.other},
];

export default function DelegatePage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [customContract, setCustomContract] = useState('');
  const [customChain, setCustomChain] = useState<SupportedChainName>('gnosis');
  const [selectedNftType, setSelectedNftType] = useState<NftType>('normie');
  const [tokenId, setTokenId] = useState('');
  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy')?.address ?? wallets[0]?.address ?? null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <img src={GHOSTAGENT_IMG} alt="NFT Delegation" className="h-28 w-28 object-contain drop-shadow-[0_0_18px_rgba(184,134,97,0.4)]" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">NFT Delegation</h1>
          <p className="pl-1 mt-0.5 text-xs text-[var(--muted)]">Delegate token-level proxy access</p>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {NFT_OPTIONS.map(opt => (
          <button key={opt.k} onClick={() => setSelectedNftType(opt.k)} className={`rounded-lg border p-3 ${selectedNftType===opt.k?'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300':'border-gray-700 bg-black/20 text-gray-400'}`}>
            <img src={opt.img} alt={opt.l} className="w-20 h-20 mx-auto mb-1" />
            <span className="text-[10px]">{opt.l}</span>
          </button>
        ))}
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1">TOKEN ID</label>
        <input className="w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-white" value={tokenId} onChange={e => setTokenId(e.target.value.replace(/[^0-9]/g,''))} />
      </div>

      {authenticated && selectedNftType === 'normie' && (
        <DelegationWizard nftContractAddress={NORMIES_CONTRACT} nftCollectionName="Normies" chain="ethereum" />
      )}

      <div className="text-center text-[10px] text-gray-500">
        Powered by <a href="https://delegate.xyz" target="_blank" rel="noopener" className="text-sky-400">Delegate V2</a>
      </div>
    </div>
  );
}
