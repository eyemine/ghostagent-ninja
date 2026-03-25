/// POST /api/erc8004/register
///
/// Registers a minted GhostAgent into the ERC-8004 Identity Registry on Gnosis mainnet.
///
/// Flow:
///   1. Build ERC-8004 registration JSON for the agent
///   2. Pin it to Lighthouse IPFS → get agentURI CID
///   3. Call Identity Registry register(agentURI) via treasury wallet
///   4. Parse AgentRegistered event → agentId
///   5. Update registration file with agentId and re-pin
///   6. Store erc8004AgentId in KV via worker
///
/// Body: { agentName: string, sld: string, ownerWallet: string, imageCid?: string }

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  keccak256,
  encodePacked,
  type Address,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, baseSepolia, base } from 'viem/chains';
import {
  buildErc8004RegistrationFile,
  patchRegistrationWithAgentId,
  ERC8004_CHAIN_CONFIG,
  type Erc8004ChainKey,
} from '../../../services/erc8004-registration';
import { type SldKey } from '../../../services/genome-metadata';
import { WORKER_URL } from '../../../utils/config';

const VIEM_CHAINS: Record<string, Chain> = {
  gnosis,
  base,
  baseSepolia,
};

const LIGHTHOUSE_UPLOAD = 'https://node.lighthouse.storage/api/v0/add';
const IPFS_GATEWAY      = 'https://gateway.lighthouse.storage/ipfs';

// GNSSubnameResolver v2 — records Safe address for each agent subname at registration time
const GNS_SUBNAME_RESOLVER = '0xc97c7166b7445a6997e22f022d58af7984be5508' as Address;

// Registrar parentNode per agent SLD (Gnosis mainnet) — used to compute subnode key
// matching what BaseRegistrar.mintSubname() stores in GNSRegistry
const SLD_REGISTRAR_PARENT: Record<string, `0x${string}`> = {
  molt:     '0x2c3f063f5a65d02d86b6f32a82c28f1056e75cdb3e115b85db43641f5615a070',
  openclaw: '0xe984888fc91846ebd28e3c10ec974046b42f874e0e99a74f4b6d0ffc4b2282e8',
  agent:    '0x35823db1c5b5d48f4fc11264564abf99cdc2b964c459fa7e4cbc1bff9ce8b0a8',
  picoclaw: '0xc6775facefea31912c74e717ff29394ef9eff5731ef7debc377f2c5e24d3f418',
  vault:    '0xca63a47ebf42451e19c747fe7674898aac15e2b132dd9545ebe97f472bb5c0b2',
};

const ResolverABI = [
  {
    name: 'setSafe',
    type: 'function',
    inputs: [
      { name: 'subnodeKey', type: 'bytes32' },
      { name: 'safe',       type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setText',
    type: 'function',
    inputs: [
      { name: 'node',  type: 'bytes32' },
      { name: 'key',   type: 'string'  },
      { name: 'value', type: 'string'  },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'bulkSetText',
    type: 'function',
    inputs: [
      { name: 'nodes',  type: 'bytes32[]' },
      { name: 'keys',   type: 'string[]'  },
      { name: 'values', type: 'string[]'  },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

const IdentityRegistryABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setAgentURI',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'agentURI', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'AgentRegistered',
    type: 'event',
    anonymous: false,
    inputs: [
      { indexed: true,  name: 'agentId', type: 'uint256' },
      { indexed: true,  name: 'owner',   type: 'address' },
      { indexed: false, name: 'agentURI', type: 'string' },
    ],
  },
] as const;

const VALID_SLDS: SldKey[] = ['agent', 'molt', 'vault', 'nftmail', 'picoclaw', 'openclaw'];

async function pinJsonToLighthouse(
  json: object,
  filename: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
      filename,
    );
    const res = await fetch(LIGHTHOUSE_UPLOAD, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) return null;
    const data = await res.json() as { Hash?: string };
    return data.Hash ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const treasuryKey    = process.env.TREASURY_PRIVATE_KEY;
    const lighthouseKey  = process.env.LIGHTHOUSE_API_KEY;
    const webhookSecret  = process.env.NFTMAIL_WEBHOOK_SECRET;

    if (!treasuryKey) {
      return NextResponse.json(
        { error: 'ERC-8004 registration not configured (missing TREASURY_PRIVATE_KEY)' },
        { status: 503 },
      );
    }

    const body = await req.json() as {
      agentName?: string;
      sld?: string;
      ownerWallet?: string;
      safeAddress?: string;   // Gnosis Safe — stored in resolver; falls back to ownerWallet
      imageCid?: string;
      genomeCid?: string;     // Lighthouse CID of pinned GenomeMetadata JSON
      network?: string;
    };

    const { agentName, sld: sldParam, ownerWallet, safeAddress, imageCid, genomeCid, network } = body;
    const chainKey: Erc8004ChainKey = (network === 'base' || network === 'baseSepolia') ? network : 'gnosis';
    const chainCfg  = ERC8004_CHAIN_CONFIG[chainKey];
    const viemChain = VIEM_CHAINS[chainKey] ?? gnosis;
    const chainConfig = { chain: viemChain, addresses: chainCfg.addresses, chainId: chainCfg.chainId, label: chainCfg.label };

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json({ error: 'agentName is required' }, { status: 400 });
    }
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid ownerWallet address' }, { status: 400 });
    }

    const sld: SldKey = VALID_SLDS.includes(sldParam as SldKey)
      ? (sldParam as SldKey)
      : 'nftmail';

    // ─── Step 1: Build registration file (no agentId yet) ───
    const regFile = buildErc8004RegistrationFile({
      agentName,
      sld,
      imageCid: imageCid ?? null,
    });

    // ─── Step 2: Use stable canonical agentURI (self-updating, no IPFS pin needed) ───
    // /api/agent-card reads the agent's current SLD from KV on every request,
    // so this URI never needs updating post-molt.
    const agentURI = `https://ghostagent.ninja/api/agent-card?agent=${agentName}`;
    const initialCid: string | null = null;

    // ─── Step 3: Call Identity Registry register(agentURI) ───
    const trimmedKey    = treasuryKey.trim().replace(/^0x/, '').slice(0, 64);
    const normalizedKey = `0x${trimmedKey}` as `0x${string}`;
    const account       = privateKeyToAccount(normalizedKey);
    const chainPublic   = createPublicClient({ chain: chainConfig.chain, transport: http() });
    const chainWallet   = createWalletClient({ chain: chainConfig.chain, transport: http(), account });

    const txHash = await chainWallet.writeContract({
      address: chainConfig.addresses.identityRegistry as Address,
      abi:     IdentityRegistryABI,
      functionName: 'register',
      args:    [agentURI],
    });

    const receipt = await chainPublic.waitForTransactionReceipt({ hash: txHash });

    // ─── Step 4: Parse AgentRegistered event → agentId ───
    let agentId: number | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi:    IdentityRegistryABI,
          data:   log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'AgentRegistered') {
          agentId = Number((decoded.args as any).agentId);
        }
      } catch {}
    }

    // ─── Step 5: (skipped) agentURI is canonical and self-updating; no re-pin needed ───
    const finalCid: string | null = initialCid;

    // ─── Step 6: Store erc8004AgentId in KV via worker ───
    let kvStored = false;
    if (agentId !== null) {
      try {
        const kvRes = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:         'setErc8004AgentId',
            agentName,
            erc8004AgentId: agentId,
            agentURI:       agentURI,
            chainId:        chainConfig.chainId,
            safeOwner:      ownerWallet,
          }),
        });
        kvStored = kvRes.ok;
      } catch {
        // Non-fatal
      }
    }

    // ─── Step 7: Record Safe + genome CID as on-chain text records ─────────────
    // Non-fatal. Enables:
    //   subname.[sld].gno → Safe address (addr() resolution)
    //   text(node, "genome")   → Lighthouse IPFS CID of GenomeMetadata JSON
    //   text(node, "agentURI") → ERC-8004 agent-card URL
    //   text(node, "url")      → ghostagent.ninja agent page
    // On NFT sale, the Safe + genome pointer survive on-chain. KV is cache-only.
    if (chainConfig.chainId === 100 && SLD_REGISTRAR_PARENT[sld] && ownerWallet) {
      try {
        const parentNode   = SLD_REGISTRAR_PARENT[sld];
        const labelHash    = keccak256(encodePacked(['string'], [agentName]));
        const subnodeKey   = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
        const resolvedSafe = (safeAddress ?? ownerWallet) as Address;
        const gnosisWallet = createWalletClient({ chain: gnosis, transport: http(), account });

        // setSafe — addr() resolution → Safe
        await gnosisWallet.writeContract({
          address:      GNS_SUBNAME_RESOLVER,
          abi:          ResolverABI,
          functionName: 'setSafe',
          args:         [subnodeKey, resolvedSafe],
        });

        // bulkSetText — store genome CID + agentURI + url on-chain (owner = treasury, authorised)
        const textKeys: string[]   = ['agentURI', 'url'];
        const textVals: string[]   = [
          agentURI,
          `https://ghostagent.ninja/agent/${agentName}`,
        ];
        if (genomeCid) {
          textKeys.push('genome');
          textVals.push(`ipfs://${genomeCid}`);
        }
        if (imageCid) {
          textKeys.push('avatar');
          textVals.push(`ipfs://${imageCid}`);
        }
        await gnosisWallet.writeContract({
          address:      GNS_SUBNAME_RESOLVER,
          abi:          ResolverABI,
          functionName: 'bulkSetText',
          args:         [
            Array(textKeys.length).fill(subnodeKey) as `0x${string}`[],
            textKeys,
            textVals,
          ],
        });
      } catch {
        // Non-fatal — resolver text records are best-effort
      }
    }

    const explorerBase = chainConfig.chainId === 84532 ? 'https://sepolia.basescan.org' : chainConfig.chainId === 8453 ? 'https://basescan.org' : 'https://gnosisscan.io';
    return NextResponse.json({
      success:    true,
      agentName,
      sld,
      agentId,
      txHash,
      agentURI:   agentURI,
      network:    `${chainConfig.label} (chainId ${chainConfig.chainId})`,
      agentRegistry: `eip155:${chainConfig.chainId}:${chainConfig.addresses.identityRegistry}`,
      explorer:   `${explorerBase}/tx/${txHash}`,
      kvStored,
    });
  } catch (err: any) {
    console.error('ERC-8004 register error:', err);
    return NextResponse.json(
      { error: err?.shortMessage || err?.message || 'ERC-8004 registration failed' },
      { status: 500 },
    );
  }
}

// ─── GET — look up agentId for a name ────────────────────────────────────────

export async function GET(req: NextRequest) {
  const agentName = req.nextUrl.searchParams.get('agent');
  if (!agentName) {
    return NextResponse.json({ error: 'Missing agent param' }, { status: 400 });
  }

  try {
    const kvRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', localPart: agentName }),
    });
    if (!kvRes.ok) {
      return NextResponse.json({ registered: false, agentName });
    }
    const kvData = await kvRes.json() as Record<string, unknown>;
    const erc8004AgentId = kvData?.erc8004AgentId ?? null;
    return NextResponse.json({
      registered: typeof erc8004AgentId === 'number',
      agentName,
      erc8004AgentId,
      agentURI: kvData?.agentURI ?? null,
      agentRegistry: `eip155:100:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
    });
  } catch {
    return NextResponse.json({ error: 'Worker unavailable' }, { status: 502 });
  }
}
