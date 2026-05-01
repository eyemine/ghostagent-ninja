import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, decodeAbiParameters } from 'viem';
import { gnosis } from 'viem/chains';

const REGISTRAR = '0x831ddd71e7c33e16b674099129E6E379DA407fAF' as const;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// ERC721 balanceOf + ownerOf
const erc721Abi = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextTokenId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(process.env.NEXT_PUBLIC_GNOSIS_RPC || 'https://rpc.gnosischain.com'),
});

// Cache: tokenId -> label (populated from tx calldata)
const labelCache = new Map<number, string>();

async function resolveLabelFromTx(txHash: `0x${string}`): Promise<string | null> {
  try {
    const tx = await publicClient.getTransaction({ hash: txHash });
    // mintSubname(string label, address owner, bytes storyData, bytes32 tbaSalt)
    // selector = first 4 bytes
    const data = tx.input;
    if (data.length < 10) return null;
    const params = decodeAbiParameters(
      [
        { name: 'label', type: 'string' },
        { name: 'owner', type: 'address' },
        { name: 'storyData', type: 'bytes' },
        { name: 'tbaSalt', type: 'bytes32' },
      ],
      `0x${data.slice(10)}` as `0x${string}`
    );
    return params[0] as string;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get('address');
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    // Primary: KV controller lookup — works for EOA, TBA-held, and Safe-held NFTs
    try {
      const kvRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listNftmailByController', controller: address }),
      });
      if (kvRes.ok) {
        const kvData = await kvRes.json() as { names?: { name: string; email: string; gnoName: string; tokenId: number | null }[]; error?: string };
        if (!kvData.error && (kvData.names?.length ?? 0) > 0) {
          return NextResponse.json({
            names: kvData.names!.map(n => ({ tokenId: n.tokenId, label: n.name, email: n.email, gnoName: n.gnoName })),
          });
        }
      }
    } catch { /* fall through to on-chain scan */ }

    const addr = address as `0x${string}`;

    // Fallback: on-chain ownerOf scan for direct NFT holders (social/embedded wallets)
    // Get total supply to know how many tokens exist
    const nextTokenId = await publicClient.readContract({
      address: REGISTRAR,
      abi: erc721Abi,
      functionName: 'nextTokenId',
    });

    const totalTokens = Number(nextTokenId) - 1; // tokens start at 1

    if (totalTokens <= 0) {
      return NextResponse.json({ names: [] });
    }

    // Check ownership for each token (small supply, this is fine)
    const ownedTokens: number[] = [];
    const ownerCalls = [];
    for (let i = 1; i <= totalTokens; i++) {
      ownerCalls.push(
        publicClient.readContract({
          address: REGISTRAR,
          abi: erc721Abi,
          functionName: 'ownerOf',
          args: [BigInt(i)],
        }).then(owner => {
          if (owner.toLowerCase() === addr.toLowerCase()) {
            ownedTokens.push(i);
          }
        }).catch(() => {})
      );
    }
    await Promise.all(ownerCalls);

    if (ownedTokens.length === 0) {
      return NextResponse.json({ names: [] });
    }

    // Get SubnameMinted events to resolve labels
    // Scan all logs from the registrar
    const logs = await publicClient.getLogs({
      address: REGISTRAR,
      event: parseAbiItem(
        'event SubnameMinted(bytes32 indexed parentNode, bytes32 indexed labelhash, bytes32 indexed subnode, uint256 tokenId, address owner)'
      ),
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    // Map tokenId -> tx hash from events
    const tokenTxMap = new Map<number, `0x${string}`>();
    for (const log of logs) {
      const tokenId = Number((log as any).args.tokenId);
      if (ownedTokens.includes(tokenId) && log.transactionHash) {
        tokenTxMap.set(tokenId, log.transactionHash);
      }
    }

    // Resolve labels from tx calldata
    const names: { tokenId: number; label: string; email: string; gnoName: string }[] = [];
    for (const tokenId of ownedTokens) {
      let label = labelCache.get(tokenId);
      if (!label) {
        const txHash = tokenTxMap.get(tokenId);
        if (txHash) {
          label = (await resolveLabelFromTx(txHash)) || undefined;
          if (label) labelCache.set(tokenId, label);
        }
      }
      if (label) {
        // On-chain GNO subname uses hyphens (mac-slave.nftmail.gno)
        // but canonical email address uses dots (mac.slave@nftmail.box)
        const emailLabel = label.replace(/-/g, '.');
        names.push({
          tokenId,
          label,
          email: `${emailLabel}@nftmail.box`,
          gnoName: `${label}.nftmail.gno`,
        });
      }
    }

    return NextResponse.json({ names });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to resolve NFTMail names';
    console.error('resolve-nftmail error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
