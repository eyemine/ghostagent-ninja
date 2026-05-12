/// @module ghost-arweave-manifest
/// Ghost Tier Eternal Archive — Arweave Manifest Builder
///
/// For the 200 xDAI lifetime fee, the molt.gno auditor agent creates an
/// Arweave manifest that permanently organises the agent's life history.
///
/// Manifest structure (all paths relative to the Arweave manifest root):
///   /identity/anchor.json      — Sovereign identity anchor (ERC-8004 agentId, SBT, Safe)
///   /history/log-YYYY-QN.jsonl — Encrypted execution traces, one file per quarter
///   /config/brain.json         — Local dependency map (models, MCP servers, system prompts)
///   /attestations/index.json   — Paperclip TEE proof index
///   /manifest.json             — This manifest (self-referential after upload)
///
/// The arweaveUri stored in the SBT metadata points to the manifest root.
/// All individual files are uploaded separately and referenced by txId.

import { uploadToArweave, type ArweaveUploadResult } from './arweave-upload';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GhostIdentityAnchor {
  schema:        'ghost:identity-anchor:v1';
  agentName:     string;          // e.g. "alice.vault.gno"
  agentId:       number;          // ERC-8004 tokenId
  safeAddress:   string;          // Gnosis Safe address
  sbtTokenId:    string;          // ERC-5192 SBT token ID (if activated)
  chainId:       number;          // 100 = Gnosis mainnet
  identityRegistry: string;       // ERC-8004 Identity Registry address
  reputationRegistry: string;
  sovereignKycHash?: string;      // keccak256 of off-chain KYC proof (optional)
  createdAt:     number;          // unix ms — immutable after first upload
  arweaveUri?:   string;          // self-reference, set after manifest upload
}

export interface GhostBrainConfig {
  schema:      'ghost:brain-config:v1';
  agentName:   string;
  llm:         string;            // e.g. "Ollama/llama3.2:3b"
  mcpServers:  string[];
  capabilities: string[];
  systemPromptHash?: string;      // keccak256 of system prompt (not stored plaintext)
  localDependencies: {
    name:    string;
    type:    'model' | 'mcp-server' | 'python-script' | 'docker-container' | 'other';
    version?: string;
    hash?:   string;
  }[];
  updatedAt:   number;            // unix ms — new version uploaded on each brain update
}

export interface GhostExecutionTrace {
  traceId:     string;
  agentName:   string;
  taskId:      string;
  timestamp:   number;            // unix ms
  proofHash?:  string;            // Paperclip attestation proofHash
  encryptedPayload: string;       // AES-GCM encrypted task result (key held by owner)
  metadataHash: string;           // keccak256 of plaintext for integrity
}

export interface GhostAttestationIndex {
  schema:    'ghost:attestation-index:v1';
  agentName: string;
  entries:   {
    proofHash:   string;
    taskId:      string;
    timestamp:   number;
    notaUrl:     string;
    arweaveTxId?: string;
  }[];
  updatedAt: number;
}

export interface GhostManifest {
  schema:    'ghost:eternal-archive:v1';
  agentName: string;
  agentId:   number;
  safeAddress: string;
  version:   number;              // incremented on each manifest update
  createdAt: number;
  updatedAt: number;
  paths: {
    identity:     string;         // arweave txId for /identity/anchor.json
    brain:        string;         // arweave txId for /config/brain.json
    attestations: string;         // arweave txId for /attestations/index.json
    historyIndex: string[];       // arweave txIds for /history/log-*.jsonl (ordered newest first)
  };
  arweaveUri?: string;            // self-reference — set after this manifest is uploaded
}

// ─── Quarter label helper ─────────────────────────────────────────────────────

function quarterLabel(ts = Date.now()): string {
  const d = new Date(ts);
  const q = Math.ceil((d.getUTCMonth() + 1) / 3);
  return `${d.getUTCFullYear()}-Q${q}`;
}

// ─── Arweave tags ─────────────────────────────────────────────────────────────

function ghostTags(agentName: string, fileType: string) {
  return [
    { name: 'App-Name',    value: 'GhostAgent' },
    { name: 'App-Version', value: '1.0-ghost' },
    { name: 'Agent-Name',  value: agentName },
    { name: 'File-Type',   value: fileType },
    { name: 'Timestamp',   value: String(Date.now()) },
  ];
}

// ─── Individual file uploaders ────────────────────────────────────────────────

/** Upload /identity/anchor.json */
export async function uploadIdentityAnchor(
  anchor: GhostIdentityAnchor,
): Promise<ArweaveUploadResult> {
  return uploadToArweave(anchor, {
    tags: ghostTags(anchor.agentName, 'identity-anchor'),
  });
}

/** Upload /config/brain.json */
export async function uploadBrainConfig(
  brain: GhostBrainConfig,
): Promise<ArweaveUploadResult> {
  return uploadToArweave(brain, {
    tags: ghostTags(brain.agentName, 'brain-config'),
  });
}

/** Upload /attestations/index.json */
export async function uploadAttestationIndex(
  index: GhostAttestationIndex,
): Promise<ArweaveUploadResult> {
  return uploadToArweave(index, {
    tags: ghostTags(index.agentName, 'attestation-index'),
  });
}

/** Upload a quarterly history log as JSONL */
export async function uploadHistoryLog(
  agentName: string,
  traces: GhostExecutionTrace[],
  quarter?: string,
): Promise<ArweaveUploadResult> {
  const label = quarter ?? quarterLabel();
  const jsonl = traces.map(t => JSON.stringify(t)).join('\n');
  return uploadToArweave(jsonl, {
    contentType: 'application/jsonl',
    tags: [
      ...ghostTags(agentName, 'history-log'),
      { name: 'Quarter', value: label },
    ],
  });
}

/** Upload the manifest itself (final step — references all other txIds) */
export async function uploadGhostManifest(
  manifest: GhostManifest,
): Promise<ArweaveUploadResult> {
  return uploadToArweave(manifest, {
    tags: ghostTags(manifest.agentName, 'eternal-archive-manifest'),
  });
}

// ─── Full archive initialisation ─────────────────────────────────────────────

export interface ArchiveInitParams {
  agentName:   string;
  agentId:     number;
  safeAddress: string;
  sbtTokenId:  string;
  chainId?:    number;
  identityRegistry?:   string;
  reputationRegistry?: string;
  llm:         string;
  mcpServers:  string[];
  capabilities?: string[];
  localDependencies?: GhostBrainConfig['localDependencies'];
  sovereignKycHash?: string;
}

export interface ArchiveInitResult {
  ok:            boolean;
  manifestTxId?: string;
  manifestUrl?:  string;
  identityTxId?: string;
  brainTxId?:    string;
  attestationsTxId?: string;
  error?:        string;
}

/**
 * Initialise a Ghost Eternal Archive from scratch.
 * Uploads identity anchor + brain config + empty attestation index,
 * then assembles and uploads the manifest.
 *
 * Called once when an premium agent upgrades to ghost tier.
 * Returns the manifest arweave URL to store in the SBT metadata.
 */
export async function initGhostEternalArchive(
  params: ArchiveInitParams,
): Promise<ArchiveInitResult> {
  const now = Date.now();

  const anchor: GhostIdentityAnchor = {
    schema:              'ghost:identity-anchor:v1',
    agentName:           params.agentName,
    agentId:             params.agentId,
    safeAddress:         params.safeAddress,
    sbtTokenId:          params.sbtTokenId,
    chainId:             params.chainId ?? 100,
    identityRegistry:    params.identityRegistry   ?? '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry:  params.reputationRegistry ?? '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    sovereignKycHash:    params.sovereignKycHash,
    createdAt:           now,
  };

  const brain: GhostBrainConfig = {
    schema:             'ghost:brain-config:v1',
    agentName:          params.agentName,
    llm:                params.llm,
    mcpServers:         params.mcpServers,
    capabilities:       params.capabilities ?? [],
    localDependencies:  params.localDependencies ?? [],
    updatedAt:          now,
  };

  const attestationIndex: GhostAttestationIndex = {
    schema:    'ghost:attestation-index:v1',
    agentName: params.agentName,
    entries:   [],
    updatedAt: now,
  };

  try {
    // Upload all 3 component files in parallel
    const [identityResult, brainResult, attestationsResult] = await Promise.all([
      uploadIdentityAnchor(anchor),
      uploadBrainConfig(brain),
      uploadAttestationIndex(attestationIndex),
    ]);

    const manifest: GhostManifest = {
      schema:      'ghost:eternal-archive:v1',
      agentName:   params.agentName,
      agentId:     params.agentId,
      safeAddress: params.safeAddress,
      version:     1,
      createdAt:   now,
      updatedAt:   now,
      paths: {
        identity:     identityResult.txId,
        brain:        brainResult.txId,
        attestations: attestationsResult.txId,
        historyIndex: [],
      },
    };

    const manifestResult = await uploadGhostManifest(manifest);

    return {
      ok:              true,
      manifestTxId:    manifestResult.txId,
      manifestUrl:     manifestResult.url,
      identityTxId:    identityResult.txId,
      brainTxId:       brainResult.txId,
      attestationsTxId: attestationsResult.txId,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Append a new Paperclip attestation to the eternal archive index.
 * Uploads a new attestation index file and returns the new txId.
 * The manifest itself is NOT updated here — call updateGhostManifest() separately.
 */
export async function appendAttestationToArchive(
  agentName: string,
  existing: GhostAttestationIndex,
  entry: GhostAttestationIndex['entries'][number],
): Promise<ArweaveUploadResult> {
  const updated: GhostAttestationIndex = {
    ...existing,
    entries:   [...existing.entries, entry],
    updatedAt: Date.now(),
  };
  return uploadAttestationIndex(updated);
}

/**
 * Build a GhostExecutionTrace from a Paperclip attestation bundle.
 * The resultPayload is NOT stored plaintext — the caller must encrypt it
 * before passing encryptedPayload.
 */
export function buildExecutionTrace(params: {
  agentName:        string;
  taskId:           string;
  proofHash:        string;
  encryptedPayload: string;
  metadataHash?:    string;
}): GhostExecutionTrace {
  return {
    traceId:          `trace-${Date.now()}-${params.proofHash.slice(2, 10)}`,
    agentName:        params.agentName,
    taskId:           params.taskId,
    timestamp:        Date.now(),
    proofHash:        params.proofHash,
    encryptedPayload: params.encryptedPayload,
    metadataHash:     params.metadataHash ?? params.proofHash,
  };
}
