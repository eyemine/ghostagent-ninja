/**
 * Envio HyperIndex client for GhostAgent Protocol
 *
 * Replaces multi-hop RPC calls with a single <10ms GraphQL query.
 * Set NEXT_PUBLIC_ENVIO_ENDPOINT in .env to activate.
 * Falls back silently to null so callers can degrade to RPC.
 *
 * Hosted endpoint format: https://indexer.bigdevenergy.link/{deployId}/v1/graphql
 */

import type { TokenSidecarState, EnvioMetadataResponse } from '../types/indexer';
import { decodeStringValue } from './erc8048-publisher';

const ENDPOINT = process.env.NEXT_PUBLIC_ENVIO_ENDPOINT ?? process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? null;
const BASE_CHONK_CONTRACT = process.env.NEXT_PUBLIC_BASE_CHONK_CONTRACT ?? '0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9';

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!ENDPOINT) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: T; errors?: unknown[] };
    if (json.errors?.length) return null;
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnvioAgent {
  id: string;
  name: string;
  owner: string;
  tba: string;
  safe: string;
  principal: string;
  registeredAt: string;
  txHash: string;
}

export interface EnvioSubnameMint {
  id: string;
  registrar: string;
  tokenId: string;
  owner: string;
  tba: string | null;
  mintedAt: string;
}

export interface EnvioErc8004Registration {
  id: string;
  agentId: string;
  owner: string;
  agentURI: string;
  registeredAt: string;
}

export interface EnvioSafeIndex {
  safeAddress: string;
  agentName: string | null;
  erc8004AgentId: string | null;
  sources: string;
  lastUpdated: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Look up an agent by Safe address — replaces 3 RPC calls */
export async function getAgentBySafe(safe: string): Promise<{
  ghostAgent: EnvioAgent | null;
  subnameMint: EnvioSubnameMint | null;
  erc8004: EnvioErc8004Registration | null;
} | null> {
  const safeId = safe.toLowerCase();
  const data = await gql<{
    SafeIndex: EnvioSafeIndex[];
    GhostAgent: EnvioAgent[];
    SubnameMint: EnvioSubnameMint[];
  }>(`
    query AgentBySafe($safe: String!) {
      SafeIndex(where: { id: { _eq: $safe } }) {
        safeAddress agentName erc8004AgentId sources lastUpdated
      }
      GhostAgent(where: { safe: { _eq: $safe } }, limit: 1) {
        id name owner tba safe principal registeredAt txHash
      }
      SubnameMint(where: { id: { _ilike: $safePat } }, limit: 1) {
        id registrar tokenId owner tba mintedAt
      }
    }
  `, { safe: safeId, safePat: `%${safeId}%` });

  if (!data) return null;

  return {
    ghostAgent: data.GhostAgent[0] ?? null,
    subnameMint: data.SubnameMint[0] ?? null,
    erc8004: null, // resolve via agentId from SafeIndex if needed
  };
}

/** Look up by agentId on Gnosis (chain 100) — replaces tokenURI RPC call */
export async function getErc8004ByAgentId(agentId: number): Promise<EnvioErc8004Registration | null> {
  const data = await gql<{ Erc8004Registration: EnvioErc8004Registration[] }>(`
    query Erc8004ById($id: String!) {
      Erc8004Registration(where: { id: { _eq: $id } }, limit: 1) {
        id agentId owner agentURI registeredAt
      }
    }
  `, { id: `100:${agentId}` });

  return data?.Erc8004Registration[0] ?? null;
}

/** Look up all agents by owner address — replaces listAgents worker call */
export async function getAgentsByOwner(owner: string): Promise<EnvioAgent[]> {
  const data = await gql<{ GhostAgent: EnvioAgent[] }>(`
    query AgentsByOwner($owner: String!) {
      GhostAgent(where: { owner: { _eq: $owner } }, order_by: { registeredAt: desc }) {
        id name owner tba safe principal registeredAt txHash
      }
    }
  `, { owner: owner.toLowerCase() });

  return data?.GhostAgent ?? [];
}

/** Check if Envio endpoint is configured and reachable */
export async function isEnvioAvailable(): Promise<boolean> {
  if (!ENDPOINT) return false;
  const data = await gql<{ GhostAgent: { id: string }[] }>(`
    query Ping { GhostAgent(limit: 1) { id } }
  `);
  return data !== null;
}

function decodeHexString(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('0x')) return value;
  const raw = value.slice(2);
  if (!raw) return undefined;
  try {
    const bytes = raw.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0+$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

function normalizeHexAddress(value: string | null | undefined): `0x${string}` | undefined {
  if (!value?.startsWith('0x')) return undefined;
  return value as `0x${string}`;
}

const GET_SIDECAR_METADATA_QUERY = `
  query GetSidecarMetadata($tokenIds: [BigInt!]) {
    Metadata(where: { tokenId: { _in: $tokenIds } }) {
      tokenId
      key
      value
    }
  }
`;

export async function fetchSovereignSidecarMatrix(
  tokenContract: `0x${string}`,
  tokenIds: number[],
  collectionKey?: string,
): Promise<TokenSidecarState[]> {
  if (!ENDPOINT || tokenIds.length === 0) return [];

  const data = await gql<EnvioMetadataResponse>(GET_SIDECAR_METADATA_QUERY, {
    tokenIds: tokenIds.map(String),
  });

  const metadataRows = data?.Metadata ?? [];

  return tokenIds.map((id) => {
    const tokenRecords = metadataRows.filter((row) => row.tokenId === id.toString());
    const rawIpId = tokenRecords.find((r) => r.key === 'story[ip_id]')?.value;
    const rawLicenseId = tokenRecords.find((r) => r.key === 'story[license_id]')?.value;
    const rawVaultId = tokenRecords.find((r) => r.key === 'cdr[vault_id]')?.value;
    const rawMandate = tokenRecords.find((r) => r.key === 'cursor[mandate]')?.value;
    const rawAgreementHash = tokenRecords.find((r) => r.key === 'cursor[agreement_hash]')?.value;

    const isFakeNormie = collectionKey === 'fakenormie';
    const isChonk = collectionKey === 'chonk';

    const name = isFakeNormie
      ? `FakeNormie #${id}`
      : isChonk
      ? `Chonk #${id}`
      : collectionKey
      ? `${collectionKey} #${id}`
      : `Asset #${id}`;

    const image = isFakeNormie
      ? `/FakeNormies/SVGS/${String(id).padStart(2, '0')}.svg`
      : isChonk
      ? `https://api.chonks.carbonlocks.xyz/images/${id}.png`
      : '';

    const cursorMandate = rawMandate ? decodeStringValue(rawMandate) : undefined;
    const cursorAgreementHash = rawAgreementHash ? decodeStringValue(rawAgreementHash) : undefined;

    return {
      contractAddress: tokenContract,
      tokenId: id,
      name,
      image,
      storyIpId: rawIpId ? normalizeHexAddress(rawIpId) : undefined,
      storyLicenseId: rawLicenseId ? decodeStringValue(rawLicenseId) : undefined,
      cdrVaultId: rawVaultId ? decodeStringValue(rawVaultId) : undefined,
      cursorMandate,
      cursorAgreementHash,
      isRegistered: !!rawIpId,
      hasSidecarState: tokenRecords.length > 0,
    };
  });
}

// ── Wallet token discovery (ERC-721 Enumerable + fallback) ────────────────────

export async function fetchTokenIdsForWallet(
  walletAddress: string,
  contractAddress: string,
  rpcUrl: string = 'https://mainnet.base.org',
): Promise<number[]> {
  if (!walletAddress.startsWith('0x')) return [];

  const configuredIds = process.env.NEXT_PUBLIC_CDR_DEMO_CHONK_TOKEN_IDS;
  if (configuredIds) {
    return configuredIds
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0);
  }

  // Primary: ERC-721 Enumerable (balanceOf + tokenOfOwnerByIndex)
  try {
    const balanceRes = await rpcCall(rpcUrl, 'eth_call', [{
      to: contractAddress,
      data: encodeBalanceOfCall(walletAddress),
    }, 'latest']);
    const balance = Number(BigInt(balanceRes ?? '0x0'));
    if (balance === 0) return [];

    const ids: number[] = [];
    for (let i = 0; i < balance; i++) {
      const idRes = await rpcCall(rpcUrl, 'eth_call', [{
        to: contractAddress,
        data: encodeTokenOfOwnerByIndexCall(walletAddress, i),
      }, 'latest']);
      const id = Number(BigInt(idRes ?? '0x0'));
      if (Number.isSafeInteger(id)) ids.push(id);
    }
    return ids;
  } catch {
    // Fallback: limited-range eth_getLogs (last ~100k blocks)
    return fetchTokenIdsViaLogs(walletAddress, contractAddress, rpcUrl);
  }
}

async function fetchTokenIdsViaLogs(
  walletAddress: string,
  contractAddress: string,
  rpcUrl: string,
): Promise<number[]> {
  const owner = walletAddress.toLowerCase();
  const contract = contractAddress.toLowerCase();
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const ownerTopic = `0x${owner.slice(2).padStart(64, '0')}`;

  try {
    const latestRes = await rpcCall(rpcUrl, 'eth_blockNumber', []);
    const latest = Number(BigInt(latestRes ?? '0x0'));
    const fromBlock = Math.max(0, latest - 100_000);

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{
          address: contract,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: 'latest',
          topics: [transferTopic, null, ownerTopic],
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as { result?: Array<{ topics?: string[] }>; error?: unknown };
    if (json.error) return [];
    return Array.from(new Set((json.result ?? [])
      .map((log) => log.topics?.[3])
      .filter((topic): topic is string => !!topic)
      .map((topic) => Number(BigInt(topic)))
      .filter((value) => Number.isSafeInteger(value))));
  } catch {
    return [];
  }
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<string | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const json = await res.json() as { result?: string; error?: unknown };
  if (json.error) return null;
  return json.result ?? null;
}

function encodeBalanceOfCall(owner: string): string {
  return `0x70a08231000000000000000000000000${owner.slice(2).toLowerCase()}`;
}

function encodeTokenOfOwnerByIndexCall(owner: string, index: number): string {
  const ownerPadded = owner.slice(2).toLowerCase().padStart(64, '0');
  const indexHex = index.toString(16).padStart(64, '0');
  return `0x2f745c59${ownerPadded}${indexHex}`;
}
