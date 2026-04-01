/// API Route: Get user's NFT bodies (beacon NFTs)
/// GET /api/my-nfts
///
/// Returns all NFTs owned by the connected wallet that represent agent bodies.
/// These are the beacon NFTs minted during agent creation.

import { NextRequest, NextResponse } from 'next/server';

const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'https://nftmail-email-worker.richard-159.workers.dev';

// Known beacon NFT contracts (agent body NFTs)
const BEACON_CONTRACTS = {
  'nftmail.gno': '0x46c37365572C9994812AAA41fD04eB56D05469D0', // NFTMail registrar
  'molt.gno': '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50', // Molt registrar
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe', // OpenClaw registrar
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5', // PicoClaw registrar
  'agent.gno': '0x3582544a0c716e449d4a6d4c1c0f3b3a3b3b3b3b', // Agent placeholder
  'vault.gno': '0xca6374a5b4a5a4a5a4a5a4a5a4a5a4a5a4a5a5a5', // Vault placeholder
};

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
        params: [{ to: contract, data: '0x00fdd58e' + wallet.slice(2).padStart(64, '0') }, 'latest'], // balanceOf
      }),
    });
    const balanceData = await balanceRes.json() as { result?: string };
    if (!balanceData.result) return [];

    const balance = parseInt(balanceData.result, 16);
    if (balance === 0) return [];

    const nfts: NftBody[] = [];

    // For each token owned, get its token ID and metadata
    for (let i = 0; i < balance; i++) {
      try {
        // Get token ID by index
        const tokenByIndexRes = await fetch(GNOSIS_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: contract, data: '0x5175df8e' + i.toString(16).padStart(64, '0') }, 'latest'], // tokenByIndex
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
    // Also fetch from worker KV for any additional data
    let workerNfts: NftBody[] = [];
    try {
      const workerRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listAgents', safeAddress: wallet }),
      });
      if (workerRes.ok) {
        const data = await workerRes.json() as { agents?: Array<{ name: string; tld: string; erc8004?: any }> };
        workerNfts = (data.agents ?? []).map(agent => ({
          name: agent.name,
          namespace: agent.tld,
          tokenId: 0, // Will be filled from contract data
          tba: wallet.slice(0, 8) + '...' + wallet.slice(-4),
          minted: new Date().toLocaleDateString('en-GB'),
        }));
      }
    } catch {
      // Worker fetch failed, continue with on-chain data only
    }

    // Fetch on-chain NFTs
    const onChainNfts: NftBody[] = [];
    for (const [namespace, contract] of Object.entries(BEACON_CONTRACTS)) {
      const nfts = await fetchNftsForContract(wallet, contract, namespace);
      onChainNfts.push(...nfts);
    }

    // Merge worker data with on-chain data
    const mergedNfts = workerNfts.map(workerNft => {
      const onChainMatch = onChainNfts.find(n => n.name === workerNft.name);
      return onChainMatch || workerNft;
    });

    // Add any on-chain NFTs not in worker data
    const allNfts = [
      ...mergedNfts,
      ...onChainNfts.filter(n => !mergedNfts.find(w => w.name === n.name))
    ];

    return NextResponse.json({ nfts: allNfts });
  } catch (err: any) {
    console.error('[my-nfts]', err);
    return NextResponse.json(
      { error: err?.message ?? 'Failed to fetch NFTs' },
      { status: 500 }
    );
  }
}
