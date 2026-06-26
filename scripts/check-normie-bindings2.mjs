/**
 * Probe adapter8004 for Normie bindings using readContract only (no getLogs/archive).
 * Checks bindingOf(agentId) for agentIds 1-50 and reports any bound to the Normies contract.
 */
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { config } from 'dotenv';
config();

const ETH_RPC = process.env.ETH_MAINNET_RPC || 'https://ethereum.publicnode.com';
const c = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) });

const ADAPTER = '0xde152AfB7db5373F34876E1499fbD893A82dD336';
const NORMIE  = '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438'.toLowerCase();
const ERC8004  = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const BINDING_ABI = [{
  type: 'function', name: 'bindingOf', stateMutability: 'view',
  inputs:  [{ name: 'agentId', type: 'uint256' }],
  outputs: [{ name: '', type: 'tuple', components: [
    { name: 'standard',      type: 'uint8'   },
    { name: 'tokenContract', type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
  ]}],
}];

const METADATA_ABI = [{
  type: 'function', name: 'getMetadata', stateMutability: 'view',
  inputs:  [{ name: 'agentId', type: 'uint256' }, { name: 'key', type: 'string' }],
  outputs: [{ name: '', type: 'bytes' }],
}];

console.log('Probing bindingOf(agentId) for agentIds 1–50 on adapter8004 (mainnet)...\n');

const normieBindings = [];

await Promise.all(
  Array.from({ length: 50 }, (_, i) => BigInt(i + 1)).map(async (id) => {
    const b = await c.readContract({
      address: ADAPTER, abi: BINDING_ABI, functionName: 'bindingOf', args: [id],
    }).catch(() => null);
    if (!b) return;
    if (b.tokenContract.toLowerCase() === NORMIE) {
      normieBindings.push({ agentId: id, tokenId: b.tokenId, standard: b.standard });
    } else if (b.tokenContract !== '0x0000000000000000000000000000000000000000') {
      console.log(`  agentId ${id}: OTHER token ${b.tokenContract} #${b.tokenId}`);
    }
  })
);

console.log(`\nNormie bindings found in agentIds 1–50: ${normieBindings.length}`);
normieBindings.sort((a,b) => Number(a.agentId - b.agentId)).forEach(b => {
  console.log(`  agentId: ${b.agentId} → Normie #${b.tokenId}`);
});

// If any found, also read their agent-profile metadata key
if (normieBindings.length > 0) {
  console.log('\nChecking agent-profile metadata for bound Normies...');
  for (const b of normieBindings) {
    const metaBytes = await c.readContract({
      address: ERC8004, abi: METADATA_ABI, functionName: 'getMetadata',
      args: [b.agentId, 'agent-profile'],
    }).catch(() => null);
    const profile = metaBytes && metaBytes !== '0x'
      ? new TextDecoder().decode(Buffer.from(metaBytes.slice(2), 'hex'))
      : '(not set)';
    console.log(`  agentId ${b.agentId} (Normie #${b.tokenId}): agent-profile = "${profile}"`);
  }
} else {
  console.log('\nNo Normies bound yet — the adapter is ready but unregistered for Normies.');
  console.log('To bind Normie #N: register(0, NORMIE_CONTRACT, N, agentURI) from the Normie owner wallet.');
}
