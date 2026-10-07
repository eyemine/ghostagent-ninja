/// Server-side ENS name guard: a label whose `label.eth` is registered on Ethereum
/// mainnet may only be minted (in any .gno namespace) to the wallet that owns it.
/// Handles NameWrapper-wrapped names (registry owner = NameWrapper → read ownerOf).

import { createPublicClient, http, namehash, type Address } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;
const NAME_WRAPPER = '0xD4416b13d2b3a9aBAE7AcD5D6C2BbDBE25686401' as const;
const ZERO = '0x0000000000000000000000000000000000000000';

const OWNER_ABI = [{
  name: 'owner', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }],
}] as const;
const OWNER_OF_ABI = [{
  name: 'ownerOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'address' }],
}] as const;

const ethClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || 'https://ethereum.publicnode.com'),
});

/** Effective owner of `label.eth`, or null if unregistered. Throws if the lookup fails. */
export async function ensOwner(label: string): Promise<Address | null> {
  const node = namehash(`${label}.eth`);
  const owner = await ethClient.readContract({ address: ENS_REGISTRY, abi: OWNER_ABI, functionName: 'owner', args: [node] });
  if (!owner || owner === ZERO) return null;
  if (owner.toLowerCase() !== NAME_WRAPPER.toLowerCase()) return owner;
  const wrapped = await ethClient.readContract({ address: NAME_WRAPPER, abi: OWNER_OF_ABI, functionName: 'ownerOf', args: [BigInt(node)] });
  return wrapped && wrapped !== ZERO ? wrapped : null;
}

export type EnsGuardResult =
  | { allowed: true; ensOwner: Address | null }
  | { allowed: false; ensOwner: Address | null; reason: string };

/** Fails closed: if ENS cannot be checked, the mint is refused. */
export async function checkEnsGuard(label: string, wallet: string): Promise<EnsGuardResult> {
  let owner: Address | null;
  try {
    owner = await ensOwner(label);
  } catch {
    return { allowed: false, ensOwner: null, reason: 'ENS lookup failed — please try again.' };
  }
  if (!owner || owner.toLowerCase() === wallet.toLowerCase()) return { allowed: true, ensOwner: owner };
  return {
    allowed: false,
    ensOwner: owner,
    reason: `${label}.eth is registered to another wallet — only its ENS owner can mint "${label}".`,
  };
}
