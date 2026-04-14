/// API Route: Get user's NFT bodies (beacon NFTs)
/// GET /api/my-nfts
///
/// Returns all NFTs owned by the connected wallet that represent agent bodies.
/// These are the beacon NFTs minted during agent creation.

import { NextRequest, NextResponse } from 'next/server';

const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// For ERC-6551 TBAs: call owner() to find the controlling EOA
async function tbaOwner(address: string): Promise<string | null> {
  try {
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: address, data: '0x8da5cb5b' }, 'latest'], // owner()
      }),
    });
    const data = await res.json() as { result?: string };
    if (!data.result || data.result.length < 66) return null;
    return ('0x' + data.result.slice(26)).toLowerCase();
  } catch {
    return null;
  }
}

// Known beacon NFT contracts (agent body NFTs)
const BEACON_CONTRACTS: Record<string, string> = {
  'nftmail.gno':  '0x46c37365572C9994812AAA41fD04eB56D05469D0', // NFTMail registrar
  'molt.gno':     '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50', // Molt registrar
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe', // OpenClaw registrar
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5', // PicoClaw registrar
  'vault.gno':    '0xc6b184a38da64d1d535674dafb9ce2440058ec4e', // Vault registrar
  'agent.gno':    '0x608071875bcc0ef0b934f8a2367672d8c472cacf', // Agent registrar
};

async function fetchTokenMetadata(contract: string, namespace: string, tokenId: number, wallet: string): Promise<NftBody | null> {
  try {
    const tokenUriRes = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: contract, data: '0xc87b56dd' + BigInt(tokenId).toString(16).padStart(64, '0') }, 'latest'], // tokenURI
      }),
    });
    const uriData = await tokenUriRes.json() as { result?: string };
    
    let name = `Token #${tokenId}`;
    let minted = new Date().toLocaleDateString('en-GB');
    
    if (uriData.result && uriData.result !== '0x') {
      try {
        const uri = uriData.result.startsWith('0x') 
          ? Buffer.from(uriData.result.slice(2), 'hex').toString()
          : uriData.result;
        
        if (uri.startsWith('http')) {
          const metaRes = await fetch(uri);
          if (metaRes.ok) {
            const metadata = await metaRes.json() as any;
            name = metadata.name || name;
            if (metadata.created_at) {
              minted = new Date(metadata.created_at).toLocaleDateString('en-GB');
            }
          }
        }
      } catch {
        // Metadata fetch failed, use defaults
      }
    }

    return {
      name: name.replace(/\.nftmail\.gno$/, '').replace(/\.gno$/, '').replace(/\s+/g, '-').toLowerCase(),
      namespace,
      tokenId,
      tba: wallet.slice(0, 8) + '...' + wallet.slice(-4),
      minted,
    };
  } catch {
    return null;
  }
}

interface NftBody {
  name: string;
  namespace: string;
  tokenId: number;
  tba: string;
  minted: string;
  isAgent?: boolean;  // true if ERC-8004 registered (has brain)
}

// Get total supply of an ERC721 contract (totalSupply selector 0x18160ddd)
async function getTotalSupply(contract: string): Promise<number> {
  try {
    const res = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: contract, data: '0x18160ddd' }, 'latest'],
      }),
    });
    const data = await res.json() as { result?: string };
    if (!data.result || data.result === '0x') return 0;
    return parseInt(data.result, 16);
  } catch {
    return 0;
  }
}

// Check worker KV to see if an agent name has ERC-8004 registration (= has brain)
async function isAgentRegistered(name: string): Promise<boolean> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { erc8004?: Record<string, any>; error?: string };
    // Only true if ERC-8004 registration exists (has brain)
    return !!(data.erc8004 && Object.keys(data.erc8004).length > 0 && !data.error);
  } catch {
    return false;
  }
}

async function fetchNftsForContract(wallet: string, contract: string, namespace: string): Promise<NftBody[]> {
  try {
    // ── Step 1: how many tokens have been minted? ─────────────────────────────
    // Registrars may not implement ERC721Enumerable (tokenOfOwnerByIndex),
    // so we scan 1..totalSupply via ownerOf instead.
    const totalSupply = await getTotalSupply(contract);
    // Always scan at least 1-20 as a safety net even if totalSupply is 0
    const upperBound = Math.min(Math.max(totalSupply, 20), 200);

    const walletLower = wallet.toLowerCase();
    const ZERO = '0x0000000000000000000000000000000000000000';
    const nfts: NftBody[] = [];

    // ── Step 2: ownerOf scan ──────────────────────────────────────────────────
    for (let tokenId = 1; tokenId <= upperBound; tokenId++) {
      try {
        const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
        const ownerRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'], // ownerOf
          }),
        });
        const ownerData = await ownerRes.json() as { result?: string };
        if (!ownerData.result || ownerData.result.length < 66) continue;

        const ownerAddr = ('0x' + ownerData.result.slice(26)).toLowerCase();
        if (ownerAddr === ZERO.toLowerCase()) continue;

        const directMatch = ownerAddr === walletLower;
        // ERC-6551 TBA: if owner is a contract, check if wallet controls it
        const tbaMatch = !directMatch
          ? (await tbaOwner(ownerAddr)) === walletLower
          : false;

        if (directMatch || tbaMatch) {
          const nft = await fetchTokenMetadata(contract, namespace, tokenId, wallet);
          if (nft) nfts.push(nft);
        }
      } catch {
        // ownerOf reverted (token doesn't exist) — stop scanning
        if (tokenId > totalSupply) break;
      }
    }

    // ── Step 3: flag agents (ERC-8004 registered = has brain) ────────────────
    await Promise.all(nfts.map(async (nft) => {
      nft.isAgent = await isAgentRegistered(nft.name);
    }));

    console.log(`[my-nfts] ${namespace}: found ${nfts.length} NFTs (supply=${totalSupply})`);
    return nfts;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Valid wallet address required' }, { status: 400 });
  }

  try {
    // Fetch on-chain beacon NFTs owned by the wallet
    const onChainNfts: NftBody[] = [];
    for (const [namespace, contract] of Object.entries(BEACON_CONTRACTS)) {
      const nfts = await fetchNftsForContract(wallet, contract, namespace);
      onChainNfts.push(...nfts);
    }

    // Partition: agents (ERC-8004 registered) vs bodies (NFTs without brain)
    const agents = onChainNfts.filter(n => n.isAgent);
    const bodies = onChainNfts.filter(n => !n.isAgent);

    return NextResponse.json({ nfts: onChainNfts, agents, bodies });
  } catch (err: any) {
    console.error('[my-nfts]', err);
    return NextResponse.json(
      { error: err?.message ?? 'Failed to fetch NFTs' },
      { status: 500 }
    );
  }
}
