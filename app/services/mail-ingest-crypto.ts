/// @module mail-ingest-crypto
/// Encrypt/decrypt inbound SMTP email bodies to an agent's wallet public key.
///
/// Uses ECIES-like scheme over WebCrypto (ECDH-P256 + AES-GCM-256):
///   1. Generate ephemeral ECDH keypair
///   2. Derive shared secret via ECDH(ephemeral_priv, recipient_pub)
///   3. Derive AES-GCM key via HKDF-SHA256
///   4. Encrypt plaintext with AES-GCM-256 (random 12-byte IV)
///   5. Store: { epk (compressed pubkey hex), iv, ciphertext } as JSON
///
/// The recipient's wallet (Privy / MetaMask / Safe) can decrypt by:
///   1. ECDH(wallet_priv, epk) → shared secret
///   2. HKDF → AES key
///   3. AES-GCM decrypt
///
/// Works in both Edge (Cloudflare Worker) and Node (Next.js) runtimes.

export interface EncryptedMail {
  version: 'ecies-p256-aesgcm-1';
  epk: string;       // ephemeral public key, uncompressed hex (04...)
  iv: string;        // 12-byte IV, hex
  ct: string;        // ciphertext, hex
  tag: string;       // AES-GCM auth tag is appended to ct by WebCrypto — included in ct
}

export interface PlaintextMail {
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveAESKey(sharedSecret: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const saltBuf = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info: new TextEncoder().encode('nftmail-inbox-v1') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Encrypt ───────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext mail to a recipient's wallet address public key.
 * recipientPubkeyHex: uncompressed secp256k1/P-256 public key (04..., 130 hex chars)
 *
 * NOTE: Ethereum wallets use secp256k1 which WebCrypto doesn't support natively.
 * We use P-256 (secp256r1) here for WebCrypto compatibility.
 * The agent's P-256 encryption key is derived at mint time and stored separately
 * from the secp256k1 signing key. See encryptionPubkey field in GenomeMetadata.
 */
export async function encryptMail(
  mail: PlaintextMail,
  recipientP256PubkeyHex: string
): Promise<EncryptedMail> {
  // Import recipient's P-256 public key
  const recipientKeyBytes = hexToBytes(recipientP256PubkeyHex);
  const recipientKeyBuf = recipientKeyBytes.buffer.slice(recipientKeyBytes.byteOffset, recipientKeyBytes.byteOffset + recipientKeyBytes.byteLength) as ArrayBuffer;
  const recipientKey = await crypto.subtle.importKey(
    'raw',
    recipientKeyBuf,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Generate ephemeral keypair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey },
    ephemeral.privateKey,
    256
  );

  // Export ephemeral public key (uncompressed)
  const epkRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const epkHex = bytesToHex(new Uint8Array(epkRaw));

  // IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Derive AES key
  const aesKey = await deriveAESKey(sharedBits, iv);

  // Encrypt
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(mail));
  const plaintextBuf = plaintextBytes.buffer.slice(plaintextBytes.byteOffset, plaintextBytes.byteOffset + plaintextBytes.byteLength) as ArrayBuffer;
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuf }, aesKey, plaintextBuf);

  return {
    version: 'ecies-p256-aesgcm-1',
    epk: epkHex,
    iv: bytesToHex(iv),
    ct: bytesToHex(new Uint8Array(ciphertext)),
    tag: '', // auth tag is embedded in ct by WebCrypto (last 16 bytes)
  };
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

/**
 * Decrypt an EncryptedMail using the recipient's P-256 private key (CryptoKey).
 * Called client-side in the agent dashboard — private key never leaves the browser.
 */
export async function decryptMail(
  encrypted: EncryptedMail,
  recipientPrivateKey: CryptoKey
): Promise<PlaintextMail> {
  const epkBytes = hexToBytes(encrypted.epk);
  const epkBuf = epkBytes.buffer.slice(epkBytes.byteOffset, epkBytes.byteOffset + epkBytes.byteLength) as ArrayBuffer;
  const epk = await crypto.subtle.importKey(
    'raw',
    epkBuf,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: epk },
    recipientPrivateKey,
    256
  );

  const iv = hexToBytes(encrypted.iv);
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const aesKey = await deriveAESKey(sharedBits, iv);
  const ct = hexToBytes(encrypted.ct);
  const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, aesKey, ctBuf);
  return JSON.parse(new TextDecoder().decode(plaintext)) as PlaintextMail;
}

// ── Privacy mode check ────────────────────────────────────────────────────────

export type PrivacyMode = 'glassbox' | 'private' | 'hard-privacy';

/**
 * Determine whether a namespace uses GlassBox cleartext logging.
 * molt.gno is always GlassBox — cleartext audit trail preserved.
 * Others respect the agent's stored privacy setting.
 */
export function isGlassBoxNamespace(namespace: string, agentPrivacyMode: PrivacyMode): boolean {
  if (namespace === 'molt.gno') return true; // always cleartext audit
  return agentPrivacyMode === 'glassbox';
}
