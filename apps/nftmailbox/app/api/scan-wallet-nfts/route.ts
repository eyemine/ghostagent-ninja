import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const ETH_RPC = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
const BASE_RPC = 'https://mainnet.base.org';

// ENS Name Wrapper — holds .eth names as ERC-721 tokens
const ENS_NAME_WRAPPER = '0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401' as const;

// Wrap any promise with a timeout — resolves to null on timeout/error
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

// ENS subgraph: fetch all .eth names owned by an address
async function fetchEnsNames(address: string): Promise<Array<{ label: string; ensName: string }>> {
  const query = `{
    domains(where: { owner: "${address.toLowerCase()}", labelName_not: null, parent_: { name: "eth" } }, first: 20) {
      labelName
      name
    }
  }`;
  const res = await fetch('https://api.thegraph.com/subgraphs/name/ensdomains/ens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(4000),
  });
  const json = await res.json() as any;
  const domains: any[] = json?.data?.domains || [];
  return domains
    .filter((d: any) => d.labelName && /^[a-z0-9]+$/.test(d.labelName))
    .map((d: any) => ({ label: d.labelName as string, ensName: d.name as string }));
}

// Verified NFT collections that can create nftmail.box accounts
// Email format: [name].[tokenId]@nftmail.box (e.g. chonk.1@nftmail.box)
interface VerifiedCollection {
  name: string;           // lowercase email prefix  e.g. "atom"
  displayName: string;    // human-readable          e.g. "Atom"
  contractAddress: string;
  chainId: number;
  rpcUrl: string;
}

const VERIFIED_COLLECTIONS: VerifiedCollection[] = [
  {
    name: 'atom',
    displayName: 'Atom',
    contractAddress: '0x9abb7bddc43fa67c76a62d8c016513827f59be1b',
    chainId: 1,
    rpcUrl: ETH_RPC,
  },
  {
    name: 'chonk',
    displayName: 'Chonk',
    contractAddress: '0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9',
    chainId: 8453,
    rpcUrl: BASE_RPC,
  },
  {
    name: 'normie',
    displayName: 'Normie',
    contractAddress: '0x9eb6e2025b64f340691e424b7fe7022ffde12438',
    chainId: 1,
    rpcUrl: ETH_RPC,
  },
  {
    name: 'punk',
    displayName: 'Punk',
    contractAddress: '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb',
    chainId: 1,
    rpcUrl: ETH_RPC,
  },
  {
    name: 'cryptopunk',
    displayName: 'CryptoPunk',
    contractAddress: '0x282bdd42f4eb70e7a9d9f40c8fea0825b7f68c5d',
    chainId: 1,
    rpcUrl: ETH_RPC,
  },
  {
    name: 'mooncat',
    displayName: 'MoonCat',
    contractAddress: '0xc3f733ca98e0dad0386979eb96fb1722a1a05e69',
    chainId: 1,
    rpcUrl: ETH_RPC,
  },
];

const erc721Abi = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface WalletNft {
  type: 'ens' | 'collection';
  name: string;           // e.g. "vitalik" or "chonk"
  displayName: string;    // e.g. "vitalik.eth" or "Chonks #1"
  email: string;          // e.g. "vitalik@nftmail.box" or "chonk.1@nftmail.box"
  tokenId?: string;
  collection?: string;
}

export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get('address');
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
    }

    const addr = address as `0x${string}`;
    const seenEmails = new Set<string>();
    const nfts: WalletNft[] = [];

    const ethClient = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });

    // Run primary reverse-resolve + subgraph lookup in parallel, 4s timeout each
    const [primaryResult, subgraphResult] = await Promise.allSettled([
      withTimeout(ethClient.getEnsName({ address: addr }), 4000),
      withTimeout(fetchEnsNames(address), 4000),
    ]);

    // 1. Primary ENS name — always first
    const primaryEns = primaryResult.status === 'fulfilled' ? primaryResult.value : null;
    if (primaryEns && typeof primaryEns === 'string' && primaryEns.endsWith('.eth')) {
      const parts = primaryEns.split('.');
      if (parts.length === 2) {
        const label = parts[0].toLowerCase();
        if (/^[a-z0-9]+$/.test(label)) {
          const email = `${label}@nftmail.box`;
          nfts.push({ type: 'ens', name: label, displayName: primaryEns, email });
          seenEmails.add(email);
        }
      }
    }

    // 2. Any additional .eth names from subgraph (deduped against primary)
    const subgraphNames = subgraphResult.status === 'fulfilled' && Array.isArray(subgraphResult.value)
      ? subgraphResult.value as Array<{ label: string; ensName: string }>
      : [];
    for (const { label, ensName } of subgraphNames) {
      const email = `${label}@nftmail.box`;
      if (!seenEmails.has(email)) {
        nfts.push({ type: 'ens', name: label, displayName: ensName, email });
        seenEmails.add(email);
      }
    }

    // 3. Verified NFT collections — scan each for holdings (up to 5 tokens each)
    const collectionPromises = VERIFIED_COLLECTIONS.map(async (coll) => {
      try {
        const { createPublicClient: mkClient, http: mkHttp } = await import('viem');
        const chain = coll.chainId === 8453
          ? (await import('viem/chains')).base
          : (await import('viem/chains')).mainnet;
        const client = mkClient({ chain, transport: mkHttp(coll.rpcUrl) });

        const balance = await withTimeout(
          client.readContract({
            address: coll.contractAddress as `0x${string}`,
            abi: erc721Abi,
            functionName: 'balanceOf',
            args: [addr],
          }),
          4000
        );
        if (!balance || balance === BigInt(0)) return;

        const count = Math.min(Number(balance), 5);
        const tokenPromises = Array.from({ length: count }, (_, i) =>
          withTimeout(
            client.readContract({
              address: coll.contractAddress as `0x${string}`,
              abi: erc721Abi,
              functionName: 'tokenOfOwnerByIndex',
              args: [addr, BigInt(i)],
            }),
            4000
          )
        );
        const tokenIds = await Promise.all(tokenPromises);

        for (const tokenId of tokenIds) {
          if (tokenId === null || tokenId === undefined) continue;
          const tid = String(tokenId);
          const email = `${coll.name}.${tid}@nftmail.box`;
          if (!seenEmails.has(email)) {
            nfts.push({
              type: 'collection',
              name: coll.name,
              displayName: `${coll.displayName} #${tid}`,
              email,
              tokenId: tid,
              collection: coll.name,
            });
            seenEmails.add(email);
          }
        }
      } catch {
        // Best-effort — skip failed collections
      }
    });

    await Promise.allSettled(collectionPromises);

    return NextResponse.json({
      address: addr,
      nfts,
      count: nfts.length,
    });
  } catch (err: any) {
    console.error('scan-wallet-nfts error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to scan wallet NFTs' },
      { status: 500 }
    );
  }
}
