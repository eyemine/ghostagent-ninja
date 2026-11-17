import { createPublicClient, http, keccak256, namehash, parseAbi, parseAbiItem, toHex, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';
import { gnosis } from 'viem/chains';

export const KEY_REGISTRARS: Record<string, Address> = {
  'nftmail.gno': '0x46c37365572C9994812AAA41fD04eB56D05469D0',
  'molt.gno': '0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50',
  'openclaw.gno': '0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe',
  'picoclaw.gno': '0xe5fd65562698f46ea9762bd38141535b1fd875b5',
  'vault.gno': '0xc6b184a38da64d1d535674dafb9ce2440058ec4e',
  'agent.gno': '0x608071875bcc0ef0b934f8a2367672d8c472cacf',
};
export const KEY_REGISTRAR_ABI = parseAbi([
  'function gnsRegistry() view returns (address)',
  'function nodeOwner(bytes32) view returns (address)',
  'function ownerOf(uint256) view returns (address)',
  'function mintSubname(string label,address owner,bytes storyData,bytes32 tbaSalt) returns (uint256,bytes32,bytes32,address)',
]);
export const KEY_MINT_EVENT = parseAbiItem('event SubnameMinted(bytes32 indexed parentNode,bytes32 indexed labelhash,bytes32 indexed subnode,uint256 tokenId,address owner)');

export function gnosisKeyClient() {
  return createPublicClient({ chain: gnosis, transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com') });
}

export async function keyNameOwner(client: PublicClient, registrar: Address, name: string): Promise<Address> {
  const registry = await client.readContract({ address: registrar, abi: KEY_REGISTRAR_ABI, functionName: 'gnsRegistry' });
  return client.readContract({
    address: registry, abi: KEY_REGISTRAR_ABI, functionName: 'nodeOwner', args: [namehash(name)],
  });
}

/**
 * Only reuse a mint when its receipt/event proves the label AND the actual
 * ERC-721 is still held by the requested owner. Registry pointers can be stale
 * after transfers and are not evidence of NFT ownership.
 */
export async function findRecentKeyMint(
  client: PublicClient, registrar: Address, label: string, tld: string, owner: Address,
): Promise<{ tokenId: bigint; txHash: Hex } | null> {
  const registered = await keyNameOwner(client, registrar, `${label}.${tld}`);
  if (registered === zeroAddress) return null;
  const head = await client.getBlockNumber();
  const floor = head > 50_000n ? head - 50_000n : 0n;
  for (let end = head; end >= floor;) {
    const start = end - floor >= 9_999n ? end - 9_999n : floor;
    const logs = await client.getLogs({
      address: registrar, event: KEY_MINT_EVENT,
      args: { parentNode: namehash(tld), labelhash: keccak256(toHex(label)) },
      fromBlock: start, toBlock: end, strict: true,
    });
    const latest = logs[logs.length - 1];
    if (latest) {
      const holder = await client.readContract({
        address: registrar, abi: KEY_REGISTRAR_ABI, functionName: 'ownerOf', args: [latest.args.tokenId],
      });
      if (holder.toLowerCase() !== owner.toLowerCase()) {
        throw new Error(`${label}.${tld} is held by ${holder}. Recovery or a different key label is required; no new payment is needed.`);
      }
      return { tokenId: latest.args.tokenId, txHash: latest.transactionHash };
    }
    if (start === floor) break;
    end = start - 1n;
  }
  throw new Error(`${label}.${tld} already exists. Its original mint receipt is required before it can be reused.`);
}
