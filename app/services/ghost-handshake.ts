/// @module ghost-handshake
/// Ghost Tier Local-to-Swarm Identity Handshake
///
/// When a Ghost agent wakes up locally (Ollama / LM Studio / custom stack),
/// it must present a signed GhostHandshake to the A2A swarm router before
/// receiving routed traffic. The handshake proves:
///
///   1. The caller controls the SBT (via EIP-1271 Safe signature)
///   2. The declared tunnel endpoint is the live routing destination
///   3. The local stack declaration is timestamped + integrity-bound
///   4. The heartbeat is fresh (router rejects stale > 5 min timestamps)
///
/// Schema version: 1.0-ghost
/// Matches ghost-handshake.json spec.

import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  type Hex,
  type Address,
  type WalletClient,
} from 'viem';
import { WORKER_URL } from '../utils/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GhostProtocol = 'A2A-RPC' | 'MCP-over-HTTP' | 'XMTP' | 'nftmail';

export interface GhostConnection {
  type:     'tunnel' | 'direct' | 'relay';
  endpoint: string;           // e.g. "https://abc123.ghost-tunnel.ninja"
  protocol: GhostProtocol;
}

export interface GhostLocalStack {
  llm:          string;       // e.g. "Ollama/llama3.2:3b", "LMStudio/mistral-7b"
  mcpServers:   string[];     // e.g. ["filesystem", "memory-vault", "local-python-exec"]
  capabilities: string[];     // e.g. ["private-research", "long-term-planning"]
  brainConfigHash?: string;   // keccak256 of the local brain.json, if provided
}

export interface GhostHeartbeat {
  timestamp: number;          // unix seconds — router rejects if > 5 min stale
  signature: Hex;             // EIP-1271 signature from the Gnosis Safe
}

/** The canonical Ghost Handshake payload — signed by the Gnosis Safe */
export interface GhostHandshake {
  ghostId:    string;         // SBT token ID as "0x{hex}" or decimal string
  version:    '1.0-ghost';
  agentName:  string;         // fully qualified e.g. "alice.vault.gno"
  safeAddress: Address;       // Gnosis Safe that controls the SBT
  connection: GhostConnection;
  localStack: GhostLocalStack;
  heartbeat:  GhostHeartbeat;
}

/** Stored in worker KV after registration — includes routing metadata */
export interface GhostRegistration {
  handshake:    GhostHandshake;
  handshakeHash: string;      // keccak256 of the canonical payload
  registeredAt: number;       // unix ms
  lastHeartbeat: number;      // unix ms — updated on each re-registration
  active:       boolean;
  arweaveUri?:  string;       // set when eternal archive is initialised
}

// ─── EIP-712 domain for Ghost Handshake signatures ────────────────────────────
// Separate domain from HandshakeCertificate — this is a local-to-swarm proof,
// not an A2A trade certificate.

export const GHOST_HANDSHAKE_DOMAIN = {
  name:              'GhostAgent GhostHandshake',
  version:           '1',
  chainId:           100,    // Gnosis mainnet
  verifyingContract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address,
} as const;

export const GHOST_HANDSHAKE_TYPES = {
  GhostHandshake: [
    { name: 'ghostId',         type: 'string'  },
    { name: 'version',         type: 'string'  },
    { name: 'agentName',       type: 'string'  },
    { name: 'safeAddress',     type: 'address' },
    { name: 'endpointHash',    type: 'bytes32' }, // keccak256(connection.endpoint)
    { name: 'protocol',        type: 'string'  },
    { name: 'llmHash',         type: 'bytes32' }, // keccak256(localStack.llm)
    { name: 'timestamp',       type: 'uint256' }, // heartbeat.timestamp
  ],
} as const;

// ─── Canonical hash ───────────────────────────────────────────────────────────

/**
 * Compute the canonical keccak256 of a GhostHandshake payload.
 * Used as the message the Safe signs (EIP-1271).
 */
export function hashGhostHandshake(h: GhostHandshake): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: 'ghostId',      type: 'bytes32' },
      { name: 'agentName',    type: 'bytes32' },
      { name: 'safeAddress',  type: 'address' },
      { name: 'endpointHash', type: 'bytes32' },
      { name: 'llmHash',      type: 'bytes32' },
      { name: 'timestamp',    type: 'uint256' },
    ],
    [
      keccak256(toBytes(h.ghostId))               as Hex,
      keccak256(toBytes(h.agentName))             as Hex,
      h.safeAddress,
      keccak256(toBytes(h.connection.endpoint))   as Hex,
      keccak256(toBytes(h.localStack.llm))        as Hex,
      BigInt(h.heartbeat.timestamp),
    ],
  );
  return keccak256(encoded);
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

/**
 * Sign a GhostHandshake with the Gnosis Safe's WalletClient (EIP-712).
 * The signature is placed into handshake.heartbeat.signature.
 */
export async function signGhostHandshake(
  walletClient: WalletClient,
  h: Omit<GhostHandshake, 'heartbeat'> & { heartbeat: Omit<GhostHeartbeat, 'signature'> },
): Promise<GhostHandshake> {
  const [account] = await walletClient.getAddresses();

  const sig = await walletClient.signTypedData({
    account,
    domain: GHOST_HANDSHAKE_DOMAIN,
    types:  GHOST_HANDSHAKE_TYPES,
    primaryType: 'GhostHandshake',
    message: {
      ghostId:      h.ghostId,
      version:      h.version,
      agentName:    h.agentName,
      safeAddress:  h.safeAddress,
      endpointHash: keccak256(toBytes(h.connection.endpoint)) as Hex,
      protocol:     h.connection.protocol,
      llmHash:      keccak256(toBytes(h.localStack.llm)) as Hex,
      timestamp:    BigInt(h.heartbeat.timestamp),
    },
  });

  return { ...h, heartbeat: { timestamp: h.heartbeat.timestamp, signature: sig } } as GhostHandshake;
}

// ─── Validate ─────────────────────────────────────────────────────────────────

export interface HandshakeValidationResult {
  valid:   boolean;
  reason?: string;
}

/**
 * Pre-flight validation before submitting to the worker.
 * Does NOT verify the EIP-1271 signature — that is done on-chain / by the router.
 */
export function validateGhostHandshake(h: GhostHandshake): HandshakeValidationResult {
  const MAX_STALE_SECONDS = 5 * 60; // 5 minutes
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!h.ghostId || !h.ghostId.startsWith('0x')) {
    return { valid: false, reason: 'ghostId must be 0x-prefixed SBT token ID' };
  }
  if (h.version !== '1.0-ghost') {
    return { valid: false, reason: `Unknown version: ${h.version}` };
  }
  if (!h.agentName.endsWith('.vault.gno')) {
    return { valid: false, reason: 'Ghost tier requires vault.gno namespace' };
  }
  if (!h.connection.endpoint.startsWith('https://')) {
    return { valid: false, reason: 'Tunnel endpoint must be HTTPS' };
  }
  if (nowSeconds - h.heartbeat.timestamp > MAX_STALE_SECONDS) {
    return { valid: false, reason: `Heartbeat timestamp is stale (> ${MAX_STALE_SECONDS}s old)` };
  }
  if (!h.heartbeat.signature || h.heartbeat.signature.length < 130) {
    return { valid: false, reason: 'Missing or malformed EIP-1271 signature' };
  }
  if (h.localStack.mcpServers.length === 0) {
    return { valid: false, reason: 'localStack.mcpServers must declare at least one MCP server' };
  }

  return { valid: true };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build an unsigned GhostHandshake payload ready for signing.
 * The caller must call signGhostHandshake() to attach the heartbeat signature.
 */
export function buildGhostHandshake(params: {
  ghostId:     string;
  agentName:   string;
  safeAddress: Address;
  tunnelEndpoint: string;
  protocol?:   GhostProtocol;
  llm:         string;
  mcpServers:  string[];
  capabilities?: string[];
  brainConfigHash?: string;
}): Omit<GhostHandshake, 'heartbeat'> & { heartbeat: Omit<GhostHeartbeat, 'signature'> } {
  return {
    ghostId:    params.ghostId,
    version:    '1.0-ghost',
    agentName:  params.agentName,
    safeAddress: params.safeAddress,
    connection: {
      type:     'tunnel',
      endpoint: params.tunnelEndpoint,
      protocol: params.protocol ?? 'A2A-RPC',
    },
    localStack: {
      llm:          params.llm,
      mcpServers:   params.mcpServers,
      capabilities: params.capabilities ?? [],
      brainConfigHash: params.brainConfigHash,
    },
    heartbeat: {
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
}

// ─── API submit ───────────────────────────────────────────────────────────────

export interface GhostHandshakeSubmitResult {
  ok:             boolean;
  handshakeHash?: string;
  registeredAt?:  number;
  error?:         string;
}

/**
 * Submit a signed GhostHandshake to the swarm router.
 * The router stores the tunnel endpoint in KV so A2A traffic can be routed
 * to the local machine.
 */
export async function registerGhostHandshake(
  handshake: GhostHandshake,
): Promise<GhostHandshakeSubmitResult> {
  const validation = validateGhostHandshake(handshake);
  if (!validation.valid) {
    return { ok: false, error: validation.reason };
  }

  const handshakeHash = hashGhostHandshake(handshake);

  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'ghostHandshake',
        subAction:    'register',
        handshake,
        handshakeHash,
      }),
    });

    const data = await res.json() as { ok?: boolean; registeredAt?: number; error?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }

    return { ok: true, handshakeHash, registeredAt: data.registeredAt };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Send a heartbeat to keep the ghost tunnel registration alive.
 * Must be called at least every 5 minutes by the local bridge process.
 */
export async function sendGhostHeartbeat(
  agentName: string,
  handshakeHash: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:        'ghostHandshake',
        subAction:     'heartbeat',
        agentName:     agentName.toLowerCase(),
        handshakeHash,
        timestamp:     Math.floor(Date.now() / 1000),
      }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    return { ok: !!data.ok, error: data.error };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Resolve the active tunnel endpoint for a ghost agent.
 * Used by the swarm router to forward A2A traffic.
 */
export async function resolveGhostTunnel(
  agentName: string,
): Promise<{ endpoint: string; protocol: GhostProtocol; active: boolean } | null> {
  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:    'ghostHandshake',
        subAction: 'resolve',
        agentName: agentName.toLowerCase(),
      }),
    });
    const data = await res.json() as {
      ok?: boolean;
      endpoint?: string;
      protocol?: GhostProtocol;
      active?: boolean;
    };
    if (!data.ok || !data.endpoint) return null;
    return {
      endpoint: data.endpoint,
      protocol: data.protocol ?? 'A2A-RPC',
      active:   data.active ?? false,
    };
  } catch {
    return null;
  }
}
