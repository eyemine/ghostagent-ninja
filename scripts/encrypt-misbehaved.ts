/// scripts/encrypt-misbehaved.ts
///
/// CDR-encrypts cascade/misbehaved.wav (Red Hammer master) into a
/// license-gated CDR vault on Story Aeneid.
///
/// Required env vars:
///   RED_HAMMER_IP_ID        — Story IP asset id for Chonk #697 (0x...)
///   CDR_OPERATOR_PRIVATE_KEY — operator wallet that pays the CDR fees
///
/// Optional:
///   NEXT_PUBLIC_CDR_NETWORK — 'testnet' (default) or 'mainnet'
///   CDR_RPC_URL             — override default Aeneid RPC
///   CDR_API_URL             — override default Aeneid API
///
/// Outputs:
///   cascade/misbehaved.enc        — AES-encrypted ciphertext (off-chain payload)
///   console: VAULT_UUID + vaultRef — write this to ERC-8048 sidecar cdr[vault_id]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encryptFileLicenseGated, buildIpaConfidentialBlock } from '../app/services/cdr-vault';
import type { Hex } from 'viem';

const ROOT = join(__dirname, '..');
const CASCADE_DIR = join(ROOT, 'cascade');
const MASTER_PATH = join(CASCADE_DIR, 'misbehaved.wav');
const ENC_PATH    = join(CASCADE_DIR, 'misbehaved.enc');

// ── File-system storage provider ─────────────────────────────────────────────
// Stores the ciphertext blob locally so it can be uploaded to IPFS/Storacha
// separately. The `id` returned is the local file path.
const localFileStorageProvider = {
  async upload(bytes: Uint8Array): Promise<string> {
    if (!existsSync(CASCADE_DIR)) mkdirSync(CASCADE_DIR, { recursive: true });
    writeFileSync(ENC_PATH, bytes);
    console.log(`  [storage] ciphertext written → ${ENC_PATH} (${bytes.byteLength} bytes)`);
    return ENC_PATH;
  },
  async download(id: string): Promise<Uint8Array> {
    return new Uint8Array(readFileSync(id));
  },
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ipId = process.env.RED_HAMMER_IP_ID as Hex | undefined;
  if (!ipId || !ipId.startsWith('0x') || ipId.length !== 42) {
    console.error('ERROR: Set RED_HAMMER_IP_ID to the 20-byte Story IP Asset address for Chonk #697');
    console.error('       e.g. RED_HAMMER_IP_ID=0xabc... npx tsx scripts/encrypt-misbehaved.ts');
    process.exit(1);
  }

  if (!process.env.CDR_OPERATOR_PRIVATE_KEY) {
    console.error('ERROR: CDR_OPERATOR_PRIVATE_KEY is required (operator wallet that pays CDR fees)');
    process.exit(1);
  }

  if (!existsSync(MASTER_PATH)) {
    console.error(`ERROR: Master file not found at ${MASTER_PATH}`);
    console.error('       Copy misbehaved.wav → cascade/misbehaved.wav and retry');
    process.exit(1);
  }

  console.log('=== CDR Vault — misbehaved.wav (Red Hammer) ===');
  console.log(`  IP Asset ID : ${ipId}`);
  console.log(`  Master      : ${MASTER_PATH}`);
  console.log('  Network     :', process.env.NEXT_PUBLIC_CDR_NETWORK ?? 'testnet (Aeneid)');
  console.log('');
  console.log('Step 1/2 — Reading master...');
  const master = new Uint8Array(readFileSync(MASTER_PATH));
  console.log(`  ${master.byteLength} bytes`);

  console.log('Step 2/2 — Encrypting + allocating CDR vault...');
  console.log('  (This will submit 2 transactions: allocate + write. May take ~30s.)');

  const vault = await encryptFileLicenseGated({
    content: master,
    ipId,
    storageProvider: localFileStorageProvider,
    backend: 'inline',
  });

  const vaultRef = `${vault.chainId}:${vault.uuid}`;
  const confidentialBlock = buildIpaConfidentialBlock(vault);

  console.log('');
  console.log('=== VAULT CREATED ===');
  console.log('VAULT_UUID    :', vault.uuid);
  console.log('VAULT_REF     :', vaultRef,  '  ← write as cdr[vault_id] in ERC-8048 sidecar');
  console.log('chainId       :', vault.chainId);
  console.log('dataCid       :', vault.dataCid ?? '(inline)');
  console.log('allocate tx   :', vault.txHashes.allocate);
  console.log('write tx      :', vault.txHashes.write);
  console.log('');
  console.log('=== IPA confidential block (paste into ERC-8048 metadata) ===');
  console.log(JSON.stringify(confidentialBlock, null, 2));
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
