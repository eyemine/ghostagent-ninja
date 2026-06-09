/**
 * Delegate V2 (delegate.xyz) ownership verification.
 *
 * Allows a hot wallet to act on behalf of a cold-storage vault wallet
 * when claiming NFT-gated features (Pair My NFT, nftmail.box inbox).
 *
 * Registry V2: 0x00000000000000447e69651d841bD8D104Bed493
 * Same address on Ethereum mainnet, Base, Gnosis, and most EVM chains.
 * (V1 was 0x00000000000076A84feF008CDAEE9090904FC7cd — do not use)
 *
 * Usage:
 *   const result = await checkDelegateForERC721({
 *     hotWallet:    '0xHot...',
 *     vaultWallet:  '0xCold...',
 *     contract:     '0xNFTContract...',
 *     tokenId:      '697',
 *     rpcUrl:       'https://mainnet.base.org',
 *   });
 *   if (result.isDelegated) { ... }
 */

export const DELEGATE_REGISTRY_V2 = '0x00000000000000447e69651d841bD8D104Bed493';

// checkDelegateForERC721(address delegate, address vault, address contract_, uint256 tokenId, bytes32 rights) → bool
// selector: keccak256("checkDelegateForERC721(address,address,address,uint256,bytes32)")[0:4]
// = 0xb9f36874
const CHECK_DELEGATE_SELECTOR = '0xb9f36874';
const EMPTY_RIGHTS = '0000000000000000000000000000000000000000000000000000000000000000'; // bytes32(0)

function encodeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

function encodeUint256(val: string | bigint): string {
  return BigInt(val).toString(16).padStart(64, '0');
}

export interface DelegateCheckParams {
  hotWallet:   string;
  vaultWallet: string;
  contract:    string;
  tokenId:     string | bigint;
  rpcUrl:      string;
}

export interface DelegateCheckResult {
  isDelegated:  boolean;
  vaultWallet:  string;
  hotWallet:    string;
  error?:       string;
}

/**
 * Check if `hotWallet` is an authorised delegate for `vaultWallet` over a specific ERC-721 token.
 * Non-throwing — returns isDelegated: false on any error.
 */
export async function checkDelegateForERC721({
  hotWallet,
  vaultWallet,
  contract,
  tokenId,
  rpcUrl,
}: DelegateCheckParams): Promise<DelegateCheckResult> {
  try {
    const calldata =
      CHECK_DELEGATE_SELECTOR +
      encodeAddress(hotWallet) +
      encodeAddress(vaultWallet) +
      encodeAddress(contract) +
      encodeUint256(tokenId) +
      EMPTY_RIGHTS;

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: DELEGATE_REGISTRY_V2, data: calldata }, 'latest'],
      }),
    });

    const data = await res.json() as { result?: string; error?: unknown };
    if (!data.result || data.result === '0x') {
      return { isDelegated: false, hotWallet, vaultWallet };
    }

    // result is a 32-byte bool: non-zero = true
    const isDelegated = BigInt(data.result) !== 0n;
    return { isDelegated, hotWallet, vaultWallet };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { isDelegated: false, hotWallet, vaultWallet, error };
  }
}

/**
 * Extended ownership check: direct owner OR authorised delegate.
 *
 * Returns:
 *   verified:      true if connectedWallet owns or is delegated for the token
 *   actualOwner:   the on-chain owner address
 *   viaDelegate:   true if access is granted via delegation (not direct ownership)
 *   vaultWallet:   the cold wallet (only set when viaDelegate=true)
 */
export async function verifyOwnershipOrDelegate(params: {
  contract:        string;
  tokenId:         string;
  rpcUrl:          string;
  connectedWallet: string;
  vaultWallet?:    string; // optional — provided by UI "vault login" input
}): Promise<{
  verified:     boolean;
  actualOwner:  string | null;
  viaDelegate:  boolean;
  vaultWallet:  string | null;
  error?:       string;
}> {
  const { contract, tokenId, rpcUrl, connectedWallet, vaultWallet } = params;

  // ── Step 1: direct ownerOf check ──────────────────────────────────────────
  let actualOwner: string | null = null;
  try {
    const tokenIdHex = BigInt(tokenId).toString(16).padStart(64, '0');
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: contract, data: '0x6352211e' + tokenIdHex }, 'latest'],
      }),
    });
    const data = await res.json() as { result?: string };
    if (data.result && data.result !== '0x') {
      actualOwner = ('0x' + data.result.slice(26)).toLowerCase();
    }
  } catch {
    // fall through to delegate check
  }

  if (actualOwner === connectedWallet.toLowerCase()) {
    return { verified: true, actualOwner, viaDelegate: false, vaultWallet: null };
  }

  // ── Step 2: delegate check (only if vaultWallet provided or actualOwner known) ──
  const vault = vaultWallet?.toLowerCase() ?? actualOwner;
  if (vault && vault !== connectedWallet.toLowerCase()) {
    const delegateResult = await checkDelegateForERC721({
      hotWallet:   connectedWallet,
      vaultWallet: vault,
      contract,
      tokenId,
      rpcUrl,
    });
    if (delegateResult.isDelegated) {
      return { verified: true, actualOwner, viaDelegate: true, vaultWallet: vault };
    }
  }

  return {
    verified:    false,
    actualOwner,
    viaDelegate: false,
    vaultWallet: null,
    error:       actualOwner
      ? `Wallet is not owner or delegate for this token (owner: ${actualOwner})`
      : `Token #${tokenId} not found on-chain`,
  };
}
