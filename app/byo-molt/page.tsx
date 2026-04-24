'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { keccak256, toHex, createWalletClient, custom, parseEther } from 'viem';
import { gnosis } from '../utils/chains';
import { MercuryoButton } from '../components/MercuryoWidget';
import { EmailAliasToggle } from '../components/EmailAliasToggle';
import type { AgentRegistryEntry } from '../api/agents/route';

type NftType = 'ens' | 'chonk' | 'pownft' | 'normie' | 'mooncat' | 'other';
type Step = 'check' | 'select-agent' | 'confirm' | 'molting' | 'done' | 'error';
type MoltTarget = 'new-agent' | 'existing-agent';

interface NftPreview {
  type: NftType;
  tokenId: string;
  name: string;
  imageUrl: string | null;
  chain: 'mainnet' | 'base';
}

interface MoltResult {
  primaryEmail: string;
  humanEmail: string;
  agentEmail: string;
  aliasEmail: string;
  beaconNft: string;
  beaconTxHash: string;
  beaconTokenId: number | null;
  displayEmail: 'alias';
  message: string;
}

const CHONK_CONTRACT   = '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9';
const ENS_CONTRACT     = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85';
const POWNFT_CONTRACT  = '0x9abb7bddc43fa67c76a62d8c016513827f59be1b';
const NORMIE_CONTRACT  = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';
const MOONCAT_CONTRACT = '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69';
const GNOSIS_TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3'; // Treasury for BYO molt fees

// Fee structure based on current tier
const TIER_FEES = {
  'basic': 10,   // LARVA → PUPA (Free to paid tier)
  'lite': 14,    // PUPA → IMAGO  
  'premium': 2,  // IMAGO → IMAGO (identity change)
} as const;

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

async function fetchChonkImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (!alchemyKey) return { name: `Chonk #${tokenId}`, imageUrl: null };
    
    // Use Alchemy NFT API to get the image
    const res = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTMetadata?contractAddress=${CHONK_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
    if (!res.ok) return { name: `Chonk #${tokenId}`, imageUrl: null };
    const data = await res.json() as any;
    // For video NFTs, use pngUrl (thumbnail), otherwise use cachedUrl
    const isVideo = data?.image?.contentType?.startsWith('video/');
    const imageUrl = isVideo 
      ? (data?.image?.pngUrl || data?.image?.thumbnailUrl || null)
      : (data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null);
    return { name: data?.name || `Chonk #${tokenId}`, imageUrl };
  } catch {
    return { name: `Chonk #${tokenId}`, imageUrl: null };
  }
}

async function fetchPownftImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    // Use Alchemy NFT API for Ethereum mainnet
    const res = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'}/getNFTMetadata?contractAddress=${POWNFT_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
    if (!res.ok) return { name: `ATOM #${tokenId}`, imageUrl: null };
    const data = await res.json() as any;
    // For video NFTs, use pngUrl (thumbnail), otherwise use cachedUrl
    const isVideo = data?.image?.contentType?.startsWith('video/');
    const imageUrl = isVideo 
      ? (data?.image?.pngUrl || data?.image?.thumbnailUrl || null)
      : (data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null);
    return { name: data?.name || `ATOM #${tokenId}`, imageUrl };
  } catch {
    return { name: `ATOM #${tokenId}`, imageUrl: null };
  }
}

async function fetchNormieImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    // Use Alchemy NFT API for Ethereum mainnet
    const res = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'}/getNFTMetadata?contractAddress=${NORMIE_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
    if (!res.ok) return { name: `Normie #${tokenId}`, imageUrl: null };
    const data = await res.json() as any;
    // For video NFTs, use pngUrl (thumbnail), otherwise use cachedUrl
    const isVideo = data?.image?.contentType?.startsWith('video/');
    const imageUrl = isVideo 
      ? (data?.image?.pngUrl || data?.image?.thumbnailUrl || null)
      : (data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null);
    return { name: data?.name || `Normie #${tokenId}`, imageUrl };
  } catch {
    return { name: `Normie #${tokenId}`, imageUrl: null };
  }
}

async function fetchMooncatImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    const res = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'}/getNFTMetadata?contractAddress=${MOONCAT_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
    if (!res.ok) return { name: `MoonCat #${tokenId}`, imageUrl: null };
    const data = await res.json() as any;
    const imageUrl = data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null;
    return { name: data?.name || `MoonCat #${tokenId}`, imageUrl };
  } catch {
    return { name: `MoonCat #${tokenId}`, imageUrl: null };
  }
}

// Check agent's current tier to determine correct fee
async function getAgentTier(agentName: string): Promise<{ tier: keyof typeof TIER_FEES; fee: number }> {
  try {
    const res = await fetch('https://nftmail-email-worker.richard-159.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAcctTier', localPart: agentName, tld: '' }),
    });
    if (res.ok) {
      const data = await res.json() as { tier?: string };
      const tier = (data.tier ?? 'basic') as keyof typeof TIER_FEES;
      return { tier, fee: TIER_FEES[tier] };
    }
  } catch {
    // Default to basic tier if check fails
  }
  return { tier: 'basic', fee: TIER_FEES.basic };
}

async function fetchErc721Image(contract: string, tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    // First try tokenURI
    const rpc = contract === CHONK_CONTRACT ? 'https://mainnet.base.org' : 'https://cloudflare-eth.com';
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        jsonrpc: '2.0', 
        id: 1, 
        method: 'eth_call', 
        params: [{ to: contract, data: '0xc87b56dd' + tokenIdHex }, 'latest'] 
      }),
    });
    const data = await res.json() as { result?: string };
    if (!data.result || data.result === '0x') return { name: `NFT #${tokenId}`, imageUrl: null };
    
    // Decode tokenURI (it's usually a string)
    const uri = data.result.startsWith('0x') 
      ? Buffer.from(data.result.slice(2), 'hex').toString().replace(/\0.*$/, '')
      : data.result;
    
    if (!uri || !uri.startsWith('http')) return { name: `NFT #${tokenId}`, imageUrl: null };
    
    // Fetch metadata from URI
    const metaRes = await fetch(uri);
    if (!metaRes.ok) return { name: `NFT #${tokenId}`, imageUrl: null };
    const meta = await metaRes.json() as any;
    return { name: meta.name ?? `NFT #${tokenId}`, imageUrl: meta.image ?? null };
  } catch {
    return { name: `NFT #${tokenId}`, imageUrl: null };
  }
}

async function checkOwner(contract: string, tokenId: string, rpc: string): Promise<string | null> {
  const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'] }),
  });
  const data = await res.json() as { result?: string; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? 'RPC error');
  if (!data.result || data.result === '0x' || data.result === '0x0000000000000000000000000000000000000000000000000000000000000000') return null;
  return ('0x' + data.result.slice(26)).toLowerCase();
}

// Build version to force cache invalidation
const BUILD_VERSION = '2024-04-14-22-10-fix-targetTld';

export default function OgNftMoltPage() {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address ?? '';

  const searchParams = useSearchParams();
  const preselectedAgent = searchParams.get('agent') ?? undefined;

  const [step, setStep]                   = useState<Step>('check');
  const [nftType, setNftType]             = useState<NftType>('ens');
  const [primaryName, setPrimaryName]     = useState('');
  const [contractAddr, setContractAddr]   = useState('');
  const [tokenId, setTokenId]             = useState('');
  const [ownerWallet, setOwnerWallet]     = useState('');
  const [paymentTxHash, setPaymentTxHash] = useState('');
  const [couponCode, setCouponCode]       = useState('');
  const [couponValid, setCouponValid]     = useState(false);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponError, setCouponError]     = useState<string | null>(null);
  const [ownershipVerified, setOwnershipVerified] = useState(false);
  const [nftPreview, setNftPreview]       = useState<NftPreview | null>(null);
  const [checking, setChecking]           = useState(false);
  const [result, setResult]               = useState<MoltResult | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [logs, setLogs]                   = useState<string[]>([]);
  const [userAgents, setUserAgents]       = useState<AgentRegistryEntry[]>([]);
  const [moltTarget, setMoltTarget]       = useState<MoltTarget>('new-agent');
  const [selectedAgent, setSelectedAgent]   = useState<string>(preselectedAgent ?? '');

  // Tier and fee state
  const [currentTier, setCurrentTier] = useState<keyof typeof TIER_FEES>('basic');
  const [moltFee, setMoltFee] = useState<number>(TIER_FEES.basic);
  const [paying, setPaying] = useState(false);

  function addLog(msg: string) { setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]); }
  function reset() { setOwnershipVerified(false); setNftPreview(null); setError(null); setStep('check'); }

  // Fetch user's agents when wallet changes
  useEffect(() => {
    fetchUserAgents();
  }, [connectedWallet]);

  // Check agent tier when primary name changes (for overlay molts)
  useEffect(() => {
    if (moltTarget === 'existing-agent' && selectedAgent) {
      getAgentTier(selectedAgent).then(({ tier, fee }) => {
        setCurrentTier(tier);
        setMoltFee(fee);
      });
    } else {
      // New agent starts at basic tier
      setCurrentTier('basic');
      setMoltFee(TIER_FEES.basic);
    }
  }, [selectedAgent, moltTarget]);

  // Fetch user's agents (beacon NFTs owned by connected wallet)
  async function fetchUserAgents() {
    if (!connectedWallet) {
      setUserAgents([]);
      return;
    }
    
    try {
      // Fetch beacon NFTs owned by the connected wallet (EOA)
      const res = await fetch(`/api/my-nfts?wallet=${connectedWallet}`);
      
      if (!res.ok) {
        setUserAgents([]);
        return;
      }
      
      const data = await res.json() as { nfts?: Array<{ name: string; namespace: string; tokenId: number }> };
      const nfts = data.nfts ?? [];
      
      // Fetch agent card metadata to get NFT images
      const agentsWithImages = await Promise.all(
        nfts.map(async (nft) => {
          try {
            const cardRes = await fetch(`/api/agent-card?agent=${nft.name}`);
            if (cardRes.ok) {
              const card = await cardRes.json() as any;
              return {
                name: nft.name,
                tld: nft.namespace,
                profileUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/agent/${nft.name}`,
                agentCardUrl: `/api/agent-card?agent=${nft.name}`,
                a2aCardUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/.well-known/agent-card.json`,
                erc8004: {},
                imageUrl: card.image || null,
              };
            }
          } catch {
            // Failed to fetch card, use default
          }
          return {
            name: nft.name,
            tld: nft.namespace,
            profileUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/agent/${nft.name}`,
            agentCardUrl: `/api/agent-card?agent=${nft.name}`,
            a2aCardUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja'}/.well-known/agent-card.json`,
            erc8004: {},
            imageUrl: null,
          };
        })
      );
      
      setUserAgents(agentsWithImages);
    } catch {
      setUserAgents([]);
    }
  }

  async function handleValidateCoupon() {
    if (!couponCode.trim()) return;
    setCouponChecking(true); setCouponError(null); setCouponValid(false);
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim() }),
      });
      const data = await res.json() as { valid: boolean; reason?: string };
      if (data.valid) { setCouponValid(true); }
      else { setCouponError(data.reason ?? 'Invalid coupon'); }
    } catch { setCouponError('Could not validate coupon.'); }
    finally { setCouponChecking(false); }
  }

  // Auto-fill wallet from Privy connected wallet
  useEffect(() => {
    if (connectedWallet && !ownerWallet) setOwnerWallet(connectedWallet);
  }, [connectedWallet, ownerWallet]);

  const resolvedContract = () => {
    if (nftType === 'ens') return ENS_CONTRACT;
    if (nftType === 'chonk') return CHONK_CONTRACT;
    if (nftType === 'pownft') return POWNFT_CONTRACT;
    if (nftType === 'normie') return NORMIE_CONTRACT;
    if (nftType === 'mooncat') return MOONCAT_CONTRACT;
    return contractAddr;
  };
  const resolvedRpc = () => {
    if (nftType === 'chonk') return `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'}`;
    return `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'demo'}`;
  };

  const [ensResolving, setEnsResolving] = useState(false);

  // ENS: compute labelhash from name → token ID
  async function resolveEnsName() {
    if (!primaryName) return;
    setEnsResolving(true); setError(null);
    try {
      const label = primaryName.replace(/\.eth$/i, '').toLowerCase();
      const labelHash = keccak256(toHex(label));
      const tid = BigInt(labelHash).toString(10);
      setTokenId(tid);
      // verify it exists via metadata API
      const meta = await fetch(`https://metadata.ens.domains/mainnet/${ENS_CONTRACT}/${tid}`);
      if (!meta.ok) { setError(`ENS name "${label}.eth" not found.`); }
    } catch { setError('Could not resolve ENS name.'); }
    finally { setEnsResolving(false); }
  }

  const NFT_TYPE_META: Record<NftType, { nameLabel: string; prefill: string }> = {
    ens:     { nameLabel: 'ENS NAME', prefill: '' },
    chonk:   { nameLabel: 'CHONK NAME', prefill: 'chonk' },
    pownft:  { nameLabel: 'ATOM NAME', prefill: 'atom' },
    normie:  { nameLabel: 'NORMIE NAME', prefill: 'normie' },
    mooncat: { nameLabel: 'MOONCAT NAME', prefill: 'mooncat' },
    other:   { nameLabel: 'AGENT NAME', prefill: '' },
  };

  function selectNftType(t: NftType) {
    setNftType(t);
    const meta = NFT_TYPE_META[t];
    if (meta.prefill) setPrimaryName(meta.prefill);
    else setPrimaryName('');
    reset();
  }

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
      } else if (nftType === 'chonk') {
        const { name, imageUrl } = await fetchChonkImage(tokenId);
        preview = { type: 'chonk', tokenId, name, imageUrl, chain: 'base' };
      } else if (nftType === 'pownft') {
        const { name, imageUrl } = await fetchPownftImage(tokenId);
        preview = { type: 'pownft', tokenId, name, imageUrl, chain: 'mainnet' };
      } else if (nftType === 'normie') {
        const { name, imageUrl } = await fetchNormieImage(tokenId);
        preview = { type: 'normie', tokenId, name, imageUrl, chain: 'mainnet' };
      } else if (nftType === 'mooncat') {
        const { name, imageUrl } = await fetchMooncatImage(tokenId);
        preview = { type: 'mooncat', tokenId, name, imageUrl, chain: 'mainnet' };
      } else {
        // For 'other' ERC721, try to fetch metadata via tokenURI
        const { name, imageUrl } = await fetchErc721Image(contract, tokenId);
        preview = { type: 'other', tokenId, name, imageUrl, chain: 'mainnet' };
      }
      setNftPreview(preview); setOwnershipVerified(true); await fetchUserAgents(); setStep('select-agent');
    } catch { setError('Could not verify ownership — check your connection.'); }
    finally { setChecking(false); }
  }

  async function handlePayWithWallet() {
    setPaying(true); setError(null);
    try {
      const provider = (window as unknown as { ethereum?: unknown }).ethereum;
      if (!provider) throw new Error('No wallet provider — connect MetaMask or WalletConnect');
      const walletClient = createWalletClient({ chain: gnosis, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [account] = await walletClient.requestAddresses();
      const txHash = await walletClient.sendTransaction({
        account,
        to: GNOSIS_TREASURY as `0x${string}`,
        value: parseEther(String(moltFee)),
        chain: gnosis,
      });
      setPaymentTxHash(txHash);
      await executeMolt(txHash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg); setPaying(false);
    }
  }

  async function executeMolt(txHash: string) {
    setStep('molting'); setError(null); setLogs([]);
    addLog(`Verifying ${nftPreview?.name ?? 'NFT'} ownership on-chain…`);
    addLog(txHash ? 'Verifying 2 xDAI fee payment on Gnosis…' : 'Coupon applied — fee waived');
    try {
      const res = await fetch(`/api/byo-molt-v2?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryName, tokenId, ownerWallet, paymentTxHash: txHash,
          nftType, contractAddress: resolvedContract(), nftName: nftPreview?.name,
          moltTarget, targetAgent: moltTarget === 'existing-agent' ? selectedAgent : undefined,
          targetTld: moltTarget === 'existing-agent' ? 'molt.gno' : 'agent.gno', // new-agent → agent.gno, overlay → molt.gno
          _t: Date.now(), // Cache-busting timestamp
          buildVersion: BUILD_VERSION, // Debug: verify latest build
          ...(couponValid ? { couponCode: couponCode.trim() } : {}),
        }),
      });
      const data = await res.json() as any;
      if (!res.ok || data.status === 'error') { setError(data.error ?? 'Molt failed'); setStep('error'); return; }
      addLog(moltTarget === 'existing-agent' ? 'Updating agent identity overlay…' : 'Minting beacon NFT…');
      addLog('Registering alias email…');
      addLog('Recording molt + upgrading agent tier…');
      addLog('✓ BYO NFT Molt Complete');
      setResult(data as MoltResult); setStep('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg); setStep('error');
    } finally { setPaying(false); }
  }

  async function handleMolt() {
    if (couponValid) { await executeMolt(''); return; }
    if (!paymentTxHash) { await handlePayWithWallet(); return; }
    await executeMolt(paymentTxHash);
  }

  const ic = "w-full rounded-lg border border-[rgba(176,128,92,0.25)] bg-black/30 px-3 py-2 text-sm text-[#f2eee4] placeholder-[var(--muted)] focus:border-[rgba(176,128,92,0.55)] focus:outline-none transition";

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header — marketplace-style */}
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://gateway.lighthouse.storage/ipfs/bafkreiejmu35lnu34e6dm754c6tad34nogywf2oslbql6lzcdpz4acxjue" alt="BYO NFT Molt" className="h-28 w-28 shrink-0 rounded-xl border border-fuchsia-500/40 object-contain" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">BYO NFT Molt</h1>
          <p className="mt-1 pl-1 text-sm text-[var(--muted)]">Overlay an NFT you own — ENS, Chonk, or Verified Collection — onto your GhostAgent identity</p>
        </div>
      </div>

      <div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold mb-1">Bundle-building scenario</p>
          <p>Own an ENS name that you would like to augment? Molt it into an agent identity to add provenance and utility. Flaunt it, or sell a wallet bundle. Each NFT molt a Gnosis SAFE, NFTmail inbox and Story IP claim.</p>
        </div>
        <div className="mt-3 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3 space-y-1 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold">What happens</p>
          <p>✓ Primary email <span className="font-mono text-[#f2eee4]">{
            nftType === 'chonk' ? `chonk.${tokenId || '[tokenID]'}@nftmail.box` :
            nftType === 'pownft' ? `atom.${tokenId || '[tokenID]'}@nftmail.box` :
            nftType === 'normie' ? `normie.${tokenId || '[tokenID]'}@nftmail.box` :
            primaryName ? `${primaryName}@nftmail.box` : 'agent@nftmail.box'
          }</span></p>
          <p className="ml-3">+ Agent email <span className="font-mono text-[#f2eee4]">{
            nftType === 'pownft' ? `atom.${tokenId || '[tokenID]'}_@nftmail.box` :
            nftType === 'normie' ? `normie.${tokenId || '[tokenID]'}_@nftmail.box` :
            primaryName ? `${primaryName}_@nftmail.box` : 'agent_@nftmail.box'}
          </span> preserved</p>
          <p>✓ Beacon NFT <span className="font-mono text-[#f2eee4]">{
            (() => {
              const beaconTld = moltTarget === 'existing-agent' ? 'molt.gno' : 'agent.gno';
              return nftType === 'chonk' ? `chonk-${tokenId || '[tokenID]'}.${beaconTld}` :
                nftType === 'pownft' ? `atom-${tokenId || '[tokenID]'}.${beaconTld}` :
                nftType === 'normie' ? `normie-${tokenId || '[tokenID]'}.${beaconTld}` :
                primaryName ? `${primaryName}.${beaconTld}` : `[name].${beaconTld}`;
            })()
          }</span> minted to Gnosis Safe · Zero lock-in</p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <svg className="h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-[10px] text-amber-300">Fee: <strong>{moltFee} xDAI</strong> on Gnosis ({currentTier.toUpperCase()} tier) · send to <span className="font-mono">{GNOSIS_TREASURY.slice(0,10)}…</span> then paste tx hash</p>
        </div>
      </div>

      {/* Check + Select Agent + Confirm */}
      {(step === 'check' || step === 'select-agent' || step === 'confirm') && (
        <div className="rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
          <p className="text-sm font-semibold text-[#f2eee4]">OG NFTs</p>

          {/* NFT type picker */}
          <div>
            <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-2">NFT COLLECTION</label>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {([
                {k:'ens' as NftType,l:'ENS Name',img:'https://gateway.lighthouse.storage/ipfs/bafkreifv35abvqlhdtc4g2i4xelnmxnhaac7exyu6r24o3fbgthwcmupwy'},
                {k:'chonk' as NftType,l:'CHONKS\nON BASE',img:'https://gateway.lighthouse.storage/ipfs/bafkreiczeqhex35dvj4ewbzn2gyqnbgqb22np5zgp223vnbfhaod6sv4sq'},
                {k:'pownft' as NftType,l:'POWNFT\nON ETH',img:'https://gateway.lighthouse.storage/ipfs/bafkreick55xkc2ucnmk2wjbzl6a5chqkvmwjll4oqbqajfh5mapd3s7fku'},
                {k:'normie' as NftType,l:'NORMIES\nON ETH',img:'https://gateway.lighthouse.storage/ipfs/bafkreigdisoyfs75rneioevm5irn2k4prdddtuum5bpn27bykhjtdc4fii'},
                {k:'mooncat' as NftType,l:'MOONCATS\nON ETH',img:'/collection-icons/mooncat.png'},
                {k:'other' as NftType,l:'Other Verified ERC721',img:'https://gateway.lighthouse.storage/ipfs/bafkreid7jamriw5jneuarcq2q6lrbfsqe76eebv6r2rworrnhyj2rpsuem'},
              ]).map(opt => (
                <button key={opt.k} onClick={() => { selectNftType(opt.k); setTokenId(''); }}
                  className={`aspect-square rounded-lg border px-2 py-2 text-xs font-semibold transition text-center ${
                    nftType === opt.k ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300' : 'border-[rgba(176,128,92,0.2)] bg-black/20 text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <div className="flex justify-center"><img src={opt.img} alt={opt.l} className="h-24 w-24 rounded object-contain" /></div><div className="mt-0.5">{opt.l}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">{NFT_TYPE_META[nftType].nameLabel} (no underscore)</label>
              {nftType === 'ens' ? (
                <div className="flex gap-2">
                  <input className={`${ic} flex-1`} placeholder="e.g. vitalik" value={primaryName}
                    onChange={e => { setPrimaryName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); setTokenId(''); reset(); }} />
                  <button onClick={resolveEnsName} disabled={!primaryName || ensResolving}
                    className="shrink-0 rounded-lg bg-fuchsia-600/80 px-4 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-600 disabled:opacity-40">
                    {ensResolving ? 'Resolving…' : 'Resolve'}
                  </button>
                </div>
              ) : (
                <div className={`${ic} opacity-70 cursor-not-allowed`}>
                  {NFT_TYPE_META[nftType].prefill || 'N/A'}
                </div>
              )}
              <p className="mt-1 text-[10px] text-[var(--muted)]">BYO NFT mints to <span className="font-semibold text-fuchsia-300">agent.gno</span> (new body) or <span className="font-semibold text-fuchsia-300">molt.gno</span> (overlay). For openclaw.gno / vault.gno use the dashboard Molt action.</p>
            </div>
            {nftType === 'other' && (
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">NFT CONTRACT ADDRESS (Ethereum mainnet)</label>
                <input className={ic} placeholder="0x…" value={contractAddr}
                  onChange={e => { setContractAddr(e.target.value.trim()); reset(); }} />
              </div>
            )}
            {nftType === 'ens' ? (
              tokenId && (
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">RESOLVED TOKEN ID</label>
                  <div className={`${ic} truncate opacity-70 text-xs`}>{tokenId}</div>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Auto-resolved from <span className="font-mono text-fuchsia-300">{primaryName}.eth</span>. Verify on{' '}
                    <a href={`https://app.ens.domains/${primaryName}.eth`} target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">app.ens.domains</a>.
                  </p>
                </div>
              )
            ) : (
              <div>
                <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">
                  {nftType === 'chonk' ? 'CHONK TOKEN ID' : nftType === 'pownft' ? 'POWNFT TOKEN ID' : nftType === 'normie' ? 'NORMIE TOKEN ID' : nftType === 'mooncat' ? 'MOONCAT TOKEN ID' : 'TOKEN ID'}
                </label>
                <input className={ic} placeholder="e.g. 123" value={tokenId}
                  onChange={e => { setTokenId(e.target.value.replace(/[^0-9]/g,'')); reset(); }} />
                {nftType === 'chonk' && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Find your Chonk on{' '}
                    <a href="https://chonks.xyz" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">chonks.xyz</a>.
                  </p>
                )}
                {nftType === 'pownft' && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Find your ATOM on{' '}
                    <a href="https://pownft.com" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">pownft.com</a>.
                  </p>
                )}
                {nftType === 'normie' && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Find your Normie on{' '}
                    <a href="https://www.normies.art" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">normies.art</a>.
                  </p>
                )}
                {nftType === 'mooncat' && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">Find your MoonCat on{' '}
                    <a href="https://opensea.io/collection/acclimatedmooncats" target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">OpenSea</a>.
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">WALLET ADDRESS (must hold the NFT)</label>
              {connectedWallet ? (
                <div className={`${ic} flex items-center gap-2 opacity-70`}>
                  <span className="truncate">{ownerWallet}</span>
                  <span className="shrink-0 text-[9px] text-emerald-400">✓ connected</span>
                </div>
              ) : (
                <input className={ic} placeholder="0x… (connect wallet above to auto-fill)" value={ownerWallet}
                  onChange={e => { setOwnerWallet(e.target.value.trim()); reset(); }} />
              )}
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

          {/* Agent selection step */}
          {step === 'select-agent' && ownershipVerified && nftPreview && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-sm font-semibold text-[#f2eee4]">Choose target for this NFT</h3>
                <p className="text-xs text-[var(--muted)] mt-1">Create a new agent or overlay onto an existing one</p>
              </div>

              {/* Option 1: Create new agent */}
              <button
                onClick={() => { setMoltTarget('new-agent'); setStep('confirm'); }}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  moltTarget === 'new-agent'
                    ? 'border-fuchsia-500/50 bg-fuchsia-500/10'
                    : 'border-[var(--border)] bg-black/20 hover:border-fuchsia-500/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-fuchsia-500/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u"
                      alt="White Butterfly (Imago)"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-fuchsia-300">Create New Agent Body</div>
                    <div className="text-[10px] text-[var(--muted)]">Mint a fresh beacon NFT and start a new GhostAgent</div>
                  </div>
                </div>
              </button>

              {/* Option 2: Overlay onto existing agent */}
              {userAgents.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">Overlay onto Existing Agent</div>
                  {userAgents.map(agent => (
                    <button
                      key={agent.name}
                      onClick={() => { setMoltTarget('existing-agent'); setSelectedAgent(agent.name); setStep('confirm'); }}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        selectedAgent === agent.name && moltTarget === 'existing-agent'
                          ? 'border-amber-500/50 bg-amber-500/10'
                          : 'border-[var(--border)] bg-black/20 hover:border-amber-500/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-amber-500/30">
                          {(agent as any).imageUrl ? (
                            <Image 
                              src={(agent as any).imageUrl} 
                              alt={agent.name}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img 
                              src={
                                agent.tld === 'nftmail.gno' ? 'https://gateway.lighthouse.storage/ipfs/bafkreifv35abvqlhdtc4g2i4xelnmxnhaac7exyu6r24o3fbgthwcmupwy' :
                                agent.tld === 'molt.gno' ? 'https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u' :
                                agent.tld === 'openclaw.gno' ? 'https://gateway.lighthouse.storage/ipfs/bafkreiczeqhex35dvj4ewbzn2gyqnbgqb22np5zgp223vnbfhaod6sv4sq' :
                                agent.tld === 'vault.gno' ? 'https://gateway.lighthouse.storage/ipfs/bafkreick55xkc2ucnmk2wjbzl6a5chqkvmwjll4oqbqajfh5mapd3s7fku' :
                                agent.tld === 'agent.gno' ? 'https://gateway.lighthouse.storage/ipfs/bafkreigdisoyfs75rneioevm5irn2k4prdddtuum5bpn27bykhjtdc4fii' :
                                'https://gateway.lighthouse.storage/ipfs/bafkreid7jamriw5jneuarcq2q6lrbfsqe76eebv6r2rworrnhyj2rpsuem'
                              }
                              alt={agent.tld ?? 'agent'}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-amber-300">{agent.name}</div>
                          <div className="text-[9px] text-[var(--muted)]">tld: {agent.tld ?? 'none'}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {userAgents.length === 0 && (
                <div className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-center">
                  <p className="text-xs text-[var(--muted)]">No existing agents found. Create a new agent to get started.</p>
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && ownershipVerified && nftPreview && (
            <div className="space-y-4">
              {/* Target selection persistence */}
              <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">TARGET</span>
                    {moltTarget === 'new-agent' ? (
                      <div className="flex items-center gap-2">
                        <div className="relative h-6 w-6 overflow-hidden rounded-full border border-fuchsia-500/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img 
                            src="https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u" 
                            alt="White Butterfly" 
                            className="h-full w-full object-cover" 
                          />
                        </div>
                        <span className="text-xs font-semibold text-fuchsia-300">Create New Agent Body</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="relative h-6 w-6 overflow-hidden rounded-full border border-amber-500/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img 
                            src="https://gateway.lighthouse.storage/ipfs/bafkreifm4gtqaxgyb2quyykij4np5naoxzpf5w6za6maywemcvl7tltt7u" 
                            alt="Agent" 
                            className="h-full w-full object-cover" 
                          />
                        </div>
                        <span className="text-xs font-semibold text-amber-300">Overlay onto {selectedAgent}</span>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setStep('select-agent')}
                    className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)] transition hover:border-fuchsia-500/30 hover:bg-fuchsia-500/5 hover:text-fuchsia-300"
                  >
                    ← Back
                  </button>
                </div>
              </div>
              {/* NFT preview card with image */}
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
                {nftPreview.imageUrl ? (
                  <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-[rgba(176,128,92,0.3)]">
                    <Image src={nftPreview.imageUrl} alt={nftPreview.name} fill unoptimized className="object-cover" />
                  </div>
                ) : (
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/8 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={
                      nftPreview.type==='ens' ? 'https://gateway.lighthouse.storage/ipfs/bafkreifv35abvqlhdtc4g2i4xelnmxnhaac7exyu6r24o3fbgthwcmupwy' :
                      nftPreview.type==='chonk' ? 'https://gateway.lighthouse.storage/ipfs/bafkreiczeqhex35dvj4ewbzn2gyqnbgqb22np5zgp223vnbfhaod6sv4sq' :
                      nftPreview.type==='pownft' ? 'https://gateway.lighthouse.storage/ipfs/bafkreick55xkc2ucnmk2wjbzl6a5chqkvmwjll4oqbqajfh5mapd3s7fku' :
                      nftPreview.type==='normie' ? 'https://gateway.lighthouse.storage/ipfs/bafkreigdisoyfs75rneioevm5irn2k4prdddtuum5bpn27bykhjtdc4fii' :
                      'https://gateway.lighthouse.storage/ipfs/bafkreid7jamriw5jneuarcq2q6lrbfsqe76eebv6r2rworrnhyj2rpsuem'
                    } alt={nftPreview.type} className="h-20 w-20 rounded object-contain" />
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400">✓ Ownership confirmed</p>
                  <p className="text-sm font-bold text-[#f2eee4]">{nftPreview.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">{nftPreview.chain === 'base' ? 'Base' : 'Ethereum'} · token #{nftPreview.tokenId}</p>
                </div>
              </div>
              {/* Coupon OR payment */}
              <div className="rounded-xl border border-[rgba(176,128,92,0.15)] bg-black/20 p-3 space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">COUPON CODE (optional)</label>
                  <div className="flex gap-2">
                    <input className={`${ic} flex-1 uppercase`} placeholder="e.g. NFTFREE-XXXX" value={couponCode}
                      onChange={e => { setCouponCode(e.target.value.toUpperCase().trim()); setCouponValid(false); setCouponError(null); }}
                      disabled={couponValid} />
                    {couponValid ? (
                      <button onClick={() => { setCouponCode(''); setCouponValid(false); setCouponError(null); }}
                        className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-500/20">
                        Remove
                      </button>
                    ) : (
                      <button onClick={handleValidateCoupon} disabled={!couponCode.trim() || couponChecking}
                        className="shrink-0 rounded-lg bg-amber-500/80 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-500 disabled:opacity-40">
                        {couponChecking ? 'Checking…' : 'Apply'}
                      </button>
                    )}
                  </div>
                  {couponValid && <p className="mt-1 text-[10px] font-semibold text-emerald-400">✓ Coupon valid — fee waived</p>}
                  {couponError && <p className="mt-1 text-[10px] text-red-400">{couponError}</p>}
                </div>
                {!couponValid && (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">PAY {moltFee} xDAI ({currentTier.toUpperCase()} tier)</div>
                    <button onClick={handlePayWithWallet} disabled={paying}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
                      {paying ? (
                        <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Awaiting wallet…</>
                      ) : (
                        <>🦋 Pay {moltFee} xDAI &amp; Molt</>
                      )}
                    </button>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                      <span className="flex-1 border-t border-[rgba(176,128,92,0.15)]" />
                      <span>or pay with card</span>
                      <span className="flex-1 border-t border-[rgba(176,128,92,0.15)]" />
                    </div>
                    <MercuryoButton
                      walletAddress={GNOSIS_TREASURY}
                      defaultAmount={3}
                      label={`💳 Pay with Card (~$${moltFee} USD)`}
                    />
                    <p className="text-[9px] text-[var(--muted)] text-center">
                      Wallet payment sends {moltFee} xDAI on Gnosis to Treasury{' '}
                      <span className="font-mono text-amber-300/60">{GNOSIS_TREASURY.slice(0,10)}…</span>
                    </p>
                  </div>
                )}
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              {couponValid && (
                <button onClick={handleMolt}
                  className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-sm font-bold text-white transition hover:opacity-90 flex items-center justify-center gap-2">
                  <span className="text-base">🦋</span>
                  Execute BYO NFT Molt (free)
                </button>
              )}
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
                <p className="text-xs text-[var(--muted)]">BYO NFT identity overlay active</p>
              </div>
            </div>
            <div className="grid gap-2">
              {[
                { label: 'PRIMARY (human inbox)', value: result.primaryEmail, color: 'text-[#f2eee4]' },
                { label: 'AGENT (A2A email)',      value: result.agentEmail ?? result.aliasEmail, color: 'text-fuchsia-300' },
                { label: 'BEACON NFT',             value: result.beaconNft,   color: 'text-cyan-300' },
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
