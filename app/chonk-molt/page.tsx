'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { EmailAliasToggle } from '../components/EmailAliasToggle';

type NftType = 'ens' | 'chonk' | 'other';
type Step = 'check' | 'confirm' | 'molting' | 'done' | 'error';

interface NftPreview {
  type: NftType;
  tokenId: string;
  name: string;
  imageUrl: string | null;
  chain: 'mainnet' | 'base';
}

interface MoltResult {
  primaryEmail: string;
  aliasEmail: string;
  beaconNft: string;
  beaconTxHash: string;
  beaconTokenId: number | null;
  displayEmail: 'alias';
  message: string;
}

const CHONK_CONTRACT = '0x07152bfde079b5319e5308C43fB1DCf86F040B84';
const ENS_CONTRACT   = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
const MOLT_FEE_XDAI  = 2;
const TREASURY       = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3';

async function fetchEnsImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    const res = await fetch(`https://metadata.ens.domains/mainnet/${ENS_CONTRACT}/${tokenId}`);
    if (!res.ok) return { name: `ENS #${tokenId}`, imageUrl: null };
    const meta = await res.json() as { name?: string; image?: string; image_url?: string };
    return { name: meta.name ?? `ENS #${tokenId}`, imageUrl: meta.image ?? meta.image_url ?? null };
  } catch {
    return { name: `ENS #${tokenId}`, imageUrl: null };
  }
}

async function checkOwner(contract: string, tokenId: string, rpc: string): Promise<string | null> {
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'] }),
    });
    const data = await res.json() as { result?: string };
    if (!data.result || data.result === '0x') return null;
    return ('0x' + data.result.slice(26)).toLowerCase();
  } catch { return null; }
}

export default function OgNftMoltPage() {
  const [step, setStep]                   = useState<Step>('check');
  const [nftType, setNftType]             = useState<NftType>('ens');
  const [primaryName, setPrimaryName]     = useState('');
  const [contractAddr, setContractAddr]   = useState('');
  const [tokenId, setTokenId]             = useState('');
  const [ownerWallet, setOwnerWallet]     = useState('');
  const [paymentTxHash, setPaymentTxHash] = useState('');
  const [ownershipVerified, setOwnershipVerified] = useState(false);
  const [nftPreview, setNftPreview]       = useState<NftPreview | null>(null);
  const [checking, setChecking]           = useState(false);
  const [result, setResult]               = useState<MoltResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [logs, setLogs]                   = useState<string[]>([]);

  function addLog(msg: string) { setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]); }
  function reset() { setOwnershipVerified(false); setNftPreview(null); setError(null); setStep('check'); }

  const resolvedContract = () => nftType === 'ens' ? ENS_CONTRACT : nftType === 'chonk' ? CHONK_CONTRACT : contractAddr;
  const resolvedRpc      = () => nftType === 'chonk' ? 'https://mainnet.base.org' : 'https://cloudflare-eth.com';

  async function handleVerifyOwnership() {
    if (!tokenId || !ownerWallet) return;
    setChecking(true); setError(null); setNftPreview(null);
    try {
      const contract = resolvedContract();
      if (!contract) { setError('Paste the NFT contract address.'); setChecking(false); return; }
      const actualOwner = await checkOwner(contract, tokenId, resolvedRpc());
      if (!actualOwner) { setError(`Token #${tokenId} not found on-chain.`); setOwnershipVerified(false); setChecking(false); return; }
      if (actualOwner !== ownerWallet.toLowerCase()) { setError(`Token #${tokenId} owned by ${actualOwner.slice(0,10)}…, not your wallet.`); setOwnershipVerified(false); setChecking(false); return; }
      let preview: NftPreview;
      if (nftType === 'ens') {
        const { name, imageUrl } = await fetchEnsImage(tokenId);
        preview = { type: 'ens', tokenId, name, imageUrl, chain: 'mainnet' };
      } else {
        preview = { type: nftType, tokenId, name: nftType === 'chonk' ? `Chonk #${tokenId}` : `NFT #${tokenId}`, imageUrl: null, chain: nftType === 'chonk' ? 'base' : 'mainnet' };
      }
      setNftPreview(preview); setOwnershipVerified(true); setStep('confirm');
    } catch { setError('Could not verify ownership — check your connection.'); }
    finally { setChecking(false); }
  }

  async function handleMolt() {
    if (!paymentTxHash) { setError('Paste your 2 xDAI payment tx hash first.'); return; }
    setStep('molting'); setError(null); setLogs([]);
    addLog(`Verifying ${nftPreview?.name ?? 'NFT'} ownership on-chain…`);
    addLog('Verifying 2 xDAI fee payment on Gnosis…');
    try {
      const res = await fetch('/api/chonk-molt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryName, tokenId, ownerWallet, paymentTxHash, nftType, contractAddress: resolvedContract(), nftName: nftPreview?.name }),
      });
      const data = await res.json() as any;
      if (!res.ok || data.status === 'error') { setError(data.error ?? 'Molt failed'); setStep('error'); return; }
      addLog('Minting beacon NFT…');
      addLog('Registering alias email…');
      addLog('Recording molt + upgrading agent tier…');
      addLog('✓ OG NFT Molt Complete');
      setResult(data as MoltResult); setStep('done');
    } catch (err: any) { setError(err?.message ?? 'Molt failed'); setStep('error'); }
  }

  const ic = "w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder-[var(--muted)] focus:border-[rgba(176,128,92,0.55)] focus:outline-none transition";

  return (
    <div className="max-w-xl mx-auto space-y-6 py-2">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10">
            <span className="text-lg">�</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#f2eee4]">OG NFT Molt</h1>
            <p className="text-xs text-[var(--muted)]">Overlay any NFT you own — ENS, Chonk, or any ERC-721 — onto your GhostAgent identity</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold mb-1">Bundle-building scenario</p>
          <p>Own an ENS name that isn&apos;t your primary? Molt it into an agent identity to add provenance before selling a wallet bundle. Each NFT molt creates a unique beacon + alias.</p>
        </div>
        <div className="mt-3 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3 space-y-1 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold">What happens</p>
          <p>✓ Primary email <span className="font-mono text-[#f2eee4]">{primaryName ? `${primaryName}_@nftmail.box` : 'agent_@nftmail.box'}</span> preserved</p>
          <p>✓ Alias for NFT identity created — both route to same inbox</p>
          <p>✓ Beacon NFT minted on Gnosis · Zero lock-in</p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <svg className="h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-[10px] text-amber-300">Fee: <strong>{MOLT_FEE_XDAI} xDAI</strong> on Gnosis · send to <span className="font-mono">{TREASURY.slice(0,10)}…</span> then paste tx hash</p>
        </div>
      </div>

      {/* Check + Confirm */}
      {(step === 'check' || step === 'confirm') && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
          <p className="text-sm font-semibold text-[#f2eee4]">NFT details</p>

          {/* NFT type picker */}
          <div>
            <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-2">NFT TYPE</label>
            <div className="grid grid-cols-3 gap-2">
              {([{k:'ens' as NftType,l:'ENS Name',img:'https://gateway.lighthouse.storage/ipfs/bafkreifv35abvqlhdtc4g2i4xelnmxnhaac7exyu6r24o3fbgthwcmupwy'},{k:'chonk' as NftType,l:'Chonk',img:'https://gateway.lighthouse.storage/ipfs/bafkreiczeqhex35dvj4ewbzn2gyqnbgqb22np5zgp223vnbfhaod6sv4sq'},{k:'other' as NftType,l:'Other ERC-721',img:'https://gateway.lighthouse.storage/ipfs/bafkreid7jamriw5jneuarcq2q6lrbfsqe76eebv6r2rworrnhyj2rpsuem'}]).map(opt => (
                <button key={opt.k} onClick={() => { setNftType(opt.k); reset(); }}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold transition text-center ${
                    nftType === opt.k ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300' : 'border-[rgba(176,128,92,0.2)] bg-black/20 text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div className="flex justify-center"><img src={opt.img} alt={opt.l} className="h-8 w-8 rounded object-contain" /></div><div className="mt-0.5">{opt.l}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">YOUR AGENT NAME (no underscore)</label>
              <input className={ic} placeholder="e.g. paymastr" value={primaryName}
                onChange={e => { setPrimaryName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); reset(); }} />
            </div>
            {nftType === 'other' && (
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">NFT CONTRACT ADDRESS (Ethereum mainnet)</label>
                <input className={ic} placeholder="0x…" value={contractAddr}
                  onChange={e => { setContractAddr(e.target.value.trim()); reset(); }} />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">
                {nftType === 'ens' ? 'ENS TOKEN ID' : nftType === 'chonk' ? 'CHONK TOKEN ID' : 'TOKEN ID'}
              </label>
              <input className={ic} placeholder="e.g. 123" value={tokenId}
                onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); reset(); }} />
              {nftType === 'ens' && (
                <p className="mt-1 text-[10px] text-[var(--muted)]">Token ID = decimal labelhash. Find on{' '}
                  <a href="https://opensea.io/collection/ens" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">OpenSea</a>{' '}or{' '}
                  <a href="https://app.ens.domains" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">app.ens.domains</a>.
                </p>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">YOUR WALLET ADDRESS (must hold the NFT)</label>
              <input className={ic} placeholder="0x…" value={ownerWallet}
                onChange={e => { setOwnerWallet(e.target.value.trim()); reset(); }} />
            </div>
          </div>

          {error && !ownershipVerified && <p className="text-xs text-red-400">{error}</p>}

          {step === 'check' && (
            <button onClick={handleVerifyOwnership}
              disabled={!primaryName || !tokenId || !ownerWallet || checking || (nftType==='other' && !contractAddr)}
              className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
              {checking ? 'Checking ownership…' : 'Verify NFT Ownership →'}
            </button>
          )}

          {step === 'confirm' && ownershipVerified && nftPreview && (
            <div className="space-y-4">
              {/* NFT preview card with image */}
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
                {nftPreview.imageUrl ? (
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[rgba(176,128,92,0.3)]">
                    <Image src={nftPreview.imageUrl} alt={nftPreview.name} fill unoptimized className="object-cover" />
                  </div>
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/8 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={nftPreview.type==='ens' ? 'https://gateway.lighthouse.storage/ipfs/bafkreifv35abvqlhdtc4g2i4xelnmxnhaac7exyu6r24o3fbgthwcmupwy' : nftPreview.type==='chonk' ? 'https://gateway.lighthouse.storage/ipfs/bafkreiczeqhex35dvj4ewbzn2gyqnbgqb22np5zgp223vnbfhaod6sv4sq' : 'https://gateway.lighthouse.storage/ipfs/bafkreid7jamriw5jneuarcq2q6lrbfsqe76eebv6r2rworrnhyj2rpsuem'} alt={nftPreview.type} className="h-10 w-10 rounded object-contain" />
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400">✓ Ownership confirmed</p>
                  <p className="text-sm font-bold text-[#f2eee4]">{nftPreview.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">{nftPreview.chain === 'base' ? 'Base' : 'Ethereum'} · token #{nftPreview.tokenId}</p>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">
                  PAYMENT TX HASH — send {MOLT_FEE_XDAI} xDAI on Gnosis to{' '}
                  <span className="font-mono text-amber-300">{TREASURY.slice(0,10)}…</span>
                </label>
                <input className={ic} placeholder="0x… (Gnosis transaction hash)" value={paymentTxHash}
                  onChange={e => setPaymentTxHash(e.target.value.trim())} />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button onClick={handleMolt} disabled={!paymentTxHash}
                className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
                � Execute OG NFT Molt
              </button>
            </div>
          )}
        </div>
      )}

      {/* Molting */}
      {step === 'molting' && (
        <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 animate-spin text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span className="text-sm font-semibold text-fuchsia-300">Molting in progress…</span>
          </div>
          <div className="space-y-1">{logs.map((l,i) => <p key={i} className="text-[10px] font-mono text-[var(--muted)]">{l}</p>)}</div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
            <div className="flex items-center gap-3">
              {nftPreview?.imageUrl ? (
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-emerald-500/30">
                  <Image src={nftPreview.imageUrl} alt={nftPreview.name} fill unoptimized className="object-cover" />
                </div>
              ) : <span className="text-2xl">�</span>}
              <div>
                <p className="text-lg font-bold text-emerald-300">{result.message}</p>
                <p className="text-xs text-[var(--muted)]">OG NFT identity overlay active</p>
              </div>
            </div>
            <div className="grid gap-2">
              {[
                { label: 'PRIMARY (agent brain)', value: result.primaryEmail, color: 'text-[#f2eee4]' },
                { label: 'ALIAS (NFT identity)',  value: result.aliasEmail,   color: 'text-fuchsia-300' },
                { label: 'BEACON NFT',            value: result.beaconNft,    color: 'text-cyan-300' },
              ].map(({label,value,color}) => (
                <div key={label} className="rounded-lg border border-[rgba(176,128,92,0.2)] bg-black/20 px-3 py-2">
                  <p className="text-[9px] font-semibold tracking-wider text-[var(--muted)] mb-0.5">{label}</p>
                  <p className={`font-mono text-xs ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            {result.beaconTxHash && (
              <a href={`https://gnosisscan.io/tx/${result.beaconTxHash}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-white transition">
                View beacon mint on Gnosisscan ↗
              </a>
            )}
          </div>
          <EmailAliasToggle primaryName={primaryName}
            initialAlias={{ primary: result.primaryEmail, alias: result.aliasEmail, displayEmail: 'alias' }} />
          <div className="flex gap-3">
            <Link href="/dashboard" className="flex-1 rounded-xl border border-[rgba(176,128,92,0.3)] bg-black/30 py-2.5 text-center text-sm font-semibold text-[#f2eee4] transition hover:bg-[rgba(176,128,92,0.1)]">Back to Dashboard</Link>
            <Link href="/dashboard/marketplace" className="flex-1 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-center text-sm font-bold text-white transition hover:opacity-90">View in Marketplace →</Link>
          </div>
        </div>
      )}

      {/* Error */}
      {step === 'error' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3">
            <p className="text-xs font-semibold text-red-400 mb-1">Molt failed</p>
            <p className="text-xs text-red-300/80">{error}</p>
          </div>
          {logs.length > 0 && (
            <div className="rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-3 py-2 space-y-1">
              {logs.map((l,i) => <p key={i} className="text-[10px] font-mono text-[var(--muted)]">{l}</p>)}
            </div>
          )}
          <button onClick={() => { setStep('confirm'); setError(null); }}
            className="w-full rounded-xl border border-[rgba(176,128,92,0.2)] py-2 text-xs text-[var(--muted)] hover:text-white transition">
            Try again
          </button>
        </div>
      )}

    </div>
  );
}
