import { indexer } from "envio";

// The MetadataSet event has `key` as `string indexed`.
// Solidity only stores keccak256(key) in the log topic — the original string is
// unrecoverable from the log. We maintain a reverse-lookup map for all KNOWN_KEYS
// so the DB stores readable strings rather than opaque hashes.
// Recompute with: ethers.keccak256(ethers.toUtf8Bytes(key))
const KEY_HASH_TO_STRING: Record<string, string> = {
  '0xe1d9be331a7967cf3e11f25d4a3f150016a2fecedb900b267a24727ebbff91bd': 'endpoint[a2a]',
  '0x9651caef303bd9301408827f8cc0591ff78c3f6667dcf9cfdf8d436daabda6d1': 'endpoint[mcp]',
  '0xc4a5b527cc17c562719b85c6954e6ec1fb54df2cc06d3ff48bf9d7988136c884': 'skills/primary',
  '0x28d3dd7f1f6d03f880e040d9380ba83f7127096adb04cce200aceaac714b6a78': 'skills/tools',
  '0xe1ac47485725de7a26317065ce7d9131cd76599490d258faf11bad54ce06a72e': 'agent-binding',
  '0xe9995f74e4d2ed24a293ab455b2ac23a550c58ec248a44ca9f08ed7d48c9c21d': 'cursor[mandate]',
  '0x39743e88f3b83ec9d56c79a691e6f11635a7cfa5dae2aacd433b872460d86fa0': 'story[ip_id]',
  '0x6b3c5498be8b3c86c458ea6eb00f02cd3044fd5f1f5b4a660d9ef9ffded29437': 'story[license_id]',
  '0x18aab90a4e6196bd20fd32d7e43054d2c9179d97050e756eac0dd7f9f6492ab9': 'cdr[vault_id]',
  '0xe3f42ad76b515d5dc585b293c9173d90eca2eab95c9f9921b985eef270e827ac': 'cursor[agreement_hash]',
};

indexer.onEvent({ contract: "MetadataRegistry", event: "MetadataSet" }, async ({ event, context }) => {
  const { tokenId, key: rawKey, value } = event.params;
  // rawKey is the keccak256 hash (bytes32 hex) of the original key string
  const key = KEY_HASH_TO_STRING[rawKey as string] ?? (rawKey as string);
  const id = `${tokenId.toString()}:${key}`;

  context.Metadata.set({
    id,
    tokenId,
    key,
    value,
    setAt: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
  });
});
