/// @module cdr-vault
/// Confidential Data Rails (CDR) vault service for ghostagent.ninja.
///
/// Wraps `@piplabs/cdr-sdk` to provide:
///   - `encryptToVault` — AES-encrypts a payload, stores ciphertext via a
///     storage provider (Storacha/Filecoin), gates the AES key behind a
///     Story Protocol CDR vault with a license-based read condition.
///   - `decryptFromVault` — verifies caller holds the gating credential
///     (license token / NFT), collects threshold partial decryptions from
///     Story validators, recombines, and decrypts the payload locally.
///   - `getDkgState` — read-only diagnostics for DKG params + fees.
///
/// Architectural role: this is **Layer 3** of the three-layer confidential
/// IP stack (Attestation → Story IP asset → CDR vault). It is invoked by
/// `ip-minter.ts` when a caller passes a `cdrPayload` to `/api/gasless-ip-mint`,
/// and by `app/confidential/*` routes when a license-holder requests access.
///
/// Status: SCAFFOLD. SDK call sites are stubbed pending sandbox spike
/// validation (see `cdr-spike/` for the validation harness, and
/// `docs/cdr-spike-notes.md` for findings).
///
/// To activate:
///   1. `npm i @piplabs/cdr-sdk` in this workspace
///   2. Replace `STUB` blocks with real SDK calls
///   3. Add `CDR_*` env vars to `env.example`

import type { Hex } from 'viem';

// ─── Network configuration ───────────────────────────────────────────────────

export const CDR_NETWORK = (process.env.NEXT_PUBLIC_CDR_NETWORK ?? 'testnet') as
  | 'testnet'
  | 'mainnet';

export const CDR_RPC_URL =
  process.env.CDR_RPC_URL ??
  (CDR_NETWORK === 'mainnet'
    ? 'https://rpc.story.foundation'
    : 'https://aeneid.storyrpc.io');

/** Story-API REST endpoint for DKG state. Aeneid currently exposes
 *  validator-5 IP on plain HTTP; a TLS subdomain is being rolled out. */
export const CDR_API_URL =
  process.env.CDR_API_URL ??
  (CDR_NETWORK === 'mainnet'
    ? 'https://api.story.foundation'
    : 'http://172.192.41.96:1317');

/** System contract addresses — same on testnet and mainnet at time of writing. */
export const CDR_CONTRACTS = {
  dkg: '0xcccccc0000000000000000000000000000000004' as const,
  cdr: '0xcccccc0000000000000000000000000000000005' as const,
} as const;

/** Pre-deployed sample condition contracts on Aeneid (for early testing).
 *  Production should use our own `CreationIPCondition.sol`. */
export const CDR_SAMPLE_CONDITIONS_AENEID = {
  write: '0x4C9bFC96d7092b590D497A191826C3dA2277c34B' as const,
  read: '0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3' as const,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Where the encrypted payload bytes live. CDR only stores the key — the
 *  ciphertext is off-chain. */
export type CDRStorageBackend = 'storacha' | 'helia' | 'gateway' | 'synapse';

export interface CDRConditionConfig {
  /** Condition contract that gates writes (who can put new data in the vault). */
  writeConditionAddr: Hex;
  /** Condition contract that gates reads (who can decrypt). For
   *  `.creation.ip` assets this will be our `CreationIPCondition` which
   *  checks for a Story license token OR Chonk artist NFT ownership. */
  readConditionAddr: Hex;
  /** Per-vault data passed to the write condition (e.g. owner address bytes). */
  writeConditionData?: Hex;
  /** Per-vault data passed to the read condition (e.g. IP asset id). */
  readConditionData?: Hex;
  /** Aux data passed during access — typically `0x` for our use case. */
  accessAuxData?: Hex;
}

export interface CDRVaultRef {
  /** The on-chain UUID assigned by the CDR contract. */
  uuid: bigint;
  /** IPFS / Filecoin CID of the ciphertext (when storing files, not data keys). */
  dataCid?: string;
  /** Storage backend used. */
  backend: CDRStorageBackend;
  /** Chain ID this vault lives on (1315 = Aeneid). */
  chainId: number;
  /** Hex of the read condition contract — surfaced for UI. */
  readConditionAddr: Hex;
  /** Hex of the corresponding Paperclip attestation (Layer 1), if linked. */
  attestationHash?: Hex;
  /** Transaction hashes from allocate + write. */
  txHashes: {
    allocate?: Hex;
    write?: Hex;
  };
  /** When the vault was created (unix ms). */
  createdAt: number;
}

export interface ConfidentialPayload {
  /** The actual bytes to encrypt — audio master, training set, agent memory, etc. */
  content: Uint8Array;
  /** MIME type for downstream display (`audio/wav`, `application/json`, ...). */
  contentType: string;
  /** Human label for the vault (not encrypted, used in metadata only). */
  label: string;
}

export interface EncryptToVaultParams {
  payload: ConfidentialPayload;
  conditions: CDRConditionConfig;
  backend?: CDRStorageBackend; // default: 'storacha'
  /** Whether the vault should be re-writable. Default: false (immutable). */
  updatable?: boolean;
  /** Optional PaperclipAttestation hash to link Layer 1 ↔ Layer 3. */
  attestationHash?: Hex;
}

export interface DecryptFromVaultParams {
  vault: CDRVaultRef;
  /** secp256k1 private key bytes for the requester (ephemeral OK). */
  recipientPrivKey: Uint8Array;
  /** Timeout for collecting partial decryptions, ms. Default 120s. */
  timeoutMs?: number;
}

export interface DkgState {
  network: typeof CDR_NETWORK;
  apiUrl: string;
  threshold: number;
  operationalThreshold: number;
  globalPubKey: Hex;
  fees: {
    allocate: bigint;
    write: bigint;
    read: bigint;
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Read-only diagnostic. Safe to call without a wallet. Use in health checks. */
export async function getDkgState(): Promise<DkgState> {
  // STUB — replaced after Spike 01 confirms SDK works in this env.
  // Pseudocode:
  //   const { createPublicClient, http } = await import('viem');
  //   const { CDRClient } = await import('@piplabs/cdr-sdk');
  //   const publicClient = createPublicClient({ transport: http(CDR_RPC_URL) });
  //   const client = new CDRClient({ network: CDR_NETWORK, publicClient, apiUrl: CDR_API_URL });
  //   const [threshold, operationalThreshold, globalPubKey, allocate, write, read] =
  //     await Promise.all([
  //       client.observer.getThreshold(),
  //       client.observer.getOperationalThreshold(),
  //       client.observer.getGlobalPubKey(),
  //       client.observer.getAllocateFee(),
  //       client.observer.getWriteFee(),
  //       client.observer.getReadFee(),
  //     ]);
  //   return { network: CDR_NETWORK, apiUrl: CDR_API_URL, threshold, operationalThreshold, globalPubKey, fees: { allocate, write, read } };
  throw new Error('cdr-vault.getDkgState: pending Spike 01 — install @piplabs/cdr-sdk first');
}

/** Encrypt a payload and store it in a CDR vault.
 *
 *  Flow:
 *    1. AES-encrypt `payload.content` with a fresh 32-byte data key
 *    2. Upload ciphertext to `backend` (Storacha by default)
 *    3. Allocate vault on Story L1 + threshold-encrypt the AES key against
 *       DKG global pub key + write to vault, all under `conditions`
 *    4. Return `CDRVaultRef` for downstream linking (IPA metadata,
 *       attestation manifest, audit log)
 *
 *  NOTE: requires `process.env.CDR_OPERATOR_PRIVATE_KEY` for the relay account
 *  that pays gas + writes the vault. This is the same Safe treasury pattern as
 *  `gasless-ip-mint` — the operator signs, the IPA ownership stays with the TBA.
 */
export async function encryptToVault(
  _params: EncryptToVaultParams,
): Promise<CDRVaultRef> {
  // STUB — pending Spike 02 success.
  // Implementation outline:
  //   const dataKey = crypto.getRandomValues(new Uint8Array(32));
  //   const ciphertext = await aesGcmEncrypt(params.payload.content, dataKey);
  //   const { cid } = await uploadToStoracha(ciphertext); // or chosen backend
  //   await initWasm();
  //   const client = await buildOperatorClient();
  //   const globalPubKey = await client.observer.getGlobalPubKey();
  //   const { uuid, txHashes } = await client.uploader.uploadCDR({
  //     dataKey,
  //     globalPubKey,
  //     updatable: params.updatable ?? false,
  //     writeConditionAddr: params.conditions.writeConditionAddr,
  //     readConditionAddr: params.conditions.readConditionAddr,
  //     writeConditionData: params.conditions.writeConditionData ?? '0x',
  //     readConditionData: params.conditions.readConditionData ?? '0x',
  //     accessAuxData: params.conditions.accessAuxData ?? '0x',
  //   });
  //   return {
  //     uuid,
  //     dataCid: cid,
  //     backend: params.backend ?? 'storacha',
  //     chainId: CDR_NETWORK === 'mainnet' ? 1514 : 1315,
  //     readConditionAddr: params.conditions.readConditionAddr,
  //     attestationHash: params.attestationHash,
  //     txHashes,
  //     createdAt: Date.now(),
  //   };
  throw new Error('cdr-vault.encryptToVault: pending Spike 02 — install @piplabs/cdr-sdk first');
}

/** Access + decrypt a payload from a CDR vault.
 *
 *  The caller must already hold whatever credential `readConditionAddr`
 *  enforces (Story license token, Chonk NFT, custom). The SDK auto-collects
 *  partial decryptions from validators and recombines via TDH2.
 */
export async function decryptFromVault(
  _params: DecryptFromVaultParams,
): Promise<{ content: Uint8Array; contentType: string }> {
  // STUB — pending Spike 02 success.
  // Implementation outline:
  //   await initWasm();
  //   const client = await buildReadClient(); // wallet not strictly required for read
  //   const globalPubKey = await client.observer.getGlobalPubKey();
  //   const threshold = await client.observer.getThreshold();
  //   const requesterPubKey = toHex(secp256k1.getPublicKey(params.recipientPrivKey, false));
  //   const { dataKey } = await client.consumer.accessCDR({
  //     uuid: params.vault.uuid,
  //     accessAuxData: '0x',
  //     requesterPubKey,
  //     recipientPrivKey: params.recipientPrivKey,
  //     globalPubKey,
  //     threshold,
  //     timeoutMs: params.timeoutMs ?? 120_000,
  //   });
  //   const ciphertext = await fetchFromStorage(params.vault.backend, params.vault.dataCid!);
  //   const plaintext = await aesGcmDecrypt(ciphertext, dataKey);
  //   return { content: plaintext, contentType: 'application/octet-stream' };
  throw new Error('cdr-vault.decryptFromVault: pending Spike 02 — install @piplabs/cdr-sdk first');
}

/** Compose IPA metadata block that links a Story `.creation.ip` asset
 *  to its CDR vault. Embedded in the `aiMetadata` field on Lighthouse and
 *  surfaced via `/api/agent-card/[name]`. */
export function buildIpaConfidentialBlock(vault: CDRVaultRef) {
  return {
    confidential: {
      vaultUuid: vault.uuid.toString(),
      readConditionAddr: vault.readConditionAddr,
      dataCid: vault.dataCid ?? null,
      backend: vault.backend,
      chainId: vault.chainId,
      attestationHash: vault.attestationHash ?? null,
      createdAt: vault.createdAt,
    },
  } as const;
}
