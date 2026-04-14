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

// Resolve subname label from SubnameMinted event transaction calldata
async function resolveLabelFromEvent(contract: string, tokenId: number): Promise<string | null> {
  try {
    // Get SubnameMinted events for this tokenId
    const logsRes = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{
          address: contract,
          topics: [
            '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', // SubnameMinted signature
            null,
            null,
            null
          ],
          fromBlock: 'earliest',
          toBlock: 'latest'
        }],
      }),
    });
    const logsData = await logsRes.json() as { result?: any[] };
    if (!logsData.result) return null;

    // Find the event with matching tokenId
    for (const log of logsData.result) {
      const data = log.data;
      if (!data || data.length < 130) continue; // Minimum length for tokenId (32 bytes) + other fields
      
      // tokenId is the third 32-byte chunk (offset 64)
      const eventTokenId = BigInt('0x' + data.slice(128, 128 + 64));
      if (eventTokenId === BigInt(tokenId)) {
        const txHash = log.transactionHash;
        if (!txHash) continue;

        // Get transaction to extract label from calldata
        const txRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionByHash',
            params: [txHash],
          }),
        });
        const txData = await txRes.json() as { result?: { input: string } };
        if (!txData.result?.input || txData.result.input.length < 10) continue;

        // Decode mintSubname(string label, address owner, bytes storyData, bytes32 tbaSalt)
        const input = txData.result.input;
        if (input.slice(0, 10) !== '0x8a5f6a4e') continue; // mintSubname selector

        // Extract string label (dynamic type, first 32 bytes = offset, then length, then data)
        const paramsOffset = parseInt(input.slice(10, 74), 16);
        const labelOffset = parseInt(input.slice(10 + paramsOffset * 2, 10 + paramsOffset * 2 + 64), 16);
        const labelLength = parseInt(input.slice(10 + paramsOffset * 2 + 64, 10 + paramsOffset * 2 + 128), 16);
        const labelData = input.slice(10 + paramsOffset * 2 + 128 + labelOffset * 2, 10 + paramsOffset * 2 + 128 + labelOffset * 2 + labelLength * 2);
        
        // Convert hex to string
        let label = '';
        for (let i = 0; i < labelLength * 2; i += 2) {
          label += String.fromCharCode(parseInt(labelData.slice(i, i + 2), 16));
        }
        
        return label || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchTokenMetadata(contract: string, namespace: string, tokenId: number, wallet: string): Promise<NftBody | null> {
  try {
    // Try to resolve subname from events first
    const subname = await resolveLabelFromEvent(contract, tokenId);
    
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
    
    let name = subname || `Token #${tokenId}`;
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

// Check worker KV to see if a body has evolved to PUPA (agent with brain)
async function isAgentRegistered(name: string): Promise<boolean> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAcctTier', localPart: name, tld: '' }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { tier?: string; error?: string };
    // Agent = PUPA (lite) tier or above; basic = larva (body only)
    return !!(data.tier && data.tier !== 'basic' && !data.error);
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
