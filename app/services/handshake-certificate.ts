/// EIP-712 HandshakeCertificate — P2P mutual authentication proof
///
/// A HandshakeCertificate is produced when two GhostAgents complete a
/// bilateral trade negotiation over the nftmail.box A2A mesh without any
/// central coordinator. Both agents sign the same certificate struct,
/// producing two independent EIP-712 signatures that prove:
///
///   1. Initiator agent autonomously proposed the trade (signed TradeIntent)
///   2. Responder agent autonomously accepted it (counter-signed same hash)
///   3. Both signatures are chain-bound via EIP-155 (chainId in domain)
///   4. The negotiation was bilateral — no central server could forge both sigs
///
/// This is the "P2P Handshake Certificate" submitted to:
///   - ERC-8004 Validation Registry as requestURI evidence (objective proof)
///   - Vertex / DoraHacks Risk Router as mutual-auth proof for the trade
///
/// Schema is intentionally minimal — every field must be verifiable on-chain
/// or via the ERC-8004 Validation Registry response.

import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  type Hex,
  type Address,
  type WalletClient,
} from 'viem';

// ─── EIP-712 Domain ───────────────────────────────────────────────────────────

/// Primary domain: Gnosis mainnet (chainId 100)
/// For testnet / Sepolia hackathon submissions use HANDSHAKE_DOMAIN_SEPOLIA below.
export const HANDSHAKE_DOMAIN = {
  name:              'GhostAgent HandshakeCertificate',
  version:           '1',
  chainId:           100,
  verifyingContract: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address,
  // ^ ERC-8004 Identity Registry on Gnosis mainnet — the canonical verifier
} as const;

/// Sepolia testnet domain — used for hackathon Capital Vault sandbox trades
export const HANDSHAKE_DOMAIN_SEPOLIA = {
  name:              'GhostAgent HandshakeCertificate',
  version:           '1',
  chainId:           11155111,
  verifyingContract: '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address,
  // ^ ERC-8004 Identity Registry on Ethereum Sepolia
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/// The core struct both agents sign.
/// Encoding mirrors EIP-712 — string fields are keccak256-hashed before encoding.
export interface HandshakeCertificate {
  /// ERC-8004 agentId of the trade initiator
  initiatorAgentId:   bigint;
  /// ERC-8004 agentId of the trade responder (counter-agent)
  responderAgentId:   bigint;
  /// Gnosis Safe address of the initiator (EIP-1271 signer)
  initiatorWallet:    Address;
  /// Gnosis Safe address of the responder (EIP-1271 signer)
  responderWallet:    Address;
  /// keccak256 hash of the underlying TradeIntent struct (links to the trade)
  tradeIntentHash:    Hex;
  /// A2A mesh channel used for negotiation — e.g. "nftmail.box/ghostagent_"
  meshChannel:        string;
  /// ISO-8601 timestamp when the handshake was initiated
  initiatedAt:        bigint;   // unix seconds
  /// ISO-8601 timestamp when the responder countersigned
  completedAt:        bigint;   // unix seconds
  /// Replay-protection nonce (should match initiator's TradeIntent nonce)
  nonce:              bigint;
  /// Human-readable outcome tag — e.g. "accepted", "partial-fill", "rejected"
  outcomeTag:         string;
}

// ─── EIP-712 type array (used in signTypedData + encoding) ───────────────────

export const HANDSHAKE_CERTIFICATE_TYPE = [
  { name: 'initiatorAgentId',  type: 'uint256' },
  { name: 'responderAgentId',  type: 'uint256' },
  { name: 'initiatorWallet',   type: 'address' },
  { name: 'responderWallet',   type: 'address' },
  { name: 'tradeIntentHash',   type: 'bytes32' },
  { name: 'meshChannel',       type: 'string'  },
  { name: 'initiatedAt',       type: 'uint256' },
  { name: 'completedAt',       type: 'uint256' },
  { name: 'nonce',             type: 'uint256' },
  { name: 'outcomeTag',        type: 'string'  },
] as const;

export const HANDSHAKE_CERTIFICATE_TYPES = {
  HandshakeCertificate: HANDSHAKE_CERTIFICATE_TYPE,
} as const;

// ─── Signing ──────────────────────────────────────────────────────────────────

/**
 * Sign a HandshakeCertificate as the initiating agent.
 * Called by the agent that proposed the trade.
 */
export async function signHandshakeInitiator(
  walletClient: WalletClient,
  cert: HandshakeCertificate,
  sepolia = false,
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.signTypedData({
    account,
    domain:      sepolia ? HANDSHAKE_DOMAIN_SEPOLIA : HANDSHAKE_DOMAIN,
    types:       HANDSHAKE_CERTIFICATE_TYPES,
    primaryType: 'HandshakeCertificate',
    message:     cert,
  });
}

/**
 * Sign a HandshakeCertificate as the responding agent.
 * Called by the counter-agent that accepted the trade.
 * The cert struct must be identical to what the initiator signed.
 */
export async function signHandshakeResponder(
  walletClient: WalletClient,
  cert: HandshakeCertificate,
  sepolia = false,
): Promise<Hex> {
  const [account] = await walletClient.getAddresses();
  return walletClient.signTypedData({
    account,
    domain:      sepolia ? HANDSHAKE_DOMAIN_SEPOLIA : HANDSHAKE_DOMAIN,
    types:       HANDSHAKE_CERTIFICATE_TYPES,
    primaryType: 'HandshakeCertificate',
    message:     cert,
  });
}

// ─── Hash ─────────────────────────────────────────────────────────────────────

/**
 * Compute the EIP-712 struct hash of a HandshakeCertificate.
 * This becomes requestHash in ERC-8004 validationRequest().
 */
export function hashHandshakeCertificate(cert: HandshakeCertificate): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: 'initiatorAgentId',   type: 'uint256' },
      { name: 'responderAgentId',   type: 'uint256' },
      { name: 'initiatorWallet',    type: 'address' },
      { name: 'responderWallet',    type: 'address' },
      { name: 'tradeIntentHash',    type: 'bytes32' },
      { name: 'meshChannelHash',    type: 'bytes32' },
      { name: 'initiatedAt',        type: 'uint256' },
      { name: 'completedAt',        type: 'uint256' },
      { name: 'nonce',              type: 'uint256' },
      { name: 'outcomeTagHash',     type: 'bytes32' },
    ],
    [
      cert.initiatorAgentId,
      cert.responderAgentId,
      cert.initiatorWallet,
      cert.responderWallet,
      cert.tradeIntentHash,
      keccak256(toBytes(cert.meshChannel)),
      cert.initiatedAt,
      cert.completedAt,
      cert.nonce,
      keccak256(toBytes(cert.outcomeTag)),
    ],
  );
  return keccak256(encoded);
}

// ─── Serialization ────────────────────────────────────────────────────────────

export interface SignedHandshakeCertificate {
  /// Schema type identifier — used by Validation Registry and Risk Router
  type:               'ghost:handshake-certificate:v1';
  /// EIP-712 domain used (identifies chain + verifying contract)
  domain:             typeof HANDSHAKE_DOMAIN | typeof HANDSHAKE_DOMAIN_SEPOLIA;
  /// The certificate data both agents signed
  certificate:        {
    initiatorAgentId: string;
    responderAgentId: string;
    initiatorWallet:  string;
    responderWallet:  string;
    tradeIntentHash:  string;
    meshChannel:      string;
    initiatedAt:      string;
    completedAt:      string;
    nonce:            string;
    outcomeTag:       string;
  };
  /// EIP-712 struct hash — used as requestHash in ERC-8004 validationRequest()
  certificateHash:    string;
  /// Initiator agent's EIP-712 signature
  initiatorSignature: string;
  /// Responder agent's EIP-712 signature (proves bilateral negotiation)
  responderSignature: string;
  /// Unix ms timestamp of final assembly
  assembledAt:        number;
  /// Link to the parent TradeIntent artifact (IPFS CID or worker KV key)
  tradeIntentRef:     string;
}

/**
 * Assemble the final signed certificate envelope after both agents have signed.
 * This is the object pinned to Arweave/IPFS and referenced in validationRequest().
 */
export function assembleSignedCertificate(
  cert: HandshakeCertificate,
  initiatorSig: Hex,
  responderSig: Hex,
  tradeIntentRef: string,
  sepolia = false,
): SignedHandshakeCertificate {
  return {
    type:    'ghost:handshake-certificate:v1',
    domain:  sepolia ? HANDSHAKE_DOMAIN_SEPOLIA : HANDSHAKE_DOMAIN,
    certificate: {
      initiatorAgentId: cert.initiatorAgentId.toString(),
      responderAgentId: cert.responderAgentId.toString(),
      initiatorWallet:  cert.initiatorWallet,
      responderWallet:  cert.responderWallet,
      tradeIntentHash:  cert.tradeIntentHash,
      meshChannel:      cert.meshChannel,
      initiatedAt:      cert.initiatedAt.toString(),
      completedAt:      cert.completedAt.toString(),
      nonce:            cert.nonce.toString(),
      outcomeTag:       cert.outcomeTag,
    },
    certificateHash:    hashHandshakeCertificate(cert),
    initiatorSignature: initiatorSig,
    responderSignature: responderSig,
    assembledAt:        Date.now(),
    tradeIntentRef,
  };
}
