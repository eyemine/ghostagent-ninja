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
}

async function fetchNftsForContract(wallet: string, contract: string, namespace: string): Promise<NftBody[]> {
  try {
    // Get token balance (number of NFTs owned)
    const balanceRes = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: contract, data: '0x70a08231' + wallet.slice(2).padStart(64, '0') }, 'latest'], // balanceOf(address) ERC721
      }),
    });
    const balanceData = await balanceRes.json() as { result?: string };
    if (!balanceData.result) return [];

    const balance = parseInt(balanceData.result, 16);
    
    // If balance is 0, still check specific token IDs since some contracts
    // don't properly track balanceOf but do track ownerOf
    const nfts: NftBody[] = [];
    
    if (balance === 0) {
      // Specific check for rgbanksy token #6 on nftmail.gno
      console.log(`[my-nfts] Checking ${namespace} for wallet ${wallet}`);
      
      // Check token #6 specifically first
      try {
        const tokenIdHex = BigInt(6).toString(16).padStart(64, '0');
        console.log(`[my-nfts] Checking token 6 with hex: ${tokenIdHex}`);
        
        const ownerRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'],
          }),
        });
        const ownerData = await ownerRes.json() as { result?: string; error?: any };
        console.log(`[my-nfts] Token 6 owner response:`, JSON.stringify(ownerData));
        
        if (ownerData.result) {
          const owner = '0x' + ownerData.result.slice(26);
          console.log(`[my-nfts] Token 6 owner: ${owner}, wallet: ${wallet}`);
          console.log(`[my-nfts] Match: ${owner.toLowerCase() === wallet.toLowerCase()}`);
          
          const ownerLower = owner.toLowerCase();
          const walletLower = wallet.toLowerCase();
          const directMatch = ownerLower === walletLower;
          // ERC-6551 TBA: owner of the TBA contract may be the wallet
          const tbaMatch = !directMatch && ownerLower !== '0x0000000000000000000000000000000000000000'
            ? (await tbaOwner(owner)) === walletLower
            : false;
          if (directMatch || tbaMatch) {
            const nft = await fetchTokenMetadata(contract, namespace, 6, wallet);
            console.log(`[my-nfts] Found token 6 metadata:`, nft);
            if (nft) return [nft];
          }
        }
      } catch (err) {
        console.log(`[my-nfts] Error checking token 6:`, err);
      }
      
      // Check tokens 1-10 if #6 wasn't found
      for (let tokenId = 1; tokenId <= 10; tokenId++) {
        if (tokenId === 6) continue; // Skip 6 since we checked it
        try {
          const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
          const ownerRes = await fetch(GNOSIS_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'eth_call',
              params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'],
            }),
          });
          const ownerData = await ownerRes.json() as { result?: string };
          if (ownerData.result && ownerData.result !== '0x') {
            const ownerAddr = ('0x' + ownerData.result.slice(26)).toLowerCase();
            const walletLower = wallet.toLowerCase();
            const directMatch = ownerAddr === walletLower;
            const tbaMatch = !directMatch && ownerAddr !== '0x0000000000000000000000000000000000000000'
              ? (await tbaOwner(ownerAddr)) === walletLower
              : false;
            if (directMatch || tbaMatch) {
              const nft = await fetchTokenMetadata(contract, namespace, tokenId, wallet);
              if (nft) nfts.push(nft);
            }
          }
        } catch {
          // Continue to next token
        }
      }
      console.log(`[my-nfts] Found ${nfts.length} NFTs for ${namespace}`);
      return nfts;
    }

    // For each token owned, get its token ID and metadata
    for (let i = 0; i < balance; i++) {
      try {
        // Get token ID by index for this owner (tokenOfOwnerByIndex)
        const ownerPadded = wallet.slice(2).padStart(64, '0');
        const indexPadded = i.toString(16).padStart(64, '0');
        const tokenByIndexRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: contract, data: '0x2f745c59' + ownerPadded + indexPadded }, 'latest'], // tokenOfOwnerByIndex
          }),
        });
        const tokenData = await tokenByIndexRes.json() as { result?: string };
        if (!tokenData.result) continue;

        const tokenId = parseInt(tokenData.result, 16);
        
        // Get token URI to fetch metadata
        const tokenUriRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: contract, data: '0xc87b56dd' + tokenId.toString(16).padStart(64, '0') }, 'latest'], // tokenURI
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
                // Try to extract mint date from metadata if available
                if (metadata.created_at) {
                  minted = new Date(metadata.created_at).toLocaleDateString('en-GB');
                }
              }
            }
          } catch {
            // Metadata fetch failed, use defaults
          }
        }

        nfts.push({
          name: name.replace(/\s+/g, '-').toLowerCase(),
          namespace,
          tokenId,
          tba: wallet.slice(0, 8) + '...' + wallet.slice(-4),
          minted,
        });
      } catch {
        // Skip this token if there's an error
        continue;
      }
    }

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

    return NextResponse.json({ nfts: onChainNfts });
  } catch (err: any) {
    console.error('[my-nfts]', err);
    return NextResponse.json(
      { error: err?.message ?? 'Failed to fetch NFTs' },
      { status: 500 }
    );
  }
}
