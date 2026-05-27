/// @module cdr-vault
/// Confidential Data Rails (CDR) vault service for ghostagent.ninja.
///
/// Wraps `@piplabs/cdr-sdk` (Story Aeneid / mainnet) with two flows validated
/// against the live testnet (see `cdr-spike/` and `docs/cdr-spike-notes.md`):
///
///   1. **Owner-only** — small secret, EOA-gated read.
///      Use case: private agent memory, deployer-only configs.
///      Pattern: `OwnerWriteCondition` + EOA read condition (no contract).
///
///   2. **License-gated** — Story IP license token gates the read.
///      Use case: PureBPM stems, paywalled creative IP.
///      Pattern: `OwnerWriteCondition` + `LicenseReadCondition` with
///      `(licenseTokenContract, ipId)` ABI-encoded as `readConditionData`,
///      and the consumer's `licenseTokenId` ABI-encoded as `accessAuxData`.
///
/// Layer in the confidential IP stack:
///   Layer 1 — Paperclip attestation (legal evidence, on-chain hash)
///   Layer 2 — Story IP asset (provenance, royalty terms)
///   Layer 3 — CDR vault (cryptographic enforcement) ← this module
///
/// Operator-relay model: writes are signed by `CDR_OPERATOR_PRIVATE_KEY`
/// (same Safe-treasury pattern as `gasless-ip-mint.ts`). Reads can be done by
/// any wallet that satisfies the read condition.

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  toHex,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CDRClient,
  initWasm,
  uuidToLabel,
  type StorageProvider,
} from '@piplabs/cdr-sdk';

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

/** System contract addresses (same on testnet + mainnet at time of writing). */
export const CDR_CONTRACTS = {
  dkg: '0xcccccc0000000000000000000000000000000004' as const,
  cdr: '0xcccccc0000000000000000000000000000000005' as const,
} as const;

/** Pre-deployed condition contracts on Aeneid. Reusable — gated by
 *  `writeConditionData` / `readConditionData` rather than per-deployment. */
export const CDR_CONDITIONS_AENEID = {
  /** OwnerWriteCondition — `writeConditionData` = abi.encode(address owner). */
  ownerWrite: '0x4C9bFC96d7092b590D497A191826C3dA2277c34B' as const,
  /** LicenseReadCondition — `readConditionData` = abi.encode(address licenseToken, address ipId). */
  licenseRead: '0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3' as const,
  /** Aeneid LicenseToken ERC-721. */
  licenseToken: '0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC' as const,
  /** Story RoyaltyModule (used by license mint to collect royalties). */
  royaltyModule: '0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086' as const,
} as const;

export const CDR_CHAIN_ID = CDR_NETWORK === 'mainnet' ? 1514 : 1315;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Where the encrypted payload bytes live. CDR only stores the AES key — the
 *  ciphertext is off-chain (or inline for small data keys). */
export type CDRStorageBackend = 'inline' | 'storacha' | 'helia' | 'gateway' | 'synapse';

export interface CDRVaultRef {
  /** The on-chain UUID assigned by the CDR contract (uint32). */
  uuid: number;
  /** Storage backend used. `inline` means the secret is stored directly in the vault. */
  backend: CDRStorageBackend;
  /** Storage-provider id (CID, path, etc.) of the off-chain ciphertext.
   *  Only set when `backend !== 'inline'`. */
  dataCid?: string;
  /** Chain ID this vault lives on. */
  chainId: number;
  /** Read condition contract address — surfaced for UI / debugging. */
  readConditionAddr: Hex;
  /** ABI-encoded read condition data (e.g. licenseToken+ipId for license-gated). */
  readConditionData: Hex;
  /** Optional Paperclip attestation hash to link Layer 1 ↔ Layer 3. */
  attestationHash?: Hex;
  /** Transaction hashes from allocate + write. */
  txHashes: {
    allocate?: Hex;
    write?: Hex;
  };
  /** Unix ms when the vault was created. */
  createdAt: number;
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

// ─── Singleton client (read-only) ────────────────────────────────────────────

let _readClient: { client: CDRClient; publicClient: PublicClient } | null = null;
let _wasmReady = false;

async function ensureWasm(): Promise<void> {
  if (_wasmReady) return;
  await initWasm();
  _wasmReady = true;
}

function getReadClient(): { client: CDRClient; publicClient: PublicClient } {
  if (_readClient) return _readClient;
  const publicClient = createPublicClient({ transport: http(CDR_RPC_URL) }) as PublicClient;
  const client = new CDRClient({
    network: CDR_NETWORK,
    publicClient,
    apiUrl: CDR_API_URL,
  });
  _readClient = { client, publicClient };
  return _readClient;
}

function getOperatorClient(privateKey: Hex): {
  client: CDRClient;
  publicClient: PublicClient;
  walletClient: WalletClient;
  ownerAddress: Hex;
} {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ transport: http(CDR_RPC_URL) }) as PublicClient;
  const walletClient = createWalletClient({ account, transport: http(CDR_RPC_URL) });
  const client = new CDRClient({
    network: CDR_NETWORK,
    publicClient,
    walletClient,
    apiUrl: CDR_API_URL,
  });
  return { client, publicClient, walletClient, ownerAddress: account.address };
}

function resolveOperatorKey(override?: Hex): Hex {
  const key = (override ?? process.env.CDR_OPERATOR_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY) as Hex | undefined;
  if (!key || !key.startsWith('0x') || key.length !== 66) {
    throw new Error('cdr-vault: CDR_OPERATOR_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY) is required for write/read txs');
  }
  return key;
}

// ─── Condition helpers ───────────────────────────────────────────────────────

/** Owner-only conditions: only `owner` can write, only `owner` can read.
 *  Read condition is the EOA itself (no contract) — CDR precompile gates by
 *  exact caller. Use for private agent memory / deployer-only configs. */
export function ownerOnlyConditions(owner: Hex) {
  return {
    writeConditionAddr: CDR_CONDITIONS_AENEID.ownerWrite,
    writeConditionData: encodeAbiParameters([{ type: 'address' }], [owner]),
    readConditionAddr: owner,
    readConditionData: '0x' as Hex,
    /** EOA reads need this — SDK preflight rejects EOAs since they don't
     *  implement the condition contract interface, but the on-chain CDR
     *  precompile accepts them. */
    skipConditionValidation: true as const,
  };
}

/** License-gated conditions: `owner` can write, anyone holding a valid Story
 *  license token for `ipId` can read. Use for PureBPM stems, paywalled IP. */
export function licenseGatedConditions(owner: Hex, ipId: Hex) {
  return {
    writeConditionAddr: CDR_CONDITIONS_AENEID.ownerWrite,
    writeConditionData: encodeAbiParameters([{ type: 'address' }], [owner]),
    readConditionAddr: CDR_CONDITIONS_AENEID.licenseRead,
    readConditionData: encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      [CDR_CONDITIONS_AENEID.licenseToken, ipId],
    ),
    skipConditionValidation: false as const,
  };
}

/** Encode `accessAuxData` for a license-gated read.
 *  The reader must own `licenseTokenId` of the LicenseToken contract. */
export function licenseAccessAuxData(licenseTokenIds: bigint[]): Hex {
  return encodeAbiParameters([{ type: 'uint256[]' }], [licenseTokenIds]);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Read-only diagnostic. Safe to call without a wallet. Use in `/api/health`. */
export async function getDkgState(): Promise<DkgState> {
  const { client } = getReadClient();
  const [threshold, operationalThreshold, globalPubKey, allocate, write, read] = await Promise.all([
    client.observer.getThreshold(),
    client.observer.getOperationalThreshold(),
    client.observer.getGlobalPubKey(),
    client.observer.getAllocateFee(),
    client.observer.getWriteFee(),
    client.observer.getReadFee(),
  ]);
  return {
    network: CDR_NETWORK,
    apiUrl: CDR_API_URL,
    threshold,
    operationalThreshold: Number(operationalThreshold),
    globalPubKey: toHex(globalPubKey),
    fees: { allocate, write, read },
  };
}

// ─── Encrypt: small data key, owner-only, inline ────────────────────────────

export interface EncryptDataKeyParams {
  /** The secret to encrypt — keep it small (< ~250 bytes after ABI overhead). */
  dataKey: Uint8Array;
  /** Override the operator private key (defaults to env). */
  operatorPrivateKey?: Hex;
  /** Whether the vault should be re-writable. Default: false. */
  updatable?: boolean;
  /** Optional Paperclip attestation hash to link Layer 1 ↔ Layer 3. */
  attestationHash?: Hex;
}

/** Encrypt a small secret to an owner-gated CDR vault.
 *  Only the operator wallet can write; only the operator wallet can read. */
export async function encryptDataKeyOwnerOnly(
  params: EncryptDataKeyParams,
): Promise<CDRVaultRef> {
  await ensureWasm();
  const operatorKey = resolveOperatorKey(params.operatorPrivateKey);
  const { client, ownerAddress } = getOperatorClient(operatorKey);

  const conditions = ownerOnlyConditions(ownerAddress);
  const globalPubKey = await client.observer.getGlobalPubKey();

  const { uuid, txHash: allocateTx } = await client.uploader.allocate({
    updatable: params.updatable ?? false,
    writeConditionAddr: conditions.writeConditionAddr,
    writeConditionData: conditions.writeConditionData,
    readConditionAddr: conditions.readConditionAddr,
    readConditionData: conditions.readConditionData,
    skipConditionValidation: conditions.skipConditionValidation,
  });

  const ciphertext = await client.uploader.encryptDataKey({
    dataKey: params.dataKey,
    globalPubKey,
    label: uuidToLabel(uuid),
  });

  const { txHash: writeTx } = await client.uploader.write({
    uuid,
    accessAuxData: '0x',
    encryptedData: toHex(ciphertext.raw),
  });

  return {
    uuid,
    backend: 'inline',
    chainId: CDR_CHAIN_ID,
    readConditionAddr: conditions.readConditionAddr,
    readConditionData: conditions.readConditionData,
    attestationHash: params.attestationHash,
    txHashes: { allocate: allocateTx as Hex, write: writeTx as Hex },
    createdAt: Date.now(),
  };
}

// ─── Encrypt: file, license-gated, off-chain storage ────────────────────────

export interface EncryptFileParams {
  /** Raw file bytes — AES-encrypted locally before upload. */
  content: Uint8Array;
  /** Story IP asset id that gates the read. Holders of a license token for
   *  this `ipId` will be able to decrypt. */
  ipId: Hex;
  /** Storage provider — Storacha / Synapse / Helia / custom. The SDK uses
   *  duck typing: anything implementing `upload(bytes) -> id` and
   *  `download(id) -> bytes` works. */
  storageProvider: StorageProvider;
  /** Tag used in the SDK's storage-provider metadata. */
  backend: CDRStorageBackend;
  /** Override the operator private key (defaults to env). */
  operatorPrivateKey?: Hex;
  /** Whether the vault should be re-writable. Default: false. */
  updatable?: boolean;
  /** Optional Paperclip attestation hash to link Layer 1 ↔ Layer 3. */
  attestationHash?: Hex;
}

/** Encrypt a file payload such that anyone holding a Story license token for
 *  `ipId` can decrypt it. The file is AES-encrypted locally; ciphertext lives
 *  in `storageProvider`; the AES key + storage CID is gated by CDR. */
export async function encryptFileLicenseGated(
  params: EncryptFileParams,
): Promise<CDRVaultRef> {
  await ensureWasm();
  const operatorKey = resolveOperatorKey(params.operatorPrivateKey);
  const { client, ownerAddress } = getOperatorClient(operatorKey);

  const conditions = licenseGatedConditions(ownerAddress, params.ipId);

  // Use the high-level uploadFile flow: SDK handles AES encryption, off-chain
  // upload, and on-chain CDR write of the (cid + AES key) tuple.
  const result = await client.uploader.uploadFile({
    content: params.content,
    storageProvider: params.storageProvider,
    updatable: params.updatable ?? false,
    writeConditionAddr: conditions.writeConditionAddr,
    writeConditionData: conditions.writeConditionData,
    readConditionAddr: conditions.readConditionAddr,
    readConditionData: conditions.readConditionData,
    accessAuxData: '0x',
  });

  return {
    uuid: result.uuid,
    backend: params.backend,
    dataCid: result.cid,
    chainId: CDR_CHAIN_ID,
    readConditionAddr: conditions.readConditionAddr,
    readConditionData: conditions.readConditionData,
    attestationHash: params.attestationHash,
    txHashes: {
      allocate: result.txHashes.allocate,
      write: result.txHashes.write,
    },
    createdAt: Date.now(),
  };
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

export interface DecryptDataKeyParams {
  vault: Pick<CDRVaultRef, 'uuid'>;
  /** Override the reader private key (defaults to env). */
  readerPrivateKey?: Hex;
  /** Timeout for collecting partial decryptions, ms. Default 120s. */
  timeoutMs?: number;
}

/** Decrypt a small data-key vault (owner-only, inline). The reader wallet must
 *  match the EOA that was set as `readConditionAddr` at allocation time. */
export async function decryptDataKey(params: DecryptDataKeyParams): Promise<Uint8Array> {
  await ensureWasm();
  const readerKey = resolveOperatorKey(params.readerPrivateKey);
  const { client } = getOperatorClient(readerKey);

  const { dataKey } = await client.consumer.accessCDR({
    uuid: params.vault.uuid,
    accessAuxData: '0x',
    timeoutMs: params.timeoutMs ?? 120_000,
  });
  return dataKey;
}

export interface DecryptFileParams {
  vault: Pick<CDRVaultRef, 'uuid'>;
  /** License token id(s) the reader holds for the gating IP asset. */
  licenseTokenIds: bigint[];
  /** Storage provider — must be the same backend used at upload time. */
  storageProvider: StorageProvider;
  /** Override the reader private key (defaults to env). */
  readerPrivateKey?: Hex;
  /** Timeout for collecting partial decryptions, ms. Default 120s. */
  timeoutMs?: number;
}

/** Decrypt a license-gated file vault. The reader must hold one of
 *  `licenseTokenIds` for the IP asset that gated the vault. */
export async function decryptFileLicenseGated(
  params: DecryptFileParams,
): Promise<{ content: Uint8Array; txHash?: Hex }> {
  await ensureWasm();
  const readerKey = resolveOperatorKey(params.readerPrivateKey);
  const { client } = getOperatorClient(readerKey);

  const accessAuxData = licenseAccessAuxData(params.licenseTokenIds);

  const { content, txHash } = await client.consumer.downloadFile({
    uuid: params.vault.uuid,
    accessAuxData,
    storageProvider: params.storageProvider,
    timeoutMs: params.timeoutMs ?? 120_000,
  });
  return { content, txHash };
}

// ─── IPA metadata helper ─────────────────────────────────────────────────────

/** Compose the IPA `confidential` block that links a Story IP asset to its
 *  CDR vault. Embedded in the `aiMetadata` field on Lighthouse and surfaced
 *  via `/api/agent-card/[name]`. */
export function buildIpaConfidentialBlock(vault: CDRVaultRef) {
  return {
    confidential: {
      vaultUuid: vault.uuid.toString(),
      readConditionAddr: vault.readConditionAddr,
      readConditionData: vault.readConditionData,
      dataCid: vault.dataCid ?? null,
      backend: vault.backend,
      chainId: vault.chainId,
      attestationHash: vault.attestationHash ?? null,
      createdAt: vault.createdAt,
    },
  } as const;
}
