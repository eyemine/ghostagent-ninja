# GhostAgent Envio HyperIndex

Real-time indexer for the **GhostAgent Protocol** on **Gnosis Chain (chainId 100)**.  
Replaces multi-hop RPC calls with a single <10ms GraphQL query for agent lookups on [notapaperclip.red](https://notapaperclip.red).

---

## Contracts indexed

| Contract | Address | Purpose |
|---|---|---|
| `IdentityRegistry` (ERC-8004) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Global on-chain agent registry |
| `GhostRegistry v2` | `0x194f200b2C624e27a14865292d1C50cF46211565` | Agent registration, molts, BYO governor mapping |
| `MoltRegistrar` | `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50` | `molt.gno` beacon NFT subnames |
| `OpenClawRegistrar` | `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe` | `openclaw.gno` beacon NFT subnames |
| `PicoClawRegistrar` | `0xe5fd65562698f46ea9762bd38141535b1fd875b5` | `picoclaw.gno` beacon NFT subnames |
| `MetadataRegistry` (ERC-8048) | `0x0106341056a8790f4b924c380ed5B81B2a062bCE` | On-chain agent metadata key/value store |

Start block: **32,000,000**

---

## Schema mapping

```
Event                         → Entity            Key
─────────────────────────────────────────────────────────────────
AgentRegistered               → Erc8004Registration  id = "{chainId}:{agentId}"
Registered (GhostRegistry)   → GhostAgent           id = "{tokenId}"
Molted                        → Molt                 id = "{tokenId}:{blockNumber}"
                                                      also updates GhostAgent.tba
PrincipalSet                  → (updates GhostAgent.principal)
ByoGovernorSet                → ByoAgent             id = "{byoContract}:{byoTokenId}"
SubnameMinted                 → SubnameMint          id = "{registrar}:{tokenId}"
TokenboundAccountCreated      → (back-fills SubnameMint.tba for matching tokenId)
MetadataSet (ERC-8048)        → Metadata             id = "{tokenId}:{key}"

All of the above also upsert SafeIndex  id = safe address (lowercase)
  → sources: comma-separated origin tags ("ghostregistry", "byo", "erc8004", "subname")
  → agentName / erc8004AgentId: latest seen values
```

### Key design decisions

- **`SafeIndex`** is a union lookup table — every handler that touches a Safe address upserts it. This lets a single query resolve `safe → agentName + agentId` without knowing which contract registered the agent.
- **`SubnameMint.tba`** starts `null` and is back-filled when `TokenboundAccountCreated` fires for the same `tokenId` on the same registrar contract.
- **IDs are always lowercase addresses / composite strings** — no checksummed addresses, avoids case-mismatch bugs in queries.
- **`Molt` is append-only** — each molt event creates a new record; `GhostAgent.tba` is updated in-place to always reflect the current TBA.

---

## Schema types

```graphql
Erc8004Registration   agentId, owner, agentURI, registeredAt
GhostAgent            name, owner, tba, safe, principal, molts[]
Molt                  agent, oldTba, newTba, safe, moltedAt
ByoAgent              byoContract, byoTokenId, safe, governor
SubnameMint           registrar, tokenId, owner, tba (nullable), mintedAt
Metadata              tokenId, key, value, setAt          # ERC-8048 sidecar
SafeIndex             safeAddress, sources, agentName, erc8004AgentId
```

---

## Running locally

```bash
cd indexer
pnpm install
pnpm envio dev          # starts HyperSync + local Hasura
```

Set `NEXT_PUBLIC_ENVIO_ENDPOINT` in the app root `.env.local` to the local or hosted GraphQL endpoint:

```
NEXT_PUBLIC_ENVIO_ENDPOINT=http://localhost:8080/v1/graphql
```

The app client (`lib/envio.ts`) falls back silently to `null` (degrades to RPC) if the endpoint is unset or unreachable — **no hard dependency at runtime**.

---

## Example queries

```graphql
# All agents owned by a wallet
query AgentsByOwner($owner: String!) {
  GhostAgent(where: { owner: { _eq: $owner } }, order_by: { registeredAt: desc }) {
    id name tba safe principal registeredAt
  }
}

# Resolve agent from Safe address (single round-trip)
query AgentBySafe($safe: String!) {
  SafeIndex(where: { id: { _eq: $safe } }) {
    agentName erc8004AgentId sources
  }
  GhostAgent(where: { safe: { _eq: $safe } }, limit: 1) {
    id name tba
  }
}

# ERC-8004 registration by agentId on Gnosis
query Erc8004ById($id: String!) {
  Erc8004Registration(where: { id: { _eq: $id } }, limit: 1) {
    agentId owner agentURI registeredAt
  }
}

# Molt history for an agent
query MoltHistory($tokenId: String!) {
  Molt(where: { agent_id: { _eq: $tokenId } }, order_by: { moltedAt: desc }) {
    oldTba newTba safe moltedAt txHash
  }
}
```
