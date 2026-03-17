import { createPublicClient, http, parseAbi, decodeEventLog } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });
const REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';

const ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event AgentRegistered(uint256 indexed tokenId, string agentURI, address indexed owner)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function totalSupply() view returns (uint256)',
]);

// --- Decode the specific tx ---
const TX = '0xba4a8160413e30b76eef8372c24f532905136ea7699d64858d32baf5676f9830';
const receipt = await client.getTransactionReceipt({ hash: TX });
console.log('=== TX', TX.slice(0, 12), '===');
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
    console.log(decoded.eventName, JSON.stringify(decoded.args, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  } catch {}
}

// --- Total supply ---
try {
  const supply = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'totalSupply' });
  console.log('\ntotalSupply on Base mainnet:', supply.toString());
} catch(e) { console.log('totalSupply error:', e.shortMessage || e.message); }

// --- Check our Safe owns anything ---
const SAFE = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4';
console.log('\nChecking agentIds 1-20 for ownership by', SAFE);
for (let id = 1; id <= 20; id++) {
  try {
    const owner = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'ownerOf', args: [BigInt(id)] });
    if (owner.toLowerCase() === SAFE.toLowerCase()) {
      const uri = await client.readContract({ address: REGISTRY, abi: ABI, functionName: 'tokenURI', args: [BigInt(id)] }).catch(() => '');
      console.log(`  agentId ${id}: OWNED BY SAFE ✓  uri=${uri.slice(0, 80)}`);
    } else {
      console.log(`  agentId ${id}: owner=${owner}`);
    }
  } catch { break; }
}
