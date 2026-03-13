import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

const client = createPublicClient({ chain: gnosis, transport: http() });

const CONTRACTS = {
  'OLD nftmail (0x831d)': '0x831ddd71e7c33e16b674099129e6e379da407faf',
  'NEW nftmail (0x4Da8)': '0x4Da8b049303F101ffdd6ADfAEC048536f796CD4c',
};

const abi = [
  { name: 'ownerOf',     type: 'function', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { name: 'nextTokenId', type: 'function', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

// Also scan SubnameMinted events to recover labels
const SubnameMintedABI = [{
  name: 'SubnameMinted',
  type: 'event',
  inputs: [
    { indexed: true,  name: 'parentNode', type: 'bytes32' },
    { indexed: true,  name: 'labelhash',  type: 'bytes32' },
    { indexed: true,  name: 'subnode',    type: 'bytes32' },
    { indexed: false, name: 'tokenId',    type: 'uint256' },
    { indexed: false, name: 'owner',      type: 'address' },
  ],
}];

for (const [name, addr] of Object.entries(CONTRACTS)) {
  console.log(`\n=== ${name} ===`);
  const next = await client.readContract({ address: addr, abi, functionName: 'nextTokenId' });
  console.log(`nextTokenId: ${next} (${Number(next) - 1} tokens minted)`);

  for (let i = 1n; i < next; i++) {
    try {
      const owner = await client.readContract({ address: addr, abi, functionName: 'ownerOf', args: [i] });
      console.log(`  tokenId ${i} -> ${owner}`);
    } catch {
      console.log(`  tokenId ${i} -> (burned or error)`);
    }
  }

  // Fetch SubnameMinted events from deploy block range
  try {
    const logs = await client.getLogs({
      address: addr,
      event: SubnameMintedABI[0],
      fromBlock: 0n,
      toBlock: 'latest',
    });
    console.log(`  SubnameMinted events: ${logs.length}`);
    for (const log of logs) {
      console.log(`    labelhash=${log.args.labelhash} tokenId=${log.args.tokenId} owner=${log.args.owner}`);
    }
  } catch (e) {
    console.log(`  Could not fetch logs: ${e.message}`);
  }
}
