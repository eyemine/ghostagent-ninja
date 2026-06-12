'use client';

import { useState, useCallback } from 'react';
import { keccak256, toHex } from 'viem';
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

const NORMIES_CONTRACT   = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const CHONK_CONTRACT     = '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9';
const MOONCAT_CONTRACT   = '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69';
const POWNFT_CONTRACT    = '0x9abb7bddc43fa67c76a62d8c016513827f59be1b';
const FAKE_NORMIE_CONTRACT = process.env.NEXT_PUBLIC_FAKE_NORMIE_CONTRACT ?? '';
const NFT_RPCS: Partial<Record<NftType, string>> = {
  ens: 'https://cloudflare-eth.com', normie: 'https://cloudflare-eth.com',
  fakenormie: 'https://rpc.gnosischain.com', chonk: 'https://mainnet.base.org',
  mooncat: 'https://cloudflare-eth.com', pownft: 'https://cloudflare-eth.com',
};
type NftType = 'ens' | 'normie' | 'fakenormie' | 'chonk' | 'mooncat' | 'pownft' | 'other';

interface NftOption {
  k: NftType;
  l: string;
  img: string;
}

const NFT_OPTIONS: NftOption[] = [
  {k:'ens', l:'ENS\nName', img:ICONS.ens},
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
  normie: { nameLabel: 'NORMIE NAME', prefill: 'normie', chain: 'ethereum', tokenLabel: 'NORMIE TOKEN ID', helper: 'e.g. 1234' },
  fakenormie: { nameLabel: 'AGENT NAME', prefill: '', chain: 'gnosis', tokenLabel: 'FAKE TYPE', helper: 'Token ID (e.g. 1)' },
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
    if (meta.prefill) setPrimaryName(meta.prefill); else setPrimaryName('');
    setTokenId(''); setVerifyResult(null); setVerifyError('');
  };

  const resolvedContract = () => {
    if (selectedNftType === 'normie')     return NORMIES_CONTRACT;
    if (selectedNftType === 'fakenormie') return FAKE_NORMIE_CONTRACT;
    if (selectedNftType === 'chonk')      return CHONK_CONTRACT;
    if (selectedNftType === 'mooncat')    return MOONCAT_CONTRACT;
    if (selectedNftType === 'pownft')     return POWNFT_CONTRACT;
    return customContract;
  };

  const resolvedChain = (): SupportedChainName => {
    if (selectedNftType === 'other') return customChain;
    return NFT_TYPE_META[selectedNftType].chain;
  };

  const ic = "w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder-[var(--muted)] focus:border-[rgba(176,128,92,0.55)] focus:outline-none transition";
  const [ensResolving, setEnsResolving] = useState(false);
  const [verifying, setVerifying]       = useState(false);
  const [verifyResult, setVerifyResult] = useState<'ok'|'fail'|null>(null);
  const [verifyError, setVerifyError]   = useState('');

  async function resolveEnsName() {
    if (!primaryName) return;
    setEnsResolving(true); setVerifyResult(null);
    try {
      const label = primaryName.replace(/\.eth$/i, '').toLowerCase();
      const labelHash = keccak256(toHex(label));
      setTokenId(BigInt(labelHash).toString(10));
    } catch { }
    finally { setEnsResolving(false); }
  }

  async function handleVerifyOwnership() {
    if (!tokenId || !connectedWallet) return;
    const contract = resolvedContract();
    if (!contract) { setVerifyResult('fail'); setVerifyError('Contract address required'); return; }
    setVerifying(true); setVerifyResult(null); setVerifyError('');
    try {
      const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
      const rpc = NFT_RPCS[selectedNftType] ?? 'https://cloudflare-eth.com';
      const res = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call',
          params:[{ to: contract, data: `0x6352211e${tokenIdHex}` }, 'latest'] }),
      });
      const json = await res.json() as { result?: string; error?: unknown };
      if (!json.result || json.result === '0x' || json.error) {
        setVerifyResult('fail'); setVerifyError(`Token #${tokenId} not found on-chain`);
      } else {
        const owner = `0x${json.result.slice(26)}`.toLowerCase();
        if (owner === connectedWallet.toLowerCase()) {
          setVerifyResult('ok');
        } else {
          setVerifyResult('fail');
          setVerifyError(`Token #${tokenId} is owned by ${owner.slice(0,10)}… — not your connected wallet`);
        }
      }
    } catch { setVerifyResult('fail'); setVerifyError('Could not verify — check your connection'); }
    finally { setVerifying(false); }
  }

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
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-semibold text-white">Delegate to hot wallet</span>
            <div className="group relative">
              <span className="text-gray-500 cursor-help text-[11px]">ⓘ</span>
              <div className="hidden group-hover:block absolute z-10 left-0 top-5 w-64 p-3 bg-slate-900 border border-slate-700 rounded-lg text-[10px] text-gray-300 leading-relaxed shadow-xl">
                Your hot wallet gets access to chat, email &amp; social features. It cannot transfer your NFT or move treasury funds — those require your cold wallet.
              </div>
            </div>
          </div>
          <div className="text-[10px] text-gray-400">Connect cold vault, select NFT, verify ownership, sign once.</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-1">Phase 2</div>
          <div className="text-xs font-semibold text-white mb-1">Farcaster Proxy</div>
          <div className="text-[10px] text-gray-400">Mobile access via delegated hot wallet.</div>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-[rgba(176,128,92,0.2)] bg-[var(--card)] p-5 space-y-4">
        <p className="text-sm font-semibold text-[#f2eee4]">OG NFTs</p>
        <div>
          <label className="block text-[10px] font-semibold tracking-wider text-gray-400 mb-2">NFT COLLECTION</label>
          <div className="grid grid-cols-7 gap-3">
            {NFT_OPTIONS.map(opt => (
              <button key={opt.k} onClick={() => handleNftTypeChange(opt.k)} className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition ${selectedNftType===opt.k?'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300':'border-[rgba(176,128,92,0.2)] bg-black/20 text-[var(--muted)] hover:text-[#f2eee4]'}`}>
                <img src={opt.img} alt={opt.l} className="w-24 h-24 rounded object-contain flex-shrink-0" />
                <span className="whitespace-pre-line leading-tight text-[10px] text-center">{opt.l}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">

          {selectedNftType === 'ens' ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">ENS NAME</label>
                <div className="flex gap-2">
                  <input className={`${ic} flex-1`} placeholder="e.g. vitalik"
                    value={primaryName}
                    onChange={e => { setPrimaryName(e.target.value.toLowerCase().replace(/[^a-z0-9-.]/g,'')); setTokenId(''); setVerifyResult(null); }} />
                  <button onClick={resolveEnsName} disabled={!primaryName || ensResolving}
                    className="shrink-0 rounded-lg bg-fuchsia-600/80 px-4 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-600 disabled:opacity-40">
                    {ensResolving ? 'Resolving…' : 'Resolve →'}
                  </button>
                </div>
              </div>
              {tokenId && (
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 mb-1">RESOLVED TOKEN ID</label>
                  <div className={`${ic} opacity-70 cursor-not-allowed font-mono text-xs truncate`}>{tokenId}</div>
                </div>
              )}
            </>
          ) : selectedNftType === 'normie' ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">NORMIE TOKEN ID</label>
                <input className={ic} placeholder="e.g. 1234" value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); setVerifyResult(null); }} />
              </div>
              {tokenId && <p className="text-[10px] text-[var(--muted)]">→ <span className="font-mono text-fuchsia-300">normie.{tokenId}@nftmail.box</span></p>}
            </>
          ) : selectedNftType === 'fakenormie' ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">AGENT NAME (from NFT title)</label>
                <div className="flex items-center gap-2">
                  <div className={`${ic} flex-1 opacity-70 cursor-not-allowed italic text-[var(--muted)]`}>Fake</div>
                  <span className="text-[var(--muted)] font-mono text-lg select-none">.</span>
                  <div className={`${ic} flex-1 opacity-70 cursor-not-allowed italic text-[var(--muted)]`}>Normie</div>
                </div>
                <p className="mt-1 text-[10px] text-[var(--muted)] italic">Populated from your NFT&apos;s on-chain title after verification</p>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">FAKE TYPE</label>
                <input className={ic} placeholder="Token ID (e.g. 1)" value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); setVerifyResult(null); }} />
              </div>
            </>
          ) : selectedNftType === 'other' ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">CONTRACT ADDRESS</label>
                <input className={ic} placeholder="0x…" value={customContract}
                  onChange={e => { setCustomContract(e.target.value.trim()); setVerifyResult(null); }} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">CHAIN</label>
                <select className={ic} value={customChain} onChange={e => setCustomChain(e.target.value as SupportedChainName)}>
                  {CHAIN_OPTIONS.map(c => <option key={c.k} value={c.k}>{c.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">TOKEN ID</label>
                <input className={ic} placeholder="e.g. 123" value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); setVerifyResult(null); }} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">{NFT_TYPE_META[selectedNftType].nameLabel}</label>
                <div className={`${ic} opacity-70 cursor-not-allowed`}>{NFT_TYPE_META[selectedNftType].prefill}</div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">{NFT_TYPE_META[selectedNftType].tokenLabel}</label>
                <input className={ic} placeholder="e.g. 123" value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); setVerifyResult(null); }} />
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1">WALLET ADDRESS (must hold the NFT)</label>
            <div className="flex items-center gap-2 w-full rounded-lg border border-gray-700 bg-black/30 px-3 py-2">
              <span className="text-sm text-white truncate flex-1">{connectedWallet || 'Not connected'}</span>
              {connectedWallet && <span className="text-emerald-400 text-xs">✓ connected</span>}
            </div>
          </div>

          {verifyResult === 'ok' && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-400 font-semibold">✓ Ownership verified — proceed to delegate below</div>
          )}
          {verifyResult === 'fail' && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-xs text-red-400">{verifyError}</div>
          )}

          {!authenticated ? (
            <button onClick={login} className="w-full rounded-lg bg-fuchsia-600/80 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-600">Connect Wallet</button>
          ) : (
            <button onClick={handleVerifyOwnership} disabled={!tokenId || !connectedWallet || verifying}
              className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
              {verifying ? 'Checking…' : 'Verify NFT Ownership →'}
            </button>
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
      {/* Safeguards explainer */}
      <details className="group w-full rounded-2xl border border-slate-700/40 bg-slate-900/20 overflow-hidden">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold text-[#f2eee4] hover:text-white list-none">
          <span>🔒 How are my assets protected?</span>
          <svg className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 9l-7 7-7-7"/></svg>
        </summary>
        <div className="px-5 pb-5 space-y-4 text-xs text-gray-400">

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Hot Wallet Can</p>
              {['Read & send emails (nftmail.box)', 'Update agent personality & settings', 'Chat with other agents', 'Manage social profiles', 'Browse agent features'].map(t => (
                <div key={t} className="flex items-start gap-2"><span className="text-emerald-400 shrink-0">✓</span><span>{t}</span></div>
              ))}
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400">Hot Wallet Cannot</p>
              {['Transfer or sell your NFT', 'Move funds from your Safe treasury', 'Change ownership permissions', 'Delete your agent'].map(t => (
                <div key={t} className="flex items-start gap-2"><span className="text-red-400 shrink-0">✗</span><span>{t}</span></div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-4 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[rgba(176,128,92,0.8)] mb-2">Think of it like…</p>
            <div className="flex items-center gap-3"><span className="text-lg">🔐</span><span><span className="text-[#f2eee4] font-semibold">Cold Wallet</span> = Your bank vault key — holds the NFT &amp; treasury</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">💳</span><span><span className="text-[#f2eee4] font-semibold">Hot Wallet</span> = Your debit card — daily access, limited spend</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">🛡️</span><span><span className="text-[#f2eee4] font-semibold">Safeguards</span> = Spending limits &amp; fraud protection</span></div>
          </div>

          <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/20 p-4 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-2">You&apos;re always in control</p>
            {['Revoke delegation anytime from delegate.xyz', 'Hot wallet access expires if NFT is transferred', 'All treasury actions require cold wallet signature', 'Full audit trail of all hot wallet activity'].map(t => (
              <div key={t} className="flex items-center gap-2"><span className="text-emerald-400">✓</span><span>{t}</span></div>
            ))}
          </div>

          <details className="rounded-xl border border-slate-700/40 bg-slate-900/30 overflow-hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500 hover:text-gray-300 list-none">Technical details: how Safeguards work ▸</summary>
            <div className="px-4 pb-4 pt-2 font-mono text-[10px] text-slate-400 space-y-2">
              <p>GhostAgent uses <a href="https://delegate.xyz" target="_blank" rel="noopener" className="text-sky-400 underline">Delegate V2</a> for token-level permissions. The hot wallet signs once to prove ownership of its keys; the frontend checks <code className="text-fuchsia-300">checkDelegateForERC721(hotWallet, coldWallet, NFTcontract, tokenId)</code> against the registry.</p>
              <pre className="mt-2 rounded bg-black/40 p-3 text-[9px] leading-relaxed whitespace-pre-wrap">{`checkDelegateForERC721(hotWallet, coldWallet, NFT) = true
→ ✅ Social / comms / brain config: allowed
→ ❌ Asset transfers / Safe treasury: cold wallet only

Future: Safe Guard intercepts execTransaction() and
validates delegation on-chain in a single block.`}</pre>
            </div>
          </details>

        </div>
      </details>

      <div className="text-center text-[10px] text-gray-500">
        Powered by <a href="https://delegate.xyz" target="_blank" rel="noopener" className="text-sky-400">Delegate V2</a>
      </div>
    </div>
  );
}
