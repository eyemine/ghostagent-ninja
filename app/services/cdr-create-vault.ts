import type { Hex, PublicClient } from 'viem';
import { encodeStringValue } from './erc8048-publisher';
import { encryptFileLicenseGated, type CDRVaultRef } from './cdr-vault';
import { setErc8048Metadata } from './erc8048-writer';

type MemoryStorage = Map<string, Uint8Array>;
const memoryStorage: MemoryStorage = new Map();

const memoryStorageProvider = {
  async upload(bytes: Uint8Array): Promise<string> {
    const id = `memory-${crypto.randomUUID()}`;
    memoryStorage.set(id, bytes);
    return id;
  },
  async download(id: string): Promise<Uint8Array> {
    const bytes = memoryStorage.get(id);
    if (!bytes) throw new Error(`Missing memory storage payload: ${id}`);
    return bytes;
  },
};

function toUuidRef(vault: CDRVaultRef): string {
  return `${vault.chainId}:${vault.uuid}`;
}

export async function createAndRegisterCdrVault(
  tokenId: number,
  ipId: string,
  rawStemsData: Buffer,
): Promise<string> {
  if (!ipId.startsWith('0x') || ipId.length !== 42) {
    throw new Error('createAndRegisterCdrVault requires a 20-byte Story IP asset id');
  }

  const licenseId = `story-aeneid-license-${tokenId}`;
  const vault = await encryptFileLicenseGated({
    content: new Uint8Array(rawStemsData),
    ipId: ipId as Hex,
    storageProvider: memoryStorageProvider,
    backend: 'inline',
  });

  const vaultRef = toUuidRef(vault);
  await setErc8048Metadata(tokenId, 'cdr[vault_id]', encodeStringValue(vaultRef));
  await setErc8048Metadata(tokenId, 'story[license_id]', encodeStringValue(licenseId));

  return vaultRef;
}

export function getMemoryStorageProvider(): {
  upload(bytes: Uint8Array): Promise<string>;
  download(id: string): Promise<Uint8Array>;
} {
  return memoryStorageProvider;
}
