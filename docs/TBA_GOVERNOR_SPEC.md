# Agent Safe Governance: Canonical ERC-6551 + Beacon Governor Spec

Status: v0.2 — provisioning pipeline shipped and proven on production (2026-11-17)
Scope: 14 agent identities, 11 existing Safes + 2 pending (chonk676, super.normie)

## 1. Canonical Tokenbound V3 on Gnosis — DEPLOYED 2026-11-17

Deployed permissionlessly via the CREATE2 factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`
(salt `0x6551…51`, deploy tx payloads from tokenbound/v3-deployer). **Byte-identical addresses
to Ethereum mainnet.** Deployer: `0x1c63C3d9d211641e15cd3aF46De76b4bc84CC382`.

| Contract | Address | Deploy tx |
|---|---|---|
| ERC-6551 Registry | `0x000000006551c19487814612e58FE06813775758` | (pre-existing, 571 B) |
| Authenticated Multicall | `0xcA1167915584462449EE5b4Ea51c37fE81eCDCCD` | `0x24d9d54d5565d9006f6c27e31ec8c0dabdb0be2a2aba71b9be1b5715616be3e1` |
| V3 Account Guardian | `0x2FE5ccb0d7Ea195FEb87987d3573F9fcCE2b5D57` | `0x1dfd1fb08110c51daf3a341c70e51606565b418270bef247d45237e7765fcff4` |
| V3 Implementation | `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC` | `0xabd5fd6c5715abe57616f76597129fe2e68b9dd74369ae3b712d23934e1490d2` |
| V3 AccountProxy | `0x55266d75D1a14E4572138116aF39863Ed6596E7F` | `0x83e8bacc70b17cf759b9ec335889c2b6f74456bb8f56de64dd2350e26c87f8fb` |
| LayerZero V2 Executor | `0x0F220412Bf22E05EBcC5070D60fd7136A08aF22C` | `0x542c91e4d02d891333df4cc7b758bb4ef5b0e78d84a340015de6e0c9545e35ef` |

**Use `0x55266d75D1a14E4572138116aF39863Ed6596E7F` (AccountProxy) as the `implementation`
parameter to `registry.createAccount` — NOT the V3 impl and NOT either legacy address:**

- `0x55266d75d1A14894141022060384218151591515` — corrupted copy of the proxy address
  (in `script/RedeploySLDRegistrars.s.sol:22`), no code exists.
- `0x878E703A93b6e0aaD92f9907332c68fb09765697` — 359-byte stub, cannot execute or sign
  (in `app/utils/chains.ts` as fallback; still referenced by `gnosis-tba.ts`).

**After `createAccount`, call `initialize(0x41C8f39463A868d3A88af00cd0fe7102F30E44eC)` on the
TBA.** The AccountProxy has no immutable fallback — an uninitialized account delegates to
`address(0)` and *silently returns empty data* for every call (the exact failure mode that
hid the broken stubs). Pass the canonical impl directly; guardian's trusted-implementation
check only runs for non-default impls.

## 2. Verified working reference TBA

`0xa26e1d2cCB1B9F9A6EfC54B87B340B5D0C7b415b` — created via canonical registry for
`openclaw.gno #1` (`0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe`, salt 0, chainId 100).

- `token()` → `(100, 0xbD8285…, 1)` correct binding
- `owner()` → `0xf251…` resolves live NFT owner
- `isValidSignature` → `0x0` for non-owner sig (positive case needs NFT-owner key)
- createAccount tx `0x6e1a76c6…`, initialize tx `0x5ea58dad…`

notapaperclip.red verifies the same facts independently (safe-governance.ts now reads
owners/threshold from the Safe contract and classifies TBA health from bytecode).

## 3. Two paths by NFT home chain

### 3a. Gnosis-native `.gno` identity NFTs — direct TBA governance

`openclaw.gno`, `molt.gno`, `nftmail.gno` tokens live on Gnosis. A V3 TBA bound to the NFT
reads `owner()` on-chain — transfer the NFT, control moves with it. Flow:

1. `createAccount(V3_PROXY, salt=0, chainId=100, registrar, tokenId)`
2. `TBA.initialize(V3_IMPL)`
3. Add TBA as Safe owner (`addOwnerWithThreshold`, keep threshold)
4. Prove liveness: NFT owner calls `TBA.execute(safe, 0, addOwnerCalldata, 0)` — or the Safe
   validates an EIP-1271 sig from the TBA signed by the NFT owner
5. Only after (4) succeeds: remove `0xf251…` / ghostagent.eth signer

### 3b. Cross-chain BYO NFTs (Chonk@Base, POW/ENS@Ethereum) — beacon governor

A Gnosis contract can never read an Ethereum/Base NFT owner. So "pair your NFT" means:
the source NFT is verified once, then a **Gnosis-side beacon NFT** represents it. The
beacon's TBA governs the Safe. The open problem the beacon governor module solves is
keeping beacon control in sync when the source NFT moves.

Design (proposed — needs review before Solidity):

- **Beacon = existing `.nftmail.gno` identity NFT** minted at pair time
  (`{type}.{tokenId}.nftmail.gno` or the ENS-label mint). One stable token per agent —
  do NOT burn/remint on source-NFT transfer; agent identity, email, Safe address,
  reputation and HOPR earnings must survive an NFT sale.
- **Governor module on the Safe** holds `controller[beaconId]` (an address with authority
  to act for the beacon) and a `frozen[beaconId]` flag.
- **rebind(proof)** sets `controller[beaconId] = newHolder` and clears `frozen` atomically.
  Proof phase A: EIP-712 attestation by our server after checking `ownerOf` on the source
  chain (trust-minimized, label it as such). Phase B: storage proof via Hashi — removes
  the trust assumption entirely (strong GIP talking point: Gnosis cross-chain infra
  verifying Ethereum NFT ownership).
- **freeze()** — anyone (watcher cron) can freeze a beacon when the source owner diverges
  from `controller`; prevents the seller draining the Safe between sale and buyer rebind.
- **ENS names** are keyed by namehash, not by ERC-721/1155 token — wrapping, unwrapping
  and ENSv2 migration leave the beacon stable. Ownership resolution uses the
  registry→NameWrapper hop now live in `delegate-verify.ts` (byo-molt) and
  `ensCheck.tsx`/`check-ens` (nftmail.box), plus the **ENSv2 ETHRegistry**
  (`0xf60aba43e1f7f3dab1186ff03b561401c9df85e2`, live on mainnet since Oct 27 2026).
  **ENSv2 token IDs are mutable** — regenerated on re-registration/role changes — so
  a TBA or KV record must never bind `(registry, tokenId)` for an ENSv2 name; use
  `getOwner(labelhash)` (`0xc41a360a`) for verification and store the label as the
  stable identity.
- **Safe removal of an owner only happens after the replacement is proven** — a TBA or
  controller that cannot sign brick-walls the Safe. (The 359-byte stub proves why.)

### 3c. Shipped: `.gno` key NFT → canonical TBA → Safe owner (2026-11-17)

The module governor in 3b is deferred. What shipped instead is simpler and was verified
end-to-end on a Gnosis fork (`scripts/verify-key-governance.cjs`, 10 assertions) and on
production (hopr1 recovery below):

- The BYO source NFT is a **pairing identity** — verified once at molt time against the
  exact `(contract, tokenId)` the client resolved (incl. ENSv2's registry). It does not
  govern on-chain; selling it does not move the agent. The UI now says this plainly.
- The agent's key is a **`.gno` key NFT minted to the verified owner's wallet** — held
  OUTSIDE the Safe it controls (a key held inside its own Safe is circular ownership and
  is now detected + flagged by the oracle).
- The key NFT's **canonical V3 TBA** (AccountProxy + `initialize(V3_IMPL)`, slot verified)
  is added as a Safe owner **alongside the key holder as recovery signer** (threshold 1).
- Execution is proven by simulating `TBA.execute → Safe.execTransaction` with the
  prevalidated contract signature (`r = TBA, v = 1`) — valid only when the TBA itself
  calls the Safe, so an EOA cannot forge it (asserted on the fork).
- The recovery signer is removed **through the TBA only**, after a real executed tx —
  not on provisioning. Status reports `governance: 'shared-recovery'` until then.
- Provisioning is idempotent: `findRecentKeyMint` reuses a label only while
  `ownerOf(tokenId)` still equals the requester; Safe CREATE2 prediction + owner-set
  verification make every step safe to retry with the same payment.
- **Cross-chain sync** (source NFT sold → key should follow) is still the open problem
  from 3b — `sourceNftTransferSync: false` is reported in the API response. The
  freeze/rebind governor module remains the design for that; do not pretend otherwise.

## 4. Retrofit program (dry-run first)

Population: 14 agents from `/api/agents` panel minus 4 picoclaw.gno + 4 fakenormie = the
14 listed in the audit. 11 distinct existing Safes (eyemine+ghostagent share `0xb7e4…`),
2 agents have no Safe (chonk676, super.normie → pair-your-NFT flow, no retrofit).

Order:
1. `chonk.588`-class single-agent Safes first (1-of-1, ghostagent.eth only)
2. victor — its TBA `0x56e7…` is already deployed but bound to the typo impl;
   needs a *new* TBA via the canonical proxy (old one is bound permanently to the bad impl)
3. `0xb7e4…` LAST — 7 modules, owns the HOPR Safe `0xcecff18a…` (which itself is being
   governed correctly via module `0x2b8c504d…` — untouched by this program)

Per-Safe sequence (each step independently verified on-chain + notapaperclip):
`createAccount → initialize → addOwner(TBA) → test exec via TBA → removeOwner(0xf251)`

## 5. Copy corrections (before any of this ships publicly)

- "Your NFT governs your agent" → currently: login-gated, not chain-governed.
  Accurate phrasing: "your NFT is your login; transfer-follows-NFT governance is rolling out"
- notapaperclip.red now says this correctly per-agent (governedBy verdict).

## 6. Production recovery — hopr1 (executed 2026-11-17)

First molt (old pipeline) bricked the Safe: `hopr1.agent.gno` #12 locked inside
`0xEEe8AC0c7db48476bDA0529140b3cf496d21647c` whose sole owner was the 359-byte stub TBA
`0x2598FAC1a5eAb3573d263F96A40117748698C732` — unrecoverable, no modules. Recovery used the
new pipeline with a fresh key name (the old label's NFT can never move):

| Component | Value | Tx |
|---|---|---|
| Key NFT | `hopr1.vault.gno` #2 → `0xf251…` (vault registrar `0xc6b1…`) | `0x7058ec39…` |
| Canonical TBA | `0x1D3a56EC96Ccc6CE6bbF59a6BBdEc2e6b6Bb7D64` | deploy `0x6c0c8c58…`, init `0xdfa736cc…` |
| Safe | `0x4ba1Dc282fbc1bea6Ee79fE485B01521BC23Da9C` — owners `[TBA, 0xf251…]` threshold 1 | — |
| Resolver | `setSafe(hopr1.vault.gno → Safe)` on `0xc97c7166…` | `0xf111dce8…` |

Verified on-chain after execution: `tba.token() = (100, 0xc6b1…, 2)`, `tba.owner() = 0xf251…`,
Safe owners correct, execution simulation passed. notapaperclip oracle independently reports
`governedBy: 'shared'` + `executionCheck: 'passed'` (was `tba-broken` + `cannot-sign` on the
old Safe). ERC-8004 agentId 4187 remains with treasury (same as all agents).

Recovery-signer removal is pending a signed tx from `0xf251…` through the TBA — after which
`governedBy` flips to `nft`. The bricked Safe + `hopr1.agent.gno` #12 stay on-chain forever;
the `tba:hopr1` KV record carries `supersedes` provenance.

## Open questions for review

1. Guardian's `tokenboundSafe` owner (`0x781b6A527482828bB04F33563797d4b696ddF328`) controls
   trusted-implementation upgrades for all V3 accounts — fine for us, just know the trust edge.
2. Beacon governor: does `rebind` need a timelock/dispute window, or is
   freeze-on-divergence + rebind sufficient?
3. ~~Owner vs module~~ — resolved by implementation: the key TBA is a Safe **owner** via the
   prevalidated signature path (proven on fork + production); the recovery EOA is a second
   owner until the holder removes it through the TBA. The governor *module* remains the
   design for cross-chain sync only, not for Safe ownership.
4. Should source-NFT transfer sync (3b) ever move the `.gno` key NFT automatically, or only
   flag divergence + freeze? Current stance: flag only — auto-moving the key would let a
   source-chain sale seize the agent.
