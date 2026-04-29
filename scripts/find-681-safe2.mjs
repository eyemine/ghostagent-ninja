import { createPublicClient, http, getAddress, encodeFunctionData, keccak256, encodePacked, encodeAbiParameters, parseAbiParameters } from 'viem';
import { gnosis } from 'viem/chains';

const SAFE_PROXY_FACTORY = getAddress('0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2');
const SAFE_SINGLETON     = getAddress('0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552');
const SAFE_FALLBACK      = getAddress('0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4');
const TBA_681            = getAddress('0x50416b618a3eAc9236a40B65BCbc958b696e999c');
const EOA                = getAddress('0xf251Ca37a80200f7AfefF398DA0338f4C1f01249');
const LABEL              = 'chonk.681';

const SetupABI = [{ name: 'setup', type: 'function', inputs: [
  { name: '_owners',         type: 'address[]' },
  { name: '_threshold',      type: 'uint256' },
  { name: 'to',              type: 'address' },
  { name: 'data',            type: 'bytes' },
  { name: 'fallbackHandler', type: 'address' },
  { name: 'paymentToken',    type: 'address' },
  { name: 'payment',         type: 'uint256' },
  { name: 'paymentReceiver', type: 'address' },
], outputs: [], stateMutability: 'nonpayable' }];

// GnosisSafeProxy creation bytecode prefix (v1.3.0)
// The factory deploys: keccak256(abi.encodePacked(proxyCreationCode, abi.encode(singleton)))
// Then salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce))
// address = CREATE2(factory, 0xff, salt, keccak256(deploymentData))
// We'll use the factory's stored proxyCreationCodeHash from on-chain

const client = createPublicClient({ chain: gnosis, transport: http() });

// Simpler: just check code at both candidate addresses
for (const owner of [TBA_681, EOA]) {
  const setupData = encodeFunctionData({
    abi: SetupABI,
    functionName: 'setup',
    args: [[owner], 1n,
      '0x0000000000000000000000000000000000000000', '0x',
      SAFE_FALLBACK,
      '0x0000000000000000000000000000000000000000', 0n,
      '0x0000000000000000000000000000000000000000'],
  });
  const saltNonce = BigInt(keccak256(encodePacked(['string', 'address'], [LABEL, owner])));

  // Compute CREATE2 address manually
  // deploymentData = proxyCreationCode + abi.encode(singleton)
  // proxyCreationCode for GnosisSafe v1.3.0 factory 0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2
  const PROXY_CREATION_CODE = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008015156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b95264736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573730000000000000000';

  const deploymentData = PROXY_CREATION_CODE +
    encodeAbiParameters(parseAbiParameters('address'), [SAFE_SINGLETON]).slice(2);

  const salt = keccak256(encodePacked(
    ['bytes32', 'uint256'],
    [keccak256(setupData as `0x${string}`), saltNonce]
  ));

  const create2Address = getAddress('0x' + keccak256(
    ('0xff' + SAFE_PROXY_FACTORY.slice(2) + salt.slice(2) + keccak256(deploymentData as `0x${string}`).slice(2)) as `0x${string}`
  ).slice(26));

  const code = await client.getBytecode({ address: create2Address });
  const deployed = !!(code && code !== '0x');
  console.log(`owner=${owner.slice(0,10)}... → Safe=${create2Address} deployed=${deployed}`);
}
