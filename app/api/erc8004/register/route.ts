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
      imageCid?: string;
      network?: string;
    };

    const { agentName, sld: sldParam, ownerWallet, imageCid, network } = body;
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

    // ─── Step 2: Pin initial registration JSON to IPFS ───
    let agentURI = `https://nftmail.box/api/agent-card?agent=${agentName}&sld=${sld}`;
    let initialCid: string | null = null;

    if (lighthouseKey) {
      initialCid = await pinJsonToLighthouse(
        regFile,
        `${agentName}-${sld}-erc8004.json`,
        lighthouseKey,
      );
      if (initialCid) {
        agentURI = `${IPFS_GATEWAY}/${initialCid}`;
      }
    }

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

    // ─── Step 5: Re-pin registration file with agentId patched in ───
    let finalCid: string | null = initialCid;
    if (agentId !== null && lighthouseKey) {
      const patchedFile = patchRegistrationWithAgentId(regFile, agentId);
      const repinnedCid = await pinJsonToLighthouse(
        patchedFile,
        `${agentName}-${sld}-erc8004-v2.json`,
        lighthouseKey,
      );
      if (repinnedCid) {
        finalCid = repinnedCid;
        // Update agentURI on-chain with patched CID
        const updatedURI = `${IPFS_GATEWAY}/${repinnedCid}`;
        if (agentId !== null) {
          try {
            await chainWallet.writeContract({
              address: chainConfig.addresses.identityRegistry as Address,
              abi:     IdentityRegistryABI,
              functionName: 'setAgentURI',
              args:    [BigInt(agentId), updatedURI],
            });
          } catch {
            // Non-fatal — initial URI still valid
          }
        }
      }
    }

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
            agentURI:       finalCid ? `${IPFS_GATEWAY}/${finalCid}` : agentURI,
            chainId:        chainConfig.chainId,
            safeOwner:      ownerWallet,
          }),
        });
        kvStored = kvRes.ok;
      } catch {
        // Non-fatal
      }
    }

    const explorerBase = chainConfig.chainId === 84532 ? 'https://sepolia.basescan.org' : chainConfig.chainId === 8453 ? 'https://basescan.org' : 'https://gnosisscan.io';
    return NextResponse.json({
      success:    true,
      agentName,
      sld,
      agentId,
      txHash,
      agentURI:   finalCid ? `${IPFS_GATEWAY}/${finalCid}` : agentURI,
      agentURICid: finalCid,
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
