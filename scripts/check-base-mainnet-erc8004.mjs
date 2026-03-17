import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });

const ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalSupply() view returns (uint256)',
]);

// Check if any of the known ERC-8004 addresses are live on Base mainnet
const CANDIDATES = [
  '0x8004A818BFB912233c491871b3d84c89A494BD9e', // same as Base Sepolia
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // same as Gnosis
];

for (const addr of CANDIDATES) {
  try {
    const supply = await client.readContract({ address: addr, abi: ABI, functionName: 'totalSupply' });
    console.log(`${addr}: totalSupply = ${supply} ✅`);
  } catch (e) {
    console.log(`${addr}: NOT deployed on Base mainnet (${e.shortMessage || e.message.slice(0, 80)})`);
  }
}
