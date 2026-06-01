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
      signal: AbortSignal.timeout(3000),
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

// Decode mintSubname(string label, ...) calldata — ABI string starts at offset pointer in head
// Selector: keccak256("mintSubname(string,address,bytes,bytes32)") = 0xa253cc39
function decodeLabelFromCalldata(input: string): string | null {
  try {
    if (input.slice(0, 10) !== '0xa253cc39') return null; // mintSubname selector
    // Head word 0 (input[10..74]): byte offset to string data within params
    const strByteOffset = parseInt(input.slice(10, 74), 16); // typically 128 (4 params × 32)
    const strDataStart = 10 + strByteOffset * 2;            // hex index into input
    const labelLength  = parseInt(input.slice(strDataStart, strDataStart + 64), 16);
    if (!labelLength || labelLength > 200) return null;
    const labelHex = input.slice(strDataStart + 64, strDataStart + 64 + labelLength * 2);
    let label = '';
    for (let i = 0; i < labelHex.length; i += 2)
      label += String.fromCharCode(parseInt(labelHex.slice(i, i + 2), 16));
    return label || null;
  } catch {
    return null;
  }
}

// Build tokenId→label map for a contract by fetching all mint logs ONCE
async function buildLabelMap(contract: string): Promise<Map<number, string>> {
  const labelMap = new Map<number, string>();
  try {
    const logsRes = await fetch(GNOSIS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getLogs',
        // Filter to SubnameMinted topic only: keccak256("SubnameMinted(bytes32,bytes32,bytes32,uint256,address)")
        params: [{ address: contract, topics: ['0xe6468e1dbe999d7ba9f42b63f066848683db5dfec327d25e627f6da2a9d3980f'], fromBlock: 'earliest', toBlock: 'latest' }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    const logsData = await logsRes.json() as { result?: any[] };
    if (!logsData.result?.length) return labelMap;

    // Fetch all tx inputs in parallel
    const txHashes: string[] = [...new Set(
      logsData.result.map((l: any) => l.transactionHash).filter(Boolean)
    )];
    const txResults = await Promise.all(txHashes.map(h =>
      fetch(GNOSIS_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [h] }),
        signal: AbortSignal.timeout(3000),
      }).then(r => r.json() as Promise<{ result?: { input: string; hash: string } }>)
    ));

    const hashToLabel = new Map<string, string>();
    for (const tx of txResults) {
      if (!tx.result?.input) continue;
      const label = decodeLabelFromCalldata(tx.result.input);
      if (label) hashToLabel.set(tx.result.hash.toLowerCase(), label);
    }

    // Map tokenId from log topics/data to label via tx hash
    for (const log of logsData.result) {
      const label = hashToLabel.get((log.transactionHash ?? '').toLowerCase());
      if (!label) continue;
      // SubnameMinted: topics[1..3] are indexed (parentNode,labelhash,subnode)
      // data = abi.encode(uint256 tokenId, address owner) — tokenId is first 32 bytes
      let tokenId: number | null = null;
      if (log.data && log.data.length >= 2 + 64) {
        tokenId = Number(BigInt('0x' + log.data.slice(2, 2 + 64)));
      }
      if (tokenId && tokenId > 0) labelMap.set(tokenId, label);
    }
  } catch {
    // Non-fatal
  }
  return labelMap;
}

function makeBody(label: string | undefined, namespace: string, tokenId: number, wallet: string): NftBody {
  const rawName = (label ?? `token-#${tokenId}`)
    .replace(/\.nftmail\.gno$/i, '').replace(/\.gno$/i, '').replace(/\s+/g, '-').toLowerCase();
  return {
    name: rawName,
    namespace,
    tokenId,
    tba: wallet.slice(0, 8) + '...' + wallet.slice(-4),
    minted: new Date().toLocaleDateString('en-GB'),
  };
}

interface NftBody {
  name: string;
  namespace: string;
  tokenId: number;
  tba: string;
  minted: string;
  isAgent?: boolean;  // true if ERC-8004 registered (has brain)
  safeAddress?: string;  // Safe address for BYO NFT molts (Safe-first architecture)
  tbaAddress?: string;  // Gnosis-side mirror TBA
  imageUrl?: string;   // BYO NFT origin image
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
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json() as { result?: string };
    if (!data.result || data.result === '0x') return 0;
    return parseInt(data.result, 16);
  } catch {
    return 0;
  }
}

// Check worker KV to see if a body has evolved to LITE (agent with brain)
async function isAgentRegistered(name: string): Promise<boolean> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAcctTier', localPart: name, tld: '' }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { tier?: string; error?: string };
    // Agent = LITE (lite) tier or above; basic = basic (body only)
    return !!(data.tier && data.tier !== 'basic' && !data.error);
  } catch {
    return false;
  }
}

// Fetch Safe + TBA + imageUrl from worker KV for BYO NFT molts
async function getAgentMeta(name: string): Promise<{ safeAddress: string | null; tbaAddress: string | null; imageUrl: string | null }> {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentIdentity', agentName: name }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { safeAddress: null, tbaAddress: null, imageUrl: null };
    const data = await res.json() as Record<string, unknown>;
    const safeAddress = (data?.safeAddress ?? data?.safe) as string | null ?? null;
    const tbaAddress  = data?.tbaAddress as string | null ?? null;
    // Also fetch byo-origin-image
    let imageUrl: string | null = null;
    try {
      const imgRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kvGet', key: `byo-origin-image:${name}` }),
        signal: AbortSignal.timeout(4000),
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json() as { value?: string | null };
        imageUrl = imgData.value ?? null;
      }
    } catch { /* non-fatal */ }
    return { safeAddress, tbaAddress, imageUrl };
  } catch {
    return { safeAddress: null, tbaAddress: null, imageUrl: null };
  }
}

async function fetchNftsForContract(wallet: string, contract: string, namespace: string): Promise<NftBody[]> {
  try {
    const walletLower = wallet.toLowerCase();
    const ZERO = '0x0000000000000000000000000000000000000000';

    // ── Step 1: totalSupply + label map in parallel ────────────────────────
    const [totalSupply, labelMap] = await Promise.all([
      getTotalSupply(contract),
      buildLabelMap(contract),
    ]);
    const upperBound = Math.min(Math.max(totalSupply, 20), 200);

    // ── Step 2: parallel ownerOf scan ─────────────────────────────────────
    const tokenIds = Array.from({ length: upperBound }, (_, i) => i + 1);
    const ownerResults = await Promise.all(tokenIds.map(async tokenId => {
      try {
        const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
        const ownerRes = await fetch(GNOSIS_RPC, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
            params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'] }),
          signal: AbortSignal.timeout(3000),
        });
        const ownerData = await ownerRes.json() as { result?: string };
        if (!ownerData.result || ownerData.result.length < 66) return null;
        const ownerAddr = ('0x' + ownerData.result.slice(26)).toLowerCase();
        if (ownerAddr === ZERO.toLowerCase()) return null;
        const directMatch = ownerAddr === walletLower;
        const tbaMatch = !directMatch ? (await tbaOwner(ownerAddr)) === walletLower : false;
        return (directMatch || tbaMatch) ? tokenId : null;
      } catch { return null; }
    }));

    const ownedIds = ownerResults.filter((id): id is number => id !== null);
    const nfts: NftBody[] = ownedIds.map(id => makeBody(labelMap.get(id), namespace, id, wallet));

    // ── Step 3: flag agents + fetch Safe/TBA/image from KV ─────────────────
    await Promise.all(nfts.map(async (nft) => {
      const [isAgent, meta] = await Promise.all([
        isAgentRegistered(nft.name),
        getAgentMeta(nft.name),
      ]);
      nft.isAgent    = isAgent;
      nft.safeAddress = meta.safeAddress ?? undefined;
      nft.tbaAddress  = meta.tbaAddress  ?? undefined;
      nft.imageUrl    = meta.imageUrl    ?? undefined;
    }));

    console.log(`[my-nfts] ${namespace}: found ${nfts.length} NFTs (supply=${totalSupply}), labels=${labelMap.size}`);
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
    // Fetch on-chain beacon NFTs owned by the wallet — all contracts in parallel
    const contractEntries = Object.entries(BEACON_CONTRACTS);
    const results = await Promise.allSettled(
      contractEntries.map(([namespace, contract]) => fetchNftsForContract(wallet, contract, namespace))
    );
    const onChainNfts: NftBody[] = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

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
