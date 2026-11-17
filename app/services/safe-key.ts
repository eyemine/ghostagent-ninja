import { concat, decodeFunctionResult, encodeFunctionData, pad, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';

export const SAFE_KEY_ABI = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function removeOwner(address prevOwner,address owner,uint256 threshold)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
]);
export const TBA_EXECUTE_ABI = parseAbi([
  'function execute(address to,uint256 value,bytes data,uint8 operation) payable returns (bytes)',
]);

// Safe's prevalidated signature is valid only when the TBA itself calls the
// Safe. An EOA submitting these bytes cannot impersonate the TBA.
export function safeCallFromTba(tba: Address, to: Address, data: Hex = '0x'): Hex {
  const signature = concat([pad(tba, { size: 32 }), pad('0x', { size: 32 }), '0x01']);
  return encodeFunctionData({
    abi: SAFE_KEY_ABI, functionName: 'execTransaction',
    args: [to, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, signature],
  });
}

export async function verifySafeKeyExecution(
  client: PublicClient, safe: Address, tba: Address, nftOwner: Address,
): Promise<void> {
  const [owners, threshold] = await Promise.all([
    client.readContract({ address: safe, abi: SAFE_KEY_ABI, functionName: 'getOwners' }),
    client.readContract({ address: safe, abi: SAFE_KEY_ABI, functionName: 'getThreshold' }),
  ]);
  if (threshold !== 1n || !owners.some(owner => owner.toLowerCase() === tba.toLowerCase())) {
    throw new Error('Safe does not grant the key TBA execution authority.');
  }
  const probe = await client.simulateContract({
    address: tba, abi: TBA_EXECUTE_ABI, functionName: 'execute',
    args: [safe, 0n, safeCallFromTba(tba, nftOwner), 0], account: nftOwner,
  });
  const executed = decodeFunctionResult({
    abi: SAFE_KEY_ABI, functionName: 'execTransaction', data: probe.result,
  });
  if (!executed) throw new Error('Safe execution through the key TBA failed.');
}
