import { createPublicClient, http, getAddress } from 'viem';
import { gnosis } from 'viem/chains';

const ERC6551_REGISTRY = '0x000000006551c19487814612e58FE06813775758';
const ERC6551_IMPL     = '0x878E703A93b6e0aaD92f9907332c68fb09765697';
const ZERO_SALT        = '0x' + '00'.repeat(32);
const CHONK_CONTRACT   = getAddress('0x07152bfde079b5319e5308C43fB1DBc9C76CB4f9');
const POWNFT_CONTRACT  = getAddress('0x9abb7bddc43fa67c76a62d8c016513827f59be1b');

const abi = [{ name: 'account', type: 'function', inputs: [
  { name: 'implementation', type: 'address' },
  { name: 'salt',           type: 'bytes32' },
  { name: 'chainId',        type: 'uint256' },
  { name: 'tokenContract',  type: 'address' },
  { name: 'tokenId',        type: 'uint256' },
], outputs: [{ name: 'account', type: 'address' }], stateMutability: 'view' }];

const client = createPublicClient({ chain: gnosis, transport: http() });

const [tba681, tba676, tba158] = await Promise.all([
  client.readContract({ address: ERC6551_REGISTRY, abi, functionName: 'account',
    args: [ERC6551_IMPL, ZERO_SALT, 8453n, CHONK_CONTRACT, 681n] }),
  client.readContract({ address: ERC6551_REGISTRY, abi, functionName: 'account',
    args: [ERC6551_IMPL, ZERO_SALT, 8453n, CHONK_CONTRACT, 676n] }),
  client.readContract({ address: ERC6551_REGISTRY, abi, functionName: 'account',
    args: [ERC6551_IMPL, ZERO_SALT, 1n,    POWNFT_CONTRACT, 158n] }),
]);

console.log('chonk.681 Gnosis TBA:', tba681);
console.log('chonk.676 Gnosis TBA:', tba676);
console.log('atom.158  Gnosis TBA:', tba158);
