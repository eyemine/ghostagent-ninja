// Compute the deterministic Safe address for chonk.681
// createSafeForByoMolt(label='chonk.681', ownerWallet=tbaAddress|EOA)
import { createPublicClient, http, getAddress, encodeFunctionData, keccak256, encodePacked } from 'viem';
import { gnosis } from 'viem/chains';

const SAFE_PROXY_FACTORY = getAddress('0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2');
const SAFE_SINGLETON     = getAddress('0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552');
const SAFE_FALLBACK      = getAddress('0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4');
const TBA_681            = getAddress('0x50416b618a3eAc9236a40B65BCbc958b696e999c');
const EOA                = getAddress('0xf251Ca37a80200f7AfefF398DA0338f4C1f01249');
const LABEL              = 'chonk.681';

const SafeSetupABI = [{ name: 'setup', type: 'function', inputs: [
  { name: '_owners',         type: 'address[]' },
  { name: '_threshold',      type: 'uint256' },
  { name: 'to',              type: 'address' },
  { name: 'data',            type: 'bytes' },
  { name: 'fallbackHandler', type: 'address' },
  { name: 'paymentToken',    type: 'address' },
  { name: 'payment',         type: 'uint256' },
  { name: 'paymentReceiver', type: 'address' },
], outputs: [], stateMutability: 'nonpayable' }];

const FactoryABI = [{ name: 'calculateCreateProxyWithNonceAddress', type: 'function', inputs: [
  { name: '_singleton', type: 'address' },
  { name: 'initializer', type: 'bytes' },
  { name: 'saltNonce', type: 'uint256' },
], outputs: [{ name: 'proxy', type: 'address' }], stateMutability: 'nonpayable' }];

const client = createPublicClient({ chain: gnosis, transport: http() });

// Try both: TBA as owner (new code) and EOA as owner (old code)
for (const owner of [TBA_681, EOA]) {
  const setupData = encodeFunctionData({
    abi: SafeSetupABI,
    functionName: 'setup',
    args: [
      [owner],
      1n,
      '0x0000000000000000000000000000000000000000',
      '0x',
      SAFE_FALLBACK,
      '0x0000000000000000000000000000000000000000',
      0n,
      '0x0000000000000000000000000000000000000000',
    ],
  });
  const saltNonce = BigInt(keccak256(encodePacked(['string', 'address'], [LABEL, owner])));
  try {
    const predicted = await client.readContract({
      address: SAFE_PROXY_FACTORY, abi: FactoryABI,
      functionName: 'calculateCreateProxyWithNonceAddress',
      args: [SAFE_SINGLETON, setupData, saltNonce],
    });
    const code = await client.getBytecode({ address: predicted });
    const deployed = !!(code && code !== '0x');
    console.log(`owner=${owner} → Safe=${predicted} deployed=${deployed}`);
  } catch (e) {
    console.log(`owner=${owner} → error: ${e.message}`);
  }
}
