/// script/encrypt-audio-secret.ts
///
/// Encrypts the path to the master audio file using CDR owner-only encryption.
/// This creates a vault that only the operator can decrypt.
///
/// Output: VAULT_UUID to be written to ERC-8048

import { encryptDataKeyOwnerOnly } from '../app/services/cdr-vault';

async function main() {
  const secret = JSON.stringify({ path: 'secure-audio/misbehaved.wav' });
  const vault = await encryptDataKeyOwnerOnly({
    dataKey: Buffer.from(secret),
  });
  console.log('VAULT_UUID:', vault.uuid);
  console.log('export VAULT_UUID_REDHAMMER=' + vault.uuid);
}

main().catch(console.error);
