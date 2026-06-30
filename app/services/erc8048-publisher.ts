/**
 * ERC-8048 Publisher
 * Encodes metadata entries and prepares calldata for GhostAgentMetadataRegistry.
 * Keys: endpoint[a2a], endpoint[mcp], skills/primary, agent-binding, cursor[mandate]
 */

export const KNOWN_KEYS = [
  { key: 'endpoint[a2a]',   label: 'A2A Endpoint',      hint: 'e.g. ghostagent_@nftmail.box' },
  { key: 'endpoint[mcp]',   label: 'MCP Server',         hint: 'e.g. https://mcp.ghostagent.ninja' },
  { key: 'skills/primary',  label: 'Primary Skill',      hint: 'e.g. accounting' },
  { key: 'skills/tools',    label: 'Tools',              hint: 'comma-separated tool names' },
  { key: 'agent-binding',   label: 'Agent Binding',      hint: 'ERC-8048 binding hex (advanced)' },
  { key: 'cursor[mandate]', label: 'Spending Mandate',   hint: 'restricted | worker | executive' },
] as const;

export const MANDATE_OPTIONS = [
  { value: 'restricted', label: '🛡 Safe Mode',         subCapLabel: '0.001 xDAI / session' },
  { value: 'worker',     label: '🛠 Autonomous Worker', subCapLabel: '0.02 xDAI / session'  },
  { value: 'executive',  label: '🚀 DeFi Executive',    subCapLabel: '0.10 xDAI / session'  },
] as const;

export function getSubCapFromMandate(mandate: string): bigint {
  switch (mandate) {
    case 'restricted': return    1_000_000_000_000n;
    case 'worker':     return   20_000_000_000_000n;
    case 'executive':  return  100_000_000_000_000n;
    default:           return    1_000_000_000_000n;
  }
}

export const CURSOR_CONTRACT   = '0x5235249f1409a315349036af4ea914a9efdb7cbf' as const;
export const CURSOR_CHIADO_RPC = 'https://rpc.chiado.gnosis.gateway.fm' as const;
export const CURSOR_ISSUER     = '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5' as `0x${string}`;
/** keccak256(utf8("default")) — the leaf-level scopeId committed at registration time */
export const LEAF_SCOPE_ID     = '0xcfee7c08a98f4b565d124c7e4e28acc52e1bc780e3887db0a02a7d2d5bc66728' as `0x${string}`;

export const CURSOR_ABI = [
  {
    name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs:  [{ name: 'id', type: 'bytes32' }, { name: 'capRoot', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'capabilityRoot', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'leafSpent', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'id', type: 'bytes32' }, { name: 'scopeId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type KnownKey = typeof KNOWN_KEYS[number]['key'];

/** Encode a UTF-8 string value as 0x-prefixed hex bytes */
export function encodeStringValue(value: string): `0x${string}` {
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

/** Decode 0x-prefixed hex bytes back to UTF-8 string */
export function decodeStringValue(hex: string): string {
  try {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (!raw) return '';
    const arr = new Uint8Array(raw.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
    return new TextDecoder().decode(arr);
  } catch { return ''; }
}

/** ABI for GhostAgentMetadataRegistry */
export const REGISTRY_ABI = [
  {
    name: 'metadata',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'key',     type: 'string'  },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'setMetadata',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'key',     type: 'string'  },
      { name: 'value',   type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    name: 'setMetadataBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256'  },
      { name: 'keys',    type: 'string[]' },
      { name: 'values',  type: 'bytes[]'  },
    ],
    outputs: [],
  },
  {
    name: 'ghostAgentOperator',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export interface PublishEntry {
  key: string;
  value: string;
}

export interface PublishPlan {
  registryAddress: string;
  tokenId: bigint;
  entries: PublishEntry[];
}

/**
 * Build a batch publish plan for an agent's standard metadata keys.
 * `agentId` is the ERC-8004 agentId (used as tokenId in the sidecar).
 */
export function buildPublishPlan(params: {
  registryAddress: string;
  agentId: number;
  a2aEndpoint?: string;
  mcpServer?: string;
  primarySkill?: string;
  tools?: string;
}): PublishPlan {
  const { registryAddress, agentId, a2aEndpoint, mcpServer, primarySkill, tools } = params;
  const entries: PublishEntry[] = [];
  if (a2aEndpoint) entries.push({ key: 'endpoint[a2a]', value: a2aEndpoint });
  if (mcpServer)   entries.push({ key: 'endpoint[mcp]', value: mcpServer });
  if (primarySkill) entries.push({ key: 'skills/primary', value: primarySkill });
  if (tools)        entries.push({ key: 'skills/tools',   value: tools });
  return { registryAddress, tokenId: BigInt(agentId), entries };
}
