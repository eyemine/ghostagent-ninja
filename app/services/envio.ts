/**
 * Envio HyperIndex client for GhostAgent Protocol
 *
 * Replaces multi-hop RPC calls with a single <10ms GraphQL query.
 * Set NEXT_PUBLIC_ENVIO_ENDPOINT in .env to activate.
 * Falls back silently to null so callers can degrade to RPC.
 *
 * Hosted endpoint format: https://indexer.bigdevenergy.link/{deployId}/v1/graphql
 */

const ENDPOINT = process.env.NEXT_PUBLIC_ENVIO_ENDPOINT ?? null;

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
