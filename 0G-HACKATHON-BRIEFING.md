# 0G APAC Hackathon — Dev Briefing

**Hackathon**: [0G APAC Hackathon on HackQuest](https://www.hackquest.io/hackathons/0G-APAC-Hackathon)
**Submission Deadline**: May 9, 2026, 23:59 UTC+8
**Online Checkpoint**: Early April 2026 (progress update — optional but recommended)
**Prize Pool**: $150,000 ($45k / $35k / $20k + 20 smaller awards)

---

## 1. What Is GhostAgent / NFTmail?

**GhostAgent Ninja** is a trustless agent identity protocol (ERC-8004) deployed on Gnosis Chain.
**NFTmail** is its email layer — every minted agent gets an `agentname_@nftmail.box` address with an encrypted KV inbox.

Key features already live in production:
- Mint agent identities as GNS subnames (e.g. `paymastr.nftmail.gno`)
- ERC-6551 token-bound accounts (TBAs) + Gnosis Safe treasury per agent
- Encrypted email inbox (ECIES, blind storage, no plaintext at rest)
- Beacon metadata pinned to IPFS (Lighthouse) — NFT-compatible JSON
- Handshake certificates, authorship declarations, IP transfer agreements — all pinned to IPFS
- Story Protocol IP registration with aiMetadata pointing to IPFS CIDs
- Molt evolution path (larva → pupa → imago → ghost tier system)
- Gasless minting for picoclaw.gno, agent.gno (ENS holders), coupon system

**Production URLs**:
- https://ghostagent.ninja (Next.js 14, Netlify)
- https://nftmail.box (Next.js, Netlify)
- Cloudflare Worker: `https://nftmail-email-worker.richard-159.workers.dev`

---

## 2. Hackathon Track

**Track 5: Privacy & Sovereign Infrastructure** (primary)
> "Building the confidentiality rails and abstraction layers for a secure Web 4.0.
> Developing privacy-preserving protocols, cross-chain fragmentation solutions."

GhostAgent is sovereign encrypted email with NFT-gated inboxes — direct fit.

**Track 3: Agentic Economy & Autonomous Applications** (secondary)
> "Self-custodial agent wallets, Agent-as-a-Service platforms."

ERC-8004 identity + Safe treasury + nftmail inbox = agent economy infra.

---

## 3. The Integration: Replace Lighthouse/IPFS with 0G Storage

The entire IPFS/Lighthouse dependency is a storage layer for:
1. **Agent beacon metadata** — JSON pinned after mint (NFT metadata standard)
2. **Genome images** — SVG composites pinned as agent profile pictures
3. **Handshake certificates** — signed JSON proving agent-to-agent handshakes
4. **Authorship declarations** — signed proof of content authorship
5. **IP transfer agreements** — legal docs for Story Protocol IP transfers
6. **ERC-8004 registration data** — agent card JSON with genome CID
7. **Encrypted email backups** — blind envelopes pinned for durability (worker)
8. **Story Protocol IPA metadata** — aiMetadata with characterFileUrl pointing to stored JSON

**Your job**: Replace all Lighthouse upload calls + gateway URLs with 0G Storage SDK equivalents.

---

## 4. Hard Hackathon Requirements

Every submission MUST include:
- [ ] **0G mainnet contract address** + 0G Explorer link with on-chain activity
- [ ] **At least one 0G component** integrated (0G Storage is ours)
- [ ] **Public GitHub repo** with meaningful commits during hackathon period
- [ ] **3-minute demo video** showing real product + 0G usage
- [ ] **README** with architecture diagram, 0G module explanation, local deploy steps
- [ ] **X post** with `#0GHackathon` `#BuildOn0G` tagging `@0G_labs @0g_CN @0g_Eco @HackQuest_`

---

## 5. File-by-File Replacement Map

### Priority 1: Core Upload Functions (create `app/services/zero-g-storage.ts`)

Build a single adapter module that exports:
```ts
export async function uploadToZeroG(data: Blob | string, filename: string): Promise<{ cid: string; url: string }>;
export function zeroGGatewayUrl(cid: string): string;
```

This replaces all Lighthouse upload calls across the codebase.

### Priority 2: Upload Call Sites

| File | What It Does | What To Change |
|------|-------------|----------------|
| `app/services/beacon-metadata.ts` | `pinToIPFS()` + `buildAndPin()` — pins agent beacon JSON | Replace Lighthouse fetch with `uploadToZeroG()` |
| `app/api/genome-image/route.ts` | Pins SVG agent profile images | Replace `LIGHTHOUSE_UPLOAD` fetch with `uploadToZeroG()` |
| `app/api/handshake/route.ts` | `pinToLighthouse()` — pins handshake certificate JSON | Replace with `uploadToZeroG()` |
| `app/services/authorship-declaration.ts` | `pinAuthorshipToIPFS()` — pins declaration JSON | Replace Lighthouse fetch with `uploadToZeroG()` |
| `app/services/ip-transfer-agreement.ts` | `pinTransferAgreementToIPFS()` — pins transfer doc | Replace Lighthouse fetch with `uploadToZeroG()` |
| `app/api/erc8004/register/route.ts` | Pins ERC-8004 registration JSON (genome + agent card) | Replace `LIGHTHOUSE_UPLOAD` fetch with `uploadToZeroG()` |
| `app/api/gasless-ip-mint/route.ts` | Pins Story Protocol IPA metadata JSON | Replace Lighthouse fetch with `uploadToZeroG()` |
| `app/api/beacon/route.ts` | Calls `buildAndPin()` — already covered by beacon-metadata.ts | No direct change needed if beacon-metadata.ts is updated |
| `app/api/evolve/route.ts` | Passes `LIGHTHOUSE_API_KEY` to molt tracker → re-pin beacon | Update to pass 0G config instead |

### Priority 3: Gateway URL References

These files read/display IPFS content via `gateway.lighthouse.storage`. Replace with 0G gateway:

| File | Lines | What To Change |
|------|-------|----------------|
| `app/services/erc8004-registration.ts` | `IPFS_GATEWAY` constant | Change to 0G gateway URL |
| `app/services/genome-metadata.ts` | `IPFS_PREFIX`, `GATEWAY` constants | Change to 0G gateway URL |
| `app/api/agent-card/route.ts` | `staticCardUrl` construction | Change gateway URL |
| `app/api/genome-image/route.ts` | `IPFS_GATEWAY` constant | Change to 0G gateway URL |
| `app/api/erc8004/register/route.ts` | `IPFS_GATEWAY` constant | Change to 0G gateway URL |
| `app/api/handshake/route.ts` | `LIGHTHOUSE_GATEWAY` constant | Change to 0G gateway URL |
| `app/layout.tsx` | Favicon URL (hardcoded CID) | Update to 0G gateway or keep as static asset |
| `next.config.js` | Image domain allowlist | Add 0G gateway domain, remove lighthouse |
| `scripts/fetch-sld-images.mjs` | `GATEWAY` constant for pre-fetching SLD images | Change to 0G gateway URL |
| `app/components/AgentIdentityCard.tsx` (nftmail.box) | `ipfsGw` constant | Change to 0G gateway URL |

### Priority 4: Worker (Cloudflare)

| File | What To Change |
|------|----------------|
| `workers/nftmail-email-worker/src/index.ts` | Two `web3.storage/upload` calls for encrypted email backup → replace with 0G Storage upload |

### Priority 5: Env Var Swap

| Old Var | New Var | Notes |
|---------|---------|-------|
| `LIGHTHOUSE_API_KEY` | `ZEROG_PRIVATE_KEY` or `ZEROG_STORAGE_KEY` | 0G SDK authentication |
| N/A (new) | `ZEROG_STORAGE_NODE` | 0G storage node RPC endpoint |
| N/A (new) | `ZEROG_CHAIN_RPC` | 0G chain RPC (for on-chain contract) |
| N/A (new) | `ZEROG_CONTRACT_ADDRESS` | Your deployed 0G mainnet contract |

### Priority 6: On-Chain 0G Contract (NEW — required for submission)

Deploy a simple Solidity contract on **0G mainnet** that logs storage events:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GhostAgentStorageLog {
    event DataStored(string indexed agentName, bytes32 rootHash, uint256 timestamp);

    mapping(string => bytes32) public latestRoot;

    function logStorage(string calldata agentName, bytes32 rootHash) external {
        latestRoot[agentName] = rootHash;
        emit DataStored(agentName, rootHash, block.timestamp);
    }
}
```

This gives us the required 0G Explorer link with verifiable on-chain activity.

### Priority 7: .0g Name Service — Verified Collection (Agent ID component)

0G has its own name service (`.0g` TLD) built by **SpaceID**. Instead of building a
new registrar, we add `.0g` as a **verified collection** — same pattern as Chonk NFTs.

This gives us a **second 0G component** (Agent ID) alongside Storage, which
significantly strengthens the submission.

**How it works**:
1. `.0g` names are ERC-721 tokens on 0G chain (SpaceID registry contract)
2. Add `.0g` to `WHITELISTED_COLLECTIONS` in the worker with 0G chain RPC
3. Holders of `name.0g` can molt into GhostAgent, getting `name_@nftmail.box`
4. Verification uses the same `ownerOf` pattern as Chonk

**Worker change** (`workers/nftmail-email-worker/src/index.ts`):
```ts
// In WHITELISTED_COLLECTIONS array (~line 385):
{
  assignedName: '0g',
  chainId: 16600,        // 0G mainnet chain ID — verify from docs
  contractAddress: '...', // SpaceID .0g registry — find on 0G Explorer
  rpcUrl: 'https://...',  // 0G mainnet RPC
  displayName: '0G Names (.0g)',
},
```

**Frontend changes**:
- Add `.0g` to the collection dropdown in the molt UI
- Add 0G chain logo/branding to the collection card
- SpaceID Web3 Name SDK (`@web3-name-sdk/core`) can resolve `.0g` names for display:
  ```ts
  import { createWeb3Name } from '@web3-name-sdk/core';
  const web3Name = createWeb3Name();
  // Resolve .0g name → address
  const addr = await web3Name.getAddress('ghostagent.0g');
  // Reverse resolve address → .0g name
  const name = await web3Name.getDomainName({ address: '0x...' });
  ```

**Next.js config** (`next.config.js`):
```js
// Add to transpilePackages:
transpilePackages: ['@web3-name-sdk/core'],
```

### Priority 8: ERC-6551 Token-Bound Accounts on 0G Chain

For `.0g` name holders to get full GhostAgent identity (not just an inbox alias),
we need ERC-6551 TBAs on 0G chain. This is a major value-add for the submission.

**Step 1: Check if ERC-6551 registry already exists on 0G chain**

The canonical ERC-6551 registry is deployed at the same address on all EVM chains:
```
0x000000006551c19487814612e58FE06813775758
```

Check if it exists on 0G mainnet:
```bash
cast code 0x000000006551c19487814612e58FE06813775758 --rpc-url <0G_MAINNET_RPC>
```

If it returns `0x` (empty), deploy it using the standard CREATE2 factory.
Reference: https://eips.ethereum.org/EIPS/eip-6551

**Step 2: Deploy a lightweight ERC-6551 Account implementation on 0G**

We already have `ERC6551Account.sol` in `src/`. Deploy it on 0G chain:
```bash
forge create src/ERC6551Account.sol:ERC6551Account \
  --rpc-url <0G_MAINNET_RPC> \
  --private-key <DEPLOYER_KEY>
```

**Step 3: Create TBAs for .0g name holders during molt**

When a `.0g` holder molts into GhostAgent:
1. Verify `.0g` name ownership via SpaceID `ownerOf`
2. Call ERC-6551 registry `createAccount()` on 0G chain with:
   - `implementation`: our deployed ERC6551Account address on 0G
   - `chainId`: 0G chain ID
   - `tokenContract`: SpaceID `.0g` registry contract
   - `tokenId`: the `.0g` name's token ID
3. The resulting TBA address is deterministic and unique to that `.0g` name
4. Store in worker KV: `tba:0g:{name}` → TBA address

**What this gives the submission**:
- "First ERC-6551 deployment on 0G chain" (if registry isn't already there)
- Native token-bound accounts for `.0g` identities
- Full agent body: `.0g` name → TBA wallet → encrypted inbox → 0G Storage beacon

**Narrative for submission**: "GhostAgent recognises .0g SpaceID names as
first-class agent identities. Holders of any .0g name can molt into the
GhostAgent protocol, receiving an ERC-6551 token-bound account on 0G chain,
an encrypted nftmail.box inbox, beacon metadata stored on 0G Storage, and a
verifiable on-chain identity record — the first sovereign agent identity
stack built natively on 0G infrastructure."

---

## 6. 0G SDK Quick Start

```bash
npm install @0glabs/0g-ts-sdk ethers
```

Key classes:
- `ZgFile` — create uploadable file objects
- `Indexer` — check file status, download
- `getFlowContract` — get the on-chain flow contract for uploads

Testnet endpoints (use for dev, switch to mainnet for submission):
- Check https://docs.0g.ai/ for current RPC + storage node URLs

Basic upload pattern:
```ts
import { ZgFile, Indexer, getFlowContract } from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(ZEROG_RPC);
const signer = new ethers.Wallet(ZEROG_PRIVATE_KEY, provider);
const flowContract = getFlowContract(ZEROG_FLOW_ADDRESS, signer);
const indexer = new Indexer(ZEROG_INDEXER_URL);

// Upload
const file = await ZgFile.fromBuffer(Buffer.from(jsonString));
const [tree, err] = await file.merkleTree();
const rootHash = tree.rootHash();
await flowContract.submit({ ...tree.submission() });
await indexer.upload(ZEROG_STORAGE_NODE, file);

// Download
const content = await indexer.download(rootHash, outputPath);
```

---

## 7. What NOT To Touch

- **Solidity contracts** on Gnosis/Base — leave as-is (ERC-8004, registrars, etc.)
- **Privy auth** — no change
- **Cloudflare KV inbox logic** — no change (KV stays, only the IPFS backup pin changes)
- **Gnosis Safe / ERC-6551 TBA** — no change
- **Story Protocol integration** — keep, just change where IPA metadata is stored
- **Mint flows** (gasless-mint, MintAgentBundle) — no change
- **UI components** — minimal changes (just gateway URL swaps)

---

## 8. Testing Checklist

After integration, verify these flows work end-to-end:

- [ ] Mint a `picoclaw.gno` agent → beacon metadata uploads to 0G
- [ ] `/api/genome-image?sld=nftmail&name=testname` → image uploads to 0G, returns valid URL
- [ ] `/api/beacon` POST → builds metadata, pins to 0G, stores CID in worker KV
- [ ] `/api/handshake` POST → handshake certificate pins to 0G
- [ ] `/api/erc8004/register` POST → registration JSON pins to 0G
- [ ] Agent card at `/api/agent-card?name=testname` → includes 0G gateway URL for staticCardCid
- [ ] Encrypted email received → blind envelope backed up to 0G (worker)
- [ ] 0G mainnet contract → `logStorage()` called, visible on 0G Explorer

---

## 9. Submission Deliverables

1. **GitHub repo** (Ghost-Agency org fork) — public or shared with judges
2. **0G mainnet contract address** + Explorer link
3. **Demo video** (≤3 min): show mint → email → 0G storage proof on explorer
4. **README** with:
   - Project overview (sovereign agent identity + encrypted email)
   - Architecture diagram showing 0G Storage replacing IPFS
   - Which 0G modules used (Storage + Chain)
   - Local deployment steps
   - Test instructions
5. **X post** with demo screenshot + required hashtags/tags

---

## 10. Architecture Diagram (for README)

```
┌─────────────────────────────────────────────────────────────┐
│                    ghostagent.ninja (Next.js)                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Mint Flow│  │ Beacon   │  │Handshake │  │ ERC-8004   │  │
│  │          │  │ Metadata │  │ Certs    │  │ Register   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │             │             │               │         │
│       └─────────────┴─────────────┴───────────────┘         │
│                          │                                  │
│              ┌───────────▼───────────┐                      │
│              │  zero-g-storage.ts    │  ◄── NEW ADAPTER     │
│              │  uploadToZeroG()      │                      │
│              │  zeroGGatewayUrl()    │                      │
│              └───────────┬───────────┘                      │
└──────────────────────────┼──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │      0G Storage         │  ◄── REPLACES LIGHTHOUSE
              │  (Decentralized DA)     │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │      0G Chain           │
              │  GhostAgentStorageLog   │  ◄── NEW CONTRACT
              │  (logs rootHash events) │
              └─────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│             Gnosis Chain (unchanged)                         │
│  ERC-8004 Registry · GNS Registrars · Safe · ERC-6551 TBA  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Worker (nftmail-email-worker)            │
│  KV Inbox · ECIES Encryption · Blind Storage                │
│  Email backup pin: web3.storage → 0G Storage                │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Security Notes

- **You do NOT have access to production env vars** — use your own 0G testnet/mainnet keys
- **Do NOT modify Gnosis/Base contracts** — on-chain identity stays on Gnosis
- **Do NOT touch Privy, Safe, or KV inbox logic** — only the storage pin layer
- **All 0G uploads are non-fatal** — wrap in try/catch, return null on failure (matches existing Lighthouse pattern)
- **Never commit private keys** — use `.env.local` and document in README

---

## 12. Estimated Hours

| Task | Hours |
|------|-------|
| 0G SDK setup + `zero-g-storage.ts` adapter | 3 |
| Replace Lighthouse uploads (6 API routes + 2 services) | 8 |
| Replace web3.storage in worker (2 call sites) | 2 |
| Gateway URL replacements (~10 files) | 2 |
| Deploy 0G mainnet contracts (StorageLog + ERC6551Account) | 3 |
| ERC-6551 registry check/deploy + TBA creation flow | 3 |
| .0g SpaceID verified collection (worker + molt UI) | 4 |
| README + architecture diagram + submission text | 3 |
| End-to-end testing | 2 |
| **Total** | **~30** |

---

## 13. 0G Components Used (for submission form)

| 0G Component | How We Use It |
|-------------|---------------|
| **0G Storage** | All agent metadata (beacons, genomes, handshakes, authorship, IP transfers, encrypted email backups) stored on 0G decentralised storage — replaces Lighthouse/IPFS |
| **0G Chain** | `GhostAgentStorageLog` contract logs every storage rootHash on-chain for verifiable provenance. ERC-6551 Account implementation deployed for `.0g` TBAs. |
| **Agent ID (.0g)** | SpaceID `.0g` names recognised as verified collection — holders molt into GhostAgent with ERC-6551 TBA on 0G chain, encrypted inbox, and beacon metadata on 0G Storage |
