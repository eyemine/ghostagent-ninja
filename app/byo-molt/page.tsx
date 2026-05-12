'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { keccak256, toHex, createWalletClient, custom, parseUnits } from 'viem';
import { base, mainnet } from 'viem/chains';
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
const NORMIE_BASE_CONTRACT = '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB';
const MOONCAT_CONTRACT = '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69';
const TREASURY = '0xeD0B0694953158dd54D0c36D320b391f44cd67f3';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ETH  = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BYO_FEE_USDC = 10; // $10 USDC flat

const CI = '/collection-icons';

// All icons are static files in public/collection-icons/ — served by Netlify CDN
const ICONS = {
  basic:   `${CI}/basic.png`,
  lite:    `${CI}/lite.png`,
  premium:   `${CI}/premium.png`,
  ghost:   `${CI}/ghost.png`,
  byo:     `${CI}/byo.png`,
  ens:     `${CI}/ens.svg`,
  chonk:   `${CI}/chonk.svg`,
  pownft:  `${CI}/pownft.png`,
  normie:  `${CI}/normie.png`,
  other:   `${CI}/other.png`,
  mooncat: `${CI}/mooncat.png`,
  nftmail: `${CI}/nftmail.png`,
  molt:    `${CI}/molt.png`,
  openclaw:`${CI}/openclaw.png`,
  picoclaw:`${CI}/picoclaw.png`,
  vault:   `${CI}/vault.png`,
  agent:   `${CI}/agent.png`,
};

// Verified ERC-721 collections — whitelisted, check-only (not yet activated for minting)
const VERIFIED_COLLECTIONS = [
  { slug: 'deadfellaz',       name: 'Dead Fellaz',        field1: 'DFZ',        contract: '0x2acab3dea77832c09420663b0e1cb386031ba17b', chain: 'eth', rpc: 'https://cloudflare-eth.com', opensea: 'https://opensea.io/collection/dead-fellaz' },
  { slug: 'cryptoadz',       name: 'CrypToadz',          field1: 'Toad',       contract: '0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6', chain: 'eth', rpc: 'https://cloudflare-eth.com', opensea: 'https://opensea.io/collection/cryptoadz-by-gremplin' },
  { slug: 'cryptopunks',     name: 'CryptoPunks',        field1: 'Punk',       contract: '0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB', chain: 'eth', rpc: 'https://cloudflare-eth.com', opensea: 'https://opensea.io/collection/cryptopunks' },
  { slug: 'cryptopunksv1',   name: 'CryptoPunks V1',     field1: 'CryptoPunk', contract: '0x6ba6f2207e343923ba692e5cae646fb0f566db8d', chain: 'eth', rpc: 'https://cloudflare-eth.com', opensea: 'https://opensea.io/collection/cryptopunks-v1' },
  { slug: 'flawlessrenegades', name: 'Flawless Renegades', field1: 'Flawless', contract: '0x4f636ab8672cdeb2fdf681598fc5fa3efe2e0078', chain: 'eth', rpc: 'https://cloudflare-eth.com', opensea: 'https://opensea.io/collection/flawless-renegades' },
] as const;

type VerifiedCollectionSlug = typeof VERIFIED_COLLECTIONS[number]['slug'];
const VERIFIED_COLLECTION_SLUGS = new Set<string>(VERIFIED_COLLECTIONS.map(c => c.slug));
function isVerifiedCollectionSlug(slug: string): slug is VerifiedCollectionSlug { return VERIFIED_COLLECTION_SLUGS.has(slug); }

// Fee tiers (kept for tier-aware overlay molts via getAgentTier)
const TIER_FEES = { basic: 10, lite: 14, premium: 2 } as const;

// Payment chain per NFT type
function paymentChainForNftType(type: NftType): 'base' | 'mainnet' {
  return (type === 'chonk' || type === 'normie') ? 'base' : 'mainnet';
}

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
    // Proxy through Next.js API route to avoid CORS on pownftmetadata.com
    const metaRes = await fetch(`/api/nft-preview?type=pownft&tokenId=${tokenId}`, { signal: AbortSignal.timeout(8000) });
    if (!metaRes.ok) return { name: `ATOM #${tokenId}`, imageUrl: null };
    const data = await metaRes.json() as { name?: string; imageUrl?: string | null };
    return { name: data.name || `ATOM #${tokenId}`, imageUrl: data.imageUrl ?? null };
  } catch {
    return { name: `ATOM #${tokenId}`, imageUrl: null };
  }
}

async function fetchNormieImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    // Normies are on Base
    const normieContract = '0x7Bc1C072742D8391817EB4Eb2317F98dc72C61dB';
    if (alchemyKey) {
      const res = await fetch(`https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTMetadata?contractAddress=${normieContract}&tokenId=${tokenId}&refreshCache=false`);
      if (res.ok) {
        const data = await res.json() as any;
        const isVideo = data?.image?.contentType?.startsWith('video/');
        const imageUrl = isVideo
          ? (data?.image?.pngUrl || data?.image?.thumbnailUrl || null)
          : (data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null);
        return { name: data?.name || `Normie #${tokenId}`, imageUrl };
      }
    }
    // Fallback: tokenURI on Base
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const rpcRes = await fetch('https://mainnet.base.org', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: normieContract, data: '0xc87b56dd' + tokenIdHex }, 'latest'] }),
    });
    const rpcData = await rpcRes.json() as { result?: string };
    if (rpcData.result && rpcData.result !== '0x') {
      const raw = Buffer.from(rpcData.result.slice(130), 'hex').toString().replace(/\0.*$/, '');
      if (raw.startsWith('http') || raw.startsWith('ipfs://') || raw.startsWith('data:')) {
        const uri = raw.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${raw.slice(7)}` : raw;
        if (!raw.startsWith('data:')) {
          const meta = await (await fetch(uri, { signal: AbortSignal.timeout(5000) })).json() as any;
          return { name: meta?.name || `Normie #${tokenId}`, imageUrl: meta?.image || null };
        }
      }
    }
    return { name: `Normie #${tokenId}`, imageUrl: null };
  } catch {
    return { name: `Normie #${tokenId}`, imageUrl: null };
  }
}

async function fetchMooncatImage(tokenId: string): Promise<{ name: string; imageUrl: string | null }> {
  try {
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (alchemyKey) {
      const res = await fetch(`https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTMetadata?contractAddress=${MOONCAT_CONTRACT}&tokenId=${tokenId}&refreshCache=false`);
      if (res.ok) {
        const data = await res.json() as any;
        const imageUrl = data?.image?.cachedUrl || data?.image?.originalUrl || data?.image?.pngUrl || null;
        return { name: data?.name || `MoonCat #${tokenId}`, imageUrl };
      }
    }
    // Fallback: tokenURI via cloudflare-eth
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const rpcRes = await fetch('https://cloudflare-eth.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MOONCAT_CONTRACT, data: '0xc87b56dd' + tokenIdHex }, 'latest'] }),
    });
    const rpcData = await rpcRes.json() as { result?: string };
    if (rpcData.result && rpcData.result !== '0x') {
      const raw = Buffer.from(rpcData.result.slice(130), 'hex').toString().replace(/\0.*$/, '');
      if (raw.startsWith('http')) {
        const meta = await (await fetch(raw, { signal: AbortSignal.timeout(5000) })).json() as any;
        return { name: meta?.name || `MoonCat #${tokenId}`, imageUrl: meta?.image || null };
      }
    }
    return { name: `MoonCat #${tokenId}`, imageUrl: null };
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
  const [collectionName, setCollectionName] = useState('');
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

  // For 'other' type: primaryName = collectionname.tokenid
  useEffect(() => {
    if (nftType === 'other' && collectionName && tokenId) {
      setPrimaryName(`${collectionName}.${tokenId}`);
    }
  }, [nftType, collectionName, tokenId]);

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
    if (nftType === 'normie') return NORMIE_BASE_CONTRACT;
    if (nftType === 'mooncat') return MOONCAT_CONTRACT;
    return contractAddr;
  };
  const resolvedRpc = () => {
    const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
    if (nftType === 'other') {
      const col = VERIFIED_COLLECTIONS.find(c => c.slug === collectionName);
      return col?.rpc ?? 'https://cloudflare-eth.com';
    }
    if (nftType === 'chonk' || nftType === 'normie') {
      return alchemyKey
        ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : 'https://mainnet.base.org';
    }
    return alchemyKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://cloudflare-eth.com';
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
    other:   { nameLabel: 'VERIFIED COLLECTION', prefill: '' },
  };

  function selectNftType(t: NftType) {
    setNftType(t);
    const meta = NFT_TYPE_META[t];
    if (meta.prefill) setPrimaryName(meta.prefill);
    else setPrimaryName('');
    if (t !== 'other') setCollectionName('');
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
      const chain = paymentChainForNftType(nftType) === 'base' ? base : mainnet;
      const usdcAddress = paymentChainForNftType(nftType) === 'base' ? USDC_BASE : USDC_ETH;
      const walletClient = createWalletClient({ chain, transport: custom(provider as Parameters<typeof custom>[0]) });
      const [account] = await walletClient.requestAddresses();

      // Ensure wallet is on the correct chain before sending
      try {
        await walletClient.switchChain({ id: chain.id });
        // Wait for chain switch to propagate
        await new Promise(r => setTimeout(r, 800));
      } catch (switchErr: any) {
        // If switch fails, user may already be on correct chain or wallet doesn't support programmatic switching
        console.log('Chain switch result:', switchErr?.message || 'proceeded');
      }

      // Verify chain before proceeding
      const chainId = await walletClient.getChainId();
      if (chainId !== chain.id) {
        throw new Error(`Please switch your wallet to ${chain.name} (Chain ID: ${chain.id}) before proceeding`);
      }

      // ERC-20 transfer using viem's writeContract with proper configuration
      const amount = parseUnits(String(BYO_FEE_USDC), 6);
      const txHash = await walletClient.writeContract({
        account,
        address: usdcAddress as `0x${string}`,
        abi: [{
          name: 'transfer',
          type: 'function',
          inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
        }],
        functionName: 'transfer',
        args: [TREASURY as `0x${string}`, amount],
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
    addLog(txHash ? `Verifying ${BYO_FEE_USDC} USDC payment on ${paymentChainForNftType(nftType) === 'base' ? 'Base' : 'Ethereum'}…` : 'Coupon applied — fee waived');
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
        <img src={ICONS.byo} alt="BYO NFT Molt" className="h-28 w-28 shrink-0 rounded-xl border border-fuchsia-500/40 object-contain" />
        <div>
          <h1 className="pl-1 text-2xl font-bold text-[#f2eee4]">BYO NFT Molt</h1>
          <p className="mt-1 pl-1 text-sm text-[var(--muted)]">Use an NFT you already own — ENS, Chonk, or Verified Collection — as the governing key to your GhostAgent Safe</p>
        </div>
      </div>

      <div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold mb-1">Your NFT is the key</p>
          <p>Your existing NFT becomes the <span className="text-violet-300 font-semibold">keystone</span> — it governs the agent&apos;s Safe via its Token-Bound Account (TBA). Transfer the NFT and the agent transfers with it. No migration, no re-provisioning. The Safe holds feature beacons; your NFT holds the power.</p>
        </div>
        <div className="mt-3 rounded-xl border border-[rgba(176,128,92,0.2)] bg-black/20 px-4 py-3 space-y-1 text-xs text-[var(--muted)]">
          <p className="text-[#f2eee4] font-semibold">What happens</p>
          {(() => {
            const tid = tokenId || '[TokenID]';
            const prefix = nftType === 'pownft' ? 'atom' : nftType === 'normie' ? 'normie' : nftType === 'chonk' ? 'chonk' : nftType === 'mooncat' ? 'mooncat' : null;
            const primary = prefix ? `${prefix}.${tid}@nftmail.box` : primaryName ? `${primaryName}@nftmail.box` : '[ENSname]@nftmail.box';
            const agent   = prefix ? `${prefix}.${tid}_@nftmail.box` : primaryName ? `${primaryName}_@nftmail.box` : '[ENSname]_@nftmail.box';
            const beacon  = prefix ? `${prefix}-${tid}.nftmail.gno` : primaryName ? `${primaryName}.nftmail.gno` : '[ENSname].nftmail.gno';
            return (
              <>
                <p>✓ Gnosis mirror TBA deployed — your NFT&apos;s TBA becomes the Safe&apos;s sole key</p>
                <p>✓ Gnosis Safe created — controlled exclusively by your NFT via its TBA</p>
                <p>✓ Beacon NFT <span className="font-mono text-[#f2eee4]">{beacon}</span> minted <span className="text-violet-300">to the Safe</span> (not your wallet)</p>
                <p>✓ Human inbox <span className="font-mono text-[#f2eee4]">{primary}</span></p>
                <p className="ml-3">+ Agent inbox <span className="font-mono text-[#f2eee4]">{agent}</span></p>
                <p className="text-amber-300/80">Your NFT stays in your wallet — it is the key, not the asset held</p>
              </>
            );
          })()}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <svg className="h-3.5 w-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-[10px] text-amber-300">Fee: <strong>{BYO_FEE_USDC} USDC</strong> on {paymentChainForNftType(nftType) === 'base' ? 'Base' : 'Ethereum'} · send to <span className="font-mono">{TREASURY.slice(0,10)}…</span></p>
        </div>
      </div>

      {/* Check + Select Agent + Confirm */}
      {(step === 'check' || step === 'select-agent' || step === 'confirm') && (
        <div className="max-w-3xl mx-auto rounded-2xl border border-[rgba(176,128,92,0.35)] bg-[var(--card)] p-5 space-y-4">
          <p className="text-sm font-semibold text-[#f2eee4]">OG NFTs</p>

          {/* NFT type picker */}
          <div>
            <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-2">NFT COLLECTION</label>
            <div className="grid grid-cols-6 gap-2">
              {([
                {k:'ens'     as NftType, l:'ENS\nName',       img:ICONS.ens},
                {k:'chonk'   as NftType, l:'CHONKS\nON BASE', img:ICONS.chonk},
                {k:'pownft'  as NftType, l:'POWNFT\nON ETH',  img:ICONS.pownft},
                {k:'normie'  as NftType, l:'NORMIES\nON BASE', img:ICONS.normie},
                {k:'mooncat' as NftType, l:'MOONCATS\nON ETH', img:ICONS.mooncat},
                {k:'other'   as NftType, l:'OTHER\nERC-721',  img:ICONS.other},
              ]).map(opt => (
                <button key={opt.k} onClick={() => { selectNftType(opt.k); setTokenId(''); }}
                  className={`rounded-lg border p-2 font-semibold transition flex flex-col items-center justify-center gap-1.5 ${
                    nftType === opt.k ? 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-300' : 'border-[rgba(176,128,92,0.2)] bg-black/20 text-[var(--muted)] hover:text-[#f2eee4]'
                  }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={opt.img} alt={opt.l} className="w-16 h-16 rounded object-contain flex-shrink-0" />
                  <span className="whitespace-pre-line leading-tight text-[9px] text-center">{opt.l}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">{NFT_TYPE_META[nftType].nameLabel}</label>
              {nftType === 'ens' ? (
                <div className="flex gap-2">
                  <input className={`${ic} flex-1`} placeholder="e.g. vitalik" value={primaryName}
                    onChange={e => { setPrimaryName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); setTokenId(''); reset(); }} />
                  <button onClick={resolveEnsName} disabled={!primaryName || ensResolving}
                    className="shrink-0 rounded-lg bg-fuchsia-600/80 px-4 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-600 disabled:opacity-40">
                    {ensResolving ? 'Resolving…' : 'Resolve'}
                  </button>
                </div>
              ) : nftType === 'other' ? (
                <>
                  <div className="flex gap-2">
                    <select className={`${ic} flex-1`} value={collectionName}
                      onChange={e => {
                        const col = VERIFIED_COLLECTIONS.find(c => c.slug === e.target.value);
                        setCollectionName(e.target.value);
                        setContractAddr(col?.contract ?? '');
                        setPrimaryName(col?.field1 ?? '');
                        reset();
                      }}>
                      <option value="">— select a verified collection —</option>
                      {VERIFIED_COLLECTIONS.map(c => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={handleVerifyOwnership}
                      disabled={!collectionName || !tokenId || !ownerWallet || !contractAddr || checking}
                      className="shrink-0 rounded-lg bg-fuchsia-600/80 px-4 py-2 text-xs font-bold text-white transition hover:bg-fuchsia-600 disabled:opacity-40">
                      {checking ? 'Checking…' : 'Check'}
                    </button>
                  </div>
                  {collectionName && (() => { const col = VERIFIED_COLLECTIONS.find(c => c.slug === collectionName); return col ? (
                    <div className="mt-2">
                      <label className="block text-[10px] font-semibold tracking-wider text-[var(--muted)] mb-1">COLLECTION NAME (prefilled)</label>
                      <div className={`${ic} opacity-70 cursor-not-allowed font-mono`}>{col.field1}</div>
                    </div>
                  ) : null; })()}
                  {collectionName && tokenId && (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">Agent name: <span className="font-mono text-fuchsia-300">{VERIFIED_COLLECTIONS.find(c=>c.slug===collectionName)?.field1 ?? collectionName}.{tokenId}</span></p>
                  )}
                </>
              ) : (
                <div className={`${ic} opacity-70 cursor-not-allowed`}>
                  {NFT_TYPE_META[nftType].prefill || 'N/A'}
                </div>
              )}
              <p className="mt-1 text-[10px] text-[var(--muted)]">BYO NFT mints to <span className="font-semibold text-fuchsia-300">agent.gno</span> (new body) or <span className="font-semibold text-fuchsia-300">molt.gno</span> (overlay). For openclaw.gno / vault.gno use the dashboard Molt action.</p>
            </div>
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
                  {nftType === 'chonk' ? 'CHONK TOKEN ID' : nftType === 'pownft' ? 'POWNFT TOKEN ID' : nftType === 'normie' ? 'NORMIE TOKEN ID' : nftType === 'mooncat' ? 'MOONCAT TOKEN ID' : nftType === 'other' ? 'TOKEN ID' : 'TOKEN ID'}
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
            {nftType === 'other' && collectionName && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] text-[var(--muted)]">
                <span className="text-emerald-400 font-semibold">✓ Verified collection</span>{' · '}
                <span className="font-mono">{contractAddr.slice(0,10)}…</span>{' · '}
                {(() => { const col = VERIFIED_COLLECTIONS.find(c => c.slug === collectionName); return col ? <a href={col.opensea} target="_blank" rel="noopener noreferrer" className="underline text-fuchsia-400">OpenSea ↗</a> : null; })()}
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

          {step === 'check' && nftType !== 'other' && (
            <button onClick={handleVerifyOwnership}
              disabled={!primaryName || !tokenId || !ownerWallet || checking}
              className="w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
              {checking ? 'Checking ownership…' : 'Verify NFT Ownership →'}
            </button>
          )}

          {/* Agent selection step */}
          {step === 'select-agent' && ownershipVerified && nftPreview && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-sm font-semibold text-[#f2eee4]">Choose target for this NFT</h3>
                <p className="text-xs text-[var(--muted)] mt-1">Create a new agent</p>
              </div>

              {/* Option 1: Molt a new agent body */}
              <button
                onClick={() => setMoltTarget('new-agent')}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  moltTarget === 'new-agent'
                    ? 'border-fuchsia-500/50 bg-fuchsia-500/10'
                    : 'border-[var(--border)] bg-black/20 hover:bg-black/30'
                }`}
              >
                <div className="shrink-0">
                  <input
                    type="radio"
                    checked={moltTarget === 'new-agent'}
                    onChange={() => setMoltTarget('new-agent')}
                    className="h-4 w-4 accent-fuchsia-500"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-fuchsia-300">Molt a New Agent Body</div>
                  <div className="text-[10px] text-[var(--muted)]">Mint a paired beacon NFT and build a new GhostAgent</div>
                </div>
              </button>
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
                            src={ICONS.premium} 
                            alt="White Butterfly" 
                            className="h-full w-full object-cover" 
                          />
                        </div>
                        <span className="text-xs font-semibold text-fuchsia-300">Molt a New Agent Body</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="relative h-6 w-6 overflow-hidden rounded-full border border-amber-500/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img 
                            src={ICONS.premium} 
                            alt="Agent" 
                            className="h-full w-full object-cover" 
                          />
                        </div>
                        <span className="text-xs font-semibold text-amber-300">Pair onto {selectedAgent}</span>
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
                <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-[rgba(176,128,92,0.3)] bg-black/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={nftPreview.imageUrl ?? (ICONS[nftPreview.type] ?? ICONS.other)}
                    alt={nftPreview.name}
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = ICONS[nftPreview.type] ?? ICONS.other; }}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400">✓ Ownership confirmed</p>
                  <p className="text-sm font-bold text-[#f2eee4]">{nftPreview.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">{nftPreview.chain === 'base' ? 'Base' : 'Ethereum'} · token #{nftPreview.tokenId}</p>
                </div>
              </div>
              {/* Coupon OR payment — blocked for verified collections (not yet activated) */}
              {nftType === 'other' && isVerifiedCollectionSlug(collectionName) ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-center space-y-2">
                  <p className="text-sm font-bold text-amber-400">⏳ Not Activated</p>
                  <p className="text-[10px] text-[var(--muted)] leading-relaxed">
                    Minting for <span className="font-semibold text-[#f2eee4]">{VERIFIED_COLLECTIONS.find(c => c.slug === collectionName)?.name}</span> is whitelisted but not yet activated.
                    Ownership verified — your spot is reserved.
                  </p>
                  <p className="text-[10px] text-amber-400/70">Check back soon for launch.</p>
                </div>
              ) : (
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
                      <div className="text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                        PAY {BYO_FEE_USDC} USDC · {paymentChainForNftType(nftType) === 'base' ? 'Base' : 'Ethereum'}
                      </div>
                      <button onClick={handlePayWithWallet} disabled={paying}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40">
                        {paying ? (
                          <><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Awaiting wallet…</>
                        ) : (
                          <>Pay $USDC {BYO_FEE_USDC} to Pair</>
                        )}
                      </button>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                        <span className="flex-1 border-t border-[rgba(176,128,92,0.15)]" />
                        <span>or pay with card</span>
                        <span className="flex-1 border-t border-[rgba(176,128,92,0.15)]" />
                      </div>
                      <MercuryoButton
                        walletAddress={ownerWallet || TREASURY}
                        defaultAmount={BYO_FEE_USDC + 2}
                        currency="USDC"
                        network={paymentChainForNftType(nftType) === 'base' ? 'BASE' : 'ETHEREUM'}
                        label={`💳 Buy USDC with Card (~$${BYO_FEE_USDC + 2} USD)`}
                      />
                      <p className="text-[9px] text-[var(--muted)] text-center">
                        Wallet payment sends {BYO_FEE_USDC} USDC on {paymentChainForNftType(nftType) === 'base' ? 'Base' : 'Ethereum'} to{' '}
                        <span className="font-mono text-amber-300/60">{TREASURY.slice(0,10)}…</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
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
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-emerald-500/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={nftPreview.imageUrl} alt={nftPreview.name} className="h-full w-full object-cover" />
                </div>
              ) : <span className="text-2xl">🪲</span>}
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
