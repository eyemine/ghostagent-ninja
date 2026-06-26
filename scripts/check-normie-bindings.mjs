import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const c = createPublicClient({ chain: mainnet, transport: http('https://ethereum.publicnode.com') });

const ADAPTER = '0xde152AfB7db5373F34876E1499fbD893A82dD336';
const NORMIE  = '0x9Eb6E2025B64f340691e424b7fe7022fFDE12438';

const AGENT_BOUND_ABI = {
  type: 'event', name: 'AgentBound',
  inputs: [
    { name: 'agentId',       type: 'uint256', indexed: true  },
    { name: 'standard',      type: 'uint8',   indexed: true  },
    { name: 'tokenContract', type: 'address', indexed: true  },
    { name: 'tokenId',       type: 'uint256', indexed: false },
    { name: 'registeredBy',  type: 'address', indexed: false },
  ],
};

const BINDING_OF_ABI = [{
  type: 'function', name: 'bindingOf', stateMutability: 'view',
  inputs:  [{ name: 'agentId', type: 'uint256' }],
  outputs: [{ name: '', type: 'tuple', components: [
    { name: 'standard',      type: 'uint8'   },
    { name: 'tokenContract', type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
  ]}],
}];

const IS_CONTROLLER_ABI = [{
  type: 'function', name: 'isController', stateMutability: 'view',
  inputs:  [{ name: 'account', type: 'address' }, { name: 'agentId', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

const latest = await c.getBlockNumber();
console.log('Latest block:', latest.toString());

// Scan last 5000 blocks only (non-archive RPC limit)
const from = latest - 5000n;
console.log(`Scanning AgentBound events from block ${from}...`);

const logs = await c.getLogs({
  address: ADAPTER,
  event: AGENT_BOUND_ABI,
  fromBlock: from,
  toBlock: 'latest',
});

console.log(`Total AgentBound logs in range: ${logs.length}`);

const normieLogs = logs.filter(
  l => l.args.tokenContract?.toLowerCase() === NORMIE.toLowerCase()
);
console.log(`Normie-specific bindings found: ${normieLogs.length}`);

if (normieLogs.length > 0) {
  console.log('\nBound Normies:');
  normieLogs.forEach(l => {
    console.log(`  tokenId: ${l.args.tokenId} | agentId: ${l.args.agentId} | by: ${l.args.registeredBy} | block: ${l.blockNumber}`);
  });
} else {
  console.log('\nNo Normies bound via adapter8004 in the last 5000 blocks.');
  console.log('(Adapter may have been used before this window — need an archive RPC or Etherscan to scan all-time)');
  
  // Probe known Normie #1 delegate address via bindingOf on agentIds 1..20
  console.log('\nProbing bindingOf(agentId) for agentIds 1-20 on adapter...');
  const BINDING_ABI = [{
    type: 'function', name: 'bindingOf', stateMutability: 'view',
    inputs:  [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'standard',      type: 'uint8'   },
      { name: 'tokenContract', type: 'address' },
      { name: 'tokenId',       type: 'uint256' },
    ]}],
  }];
  for (let id = 1n; id <= 20n; id++) {
    const b = await c.readContract({ address: ADAPTER, abi: BINDING_ABI, functionName: 'bindingOf', args: [id] }).catch(() => null);
    if (b && b.tokenContract.toLowerCase() === NORMIE.toLowerCase()) {
      console.log(`  agentId ${id}: Normie tokenId ${b.tokenId}`);
    } else if (b && b.tokenContract !== '0x0000000000000000000000000000000000000000') {
      console.log(`  agentId ${id}: other token ${b.tokenContract} tokenId ${b.tokenId}`);
    }
  }
}
