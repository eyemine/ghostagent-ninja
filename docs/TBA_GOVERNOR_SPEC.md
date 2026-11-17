# Agent Safe Governance: Canonical ERC-6551 + Beacon Governor Spec

Status: draft for review (v0.1, 2026-11-17)
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
  `ensCheck.tsx`/`check-ens` (nftmail.box).
- **Safe removal of an owner only happens after the replacement is proven** — a TBA or
  controller that cannot sign brick-walls the Safe. (The 359-byte stub proves why.)

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

## Open questions for review

1. Guardian's `tokenboundSafe` owner (`0x781b6A527482828bB04F33563797d4b696ddF328`) controls
   trusted-implementation upgrades for all V3 accounts — fine for us, just know the trust edge.
2. Beacon governor: does `rebind` need a timelock/dispute window, or is
   freeze-on-divergence + rebind sufficient?
3. Do paired agents get a per-agent `controller` EOA recorded, or is the Safe's owner set
   exactly `{TBA}`? (Recommend: TBA sole owner after step 5; controller lives inside the
   governor module, not as a second Safe owner.)
4. Should the governor module be a Safe *module* (can exec without signatures) or a Safe
   *owner* (needs sig path)? Module is cleaner for freeze/rebind; owner is simpler to audit.
