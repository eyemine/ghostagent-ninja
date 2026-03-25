/**
 * @module resolver-text
 *
 * Pushes on-chain text records to GNSSubnameResolver for a given agent subname.
 *
 * Why this matters for sellable agents:
 *   KV (Cloudflare) holds mutable cache — it can be lost, rate-limited, or banned.
 *   Text records in GNSSubnameResolver are on-chain (Gnosis), permanent, and transfer
 *   with the Safe when the agent NFT is sold. The genome CID stored here is the
 *   canonical pointer to the agent's brain — survives any cloud provider failure.
 *
 * Standard ENS text record keys used:
 *   "genome"   → ipfs://{CID}  — Lighthouse/IPFS CID of GenomeMetadata JSON
 *   "agentURI" → https://...   — ERC-8004 agent-card URL (canonical, self-updating)
 *   "url"      → https://...   — ghostagent.ninja agent profile page
 *   "avatar"   → ipfs://{CID}  — NFT image CID
 *   "description" → string     — agent tagline / bio
 *
 * Callers: erc8004/register, dashboard profile editor, collection-molt, molt-path-tracker.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  encodePacked,
  type Address,
} from 'viem';
import { gnosis } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Constants ────────────────────────────────────────────────────────────────

export const GNS_SUBNAME_RESOLVER = '0xc97c7166b7445a6997e22f022d58af7984be5508' as Address;

/** Registrar parentNode per agent SLD — matches what BaseRegistrar uses at mint */
export const SLD_REGISTRAR_PARENT: Record<string, `0x${string}`> = {
  molt:     '0x2c3f063f5a65d02d86b6f32a82c28f1056e75cdb3e115b85db43641f5615a070',
  openclaw: '0xe984888fc91846ebd28e3c10ec974046b42f874e0e99a74f4b6d0ffc4b2282e8',
  agent:    '0x35823db1c5b5d48f4fc11264564abf99cdc2b964c459fa7e4cbc1bff9ce8b0a8',
  picoclaw: '0xc6775facefea31912c74e717ff29394ef9eff5731ef7debc377f2c5e24d3f418',
  vault:    '0xca63a47ebf42451e19c747fe7674898aac15e2b132dd9545ebe97f472bb5c0b2',
  nftmail:  '0xf977d267a2f4cc3cb513715001dcb9b2d5926602ddb38fb3773ed4f1ebeedf40',
};

const RESOLVER_ABI = [
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
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key',  type: 'string'  },
    ],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentTextRecords {
  genomeCid?:   string;   // Lighthouse CID — stored as ipfs://{cid}
  agentURI?:    string;   // ERC-8004 agent-card URL
  url?:         string;   // ghostagent.ninja profile URL
  avatarCid?:   string;   // NFT image CID — stored as ipfs://{cid}
  description?: string;   // agent bio/tagline
  arweaveTxId?: string;   // Arweave tx of genome archive — stored as ar://{txId}
  [key: string]: string | undefined;  // arbitrary additional keys
}

export interface SetTextResult {
  success: boolean;
  txHash?:     string;
  subnodeKey?: string;
  error?:      string;
}

// ─── Subnode key computation ──────────────────────────────────────────────────

/**
 * Compute the registrar subnode key for a given agent label + SLD.
 * This matches what BaseRegistrar.mintSubname() stores in GNSRegistry.
 */
export function computeSubnodeKey(agentName: string, sld: string): `0x${string}` | null {
  const parentNode = SLD_REGISTRAR_PARENT[sld];
  if (!parentNode) return null;
  const labelHash  = keccak256(encodePacked(['string'], [agentName]));
  return keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
}

// ─── Main setter ─────────────────────────────────────────────────────────────

/**
 * Write text records for an agent subname onto the GNSSubnameResolver.
 * Called server-side — uses treasury wallet (owner of resolver, authorised for all nodes).
 *
 * Idempotent: safe to call multiple times (overwrites existing values).
 * Non-throwing: returns { success: false, error } on failure.
 *
 * @param agentName   e.g. "ghostagent"
 * @param sld         e.g. "molt"
 * @param records     key/value pairs to write
 * @param safeAddress optional — if provided, also calls setSafe() to update addr() resolution
 * @param walletClient optional — pass an existing wallet client to avoid re-creating
 */
type GnosisWalletClient = ReturnType<typeof createWalletClient>;

export async function setResolverTextRecords(
  agentName: string,
  sld: string,
  records: AgentTextRecords,
  safeAddress?: string,
  walletClient?: GnosisWalletClient,
): Promise<SetTextResult> {
  const subnodeKey = computeSubnodeKey(agentName, sld);
  if (!subnodeKey) {
    return { success: false, error: `Unknown SLD "${sld}" — no registrar parentNode configured` };
  }

  try {
    const rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!walletClient && !rawKey) return { success: false, error: 'TREASURY_PRIVATE_KEY not set' };

    const wc: GnosisWalletClient = walletClient ?? (() => {
      const normalized = rawKey!.startsWith('0x') ? rawKey! as `0x${string}` : `0x${rawKey!}` as `0x${string}`;
      const account = privateKeyToAccount(normalized);
      return createWalletClient({ chain: gnosis, transport: http(), account });
    })();

    // setSafe if requested
    if (safeAddress) {
      await wc.writeContract({
        address:      GNS_SUBNAME_RESOLVER,
        abi:          RESOLVER_ABI,
        functionName: 'setSafe',
        args:         [subnodeKey, safeAddress as Address],
        chain:        gnosis,
        account:      wc.account!,
      });
    }

    // Build key/value arrays from AgentTextRecords
    const keys:   string[] = [];
    const values: string[] = [];

    const { genomeCid, agentURI, url, avatarCid, description, arweaveTxId, ...rest } = records;

    if (genomeCid)   { keys.push('genome');      values.push(`ipfs://${genomeCid}`); }
    if (agentURI)    { keys.push('agentURI');     values.push(agentURI); }
    if (url)         { keys.push('url');          values.push(url); }
    if (avatarCid)   { keys.push('avatar');       values.push(`ipfs://${avatarCid}`); }
    if (description) { keys.push('description');  values.push(description); }
    if (arweaveTxId) { keys.push('arweave');      values.push(`ar://${arweaveTxId}`); }

    // Arbitrary extra keys
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) { keys.push(k); values.push(v); }
    }

    if (keys.length === 0) {
      return { success: true, subnodeKey }; // nothing to write
    }

    const txHash = await wc.writeContract({
      address:      GNS_SUBNAME_RESOLVER,
      abi:          RESOLVER_ABI,
      functionName: 'bulkSetText',
      args:         [
        Array(keys.length).fill(subnodeKey) as `0x${string}`[],
        keys,
        values,
      ],
      chain:   gnosis,
      account: wc.account!,
    });

    return { success: true, txHash, subnodeKey };
  } catch (err: unknown) {
    return {
      success: false,
      subnodeKey,
      error: err instanceof Error ? err.message : 'bulkSetText failed',
    };
  }
}

// ─── Read helper ─────────────────────────────────────────────────────────────

/**
 * Read a text record from the resolver (no wallet needed).
 * Returns null if not set or on error.
 */
export async function getResolverText(
  agentName: string,
  sld: string,
  key: string,
): Promise<string | null> {
  const subnodeKey = computeSubnodeKey(agentName, sld);
  if (!subnodeKey) return null;
  try {
    const publicClient = createPublicClient({ chain: gnosis, transport: http() });
    const value = await publicClient.readContract({
      address:      GNS_SUBNAME_RESOLVER,
      abi:          RESOLVER_ABI,
      functionName: 'text',
      args:         [subnodeKey, key],
    });
    return (value as string) || null;
  } catch {
    return null;
  }
}
