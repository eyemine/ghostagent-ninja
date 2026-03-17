import { createPublicClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const RPC = 'https://base-sepolia-rpc.publicnode.com';
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

const ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);

// Known tokenId from previous session
const IDS_TO_CHECK = [1766, 1767, 1768, 1769, 1770];

for (const id of IDS_TO_CHECK) {
  try {
    const owner = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [BigInt(id)] });
    let uri = '';
    try { uri = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [BigInt(id)] }); } catch {}
    console.log(`agentId ${id}: owner=${owner} uri=${uri.slice(0, 80)}`);
  } catch(e) {
    console.log(`agentId ${id}: not minted (${e.shortMessage || e.message})`);
  }
}
