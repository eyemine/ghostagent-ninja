#!/usr/bin/env node
/**
 * Set the baseURI on FakeNormies ERC-721 contract to point at the
 * ghostagent.ninja metadata API endpoint.
 *
 * Before: tokenURI(0) = "ipfs://bafybei.../0"  ← 404, no metadata JSON
 * After:  tokenURI(0) = "https://ghostagent.ninja/api/nft-metadata/fakenormie/0"
 *
 * The API route at /api/nft-metadata/fakenormie/[tokenId] returns:
 *   { name, description, image, external_url, attributes }
 * with image served from /public/FakeNormies/SVGS/{padded}.svg
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... node scripts/set-fakenormie-base-uri.mjs
 *
 * Optional:
 *   BASE_URL=https://ghostagent.ninja   (override the app URL)
 *   DRY_RUN=1                           (print only, no tx)
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

const FAKENORMIES_CONTRACT = '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29';
const GNOSIS_RPC           = process.env.GNOSIS_RPC ?? 'https://rpc.gnosischain.com';
const BASE_URL             = process.env.BASE_URL   ?? 'https://ghostagent.ninja';
const DRY_RUN              = process.env.DRY_RUN === '1';

const NEW_BASE_URI = `${BASE_URL}/api/nft-metadata/fakenormie/`;

const ABI = [
  {
    name: 'setBaseURI',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newBaseURI', type: 'string' }],
    outputs: [],
  },
  {
    name: 'tokenURI',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
];

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) { console.error('DEPLOYER_PRIVATE_KEY required'); process.exit(1); }

  const account      = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: gnosis, transport: http(GNOSIS_RPC) });
  const walletClient = createWalletClient({ chain: gnosis, transport: http(GNOSIS_RPC), account });

  console.log(`\nFakeNormies setBaseURI${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`Contract:    ${FAKENORMIES_CONTRACT}`);
  console.log(`Caller:      ${account.address}`);
  console.log(`New baseURI: ${NEW_BASE_URI}\n`);

  // ── Read current tokenURI(0) to show before state ──
  try {
    const current = await publicClient.readContract({
      address: FAKENORMIES_CONTRACT,
      abi: ABI,
      functionName: 'tokenURI',
      args: [0n],
    });
    console.log(`Current tokenURI(0): ${current}`);
  } catch {
    console.warn('Could not read current tokenURI(0)');
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would call setBaseURI("${NEW_BASE_URI}")`);
    console.log(`[DRY RUN] After: tokenURI(0) → ${NEW_BASE_URI}0`);
    console.log(`[DRY RUN] After: tokenURI(5) → ${NEW_BASE_URI}5`);
    return;
  }

  console.log('\nSubmitting setBaseURI transaction...');
  const txHash = await walletClient.writeContract({
    address: FAKENORMIES_CONTRACT,
    abi: ABI,
    functionName: 'setBaseURI',
    args: [NEW_BASE_URI],
  });

  console.log(`Tx: ${txHash}`);
  console.log(`Explorer: https://gnosisscan.io/tx/${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === 'success') {
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // Verify
    const after = await publicClient.readContract({
      address: FAKENORMIES_CONTRACT,
      abi: ABI,
      functionName: 'tokenURI',
      args: [0n],
    });
    console.log(`\nVerification — tokenURI(0): ${after}`);

    console.log('\nNext steps:');
    console.log('  1. Deploy to Netlify (auto on push to main)');
    console.log(`  2. Test: curl "${NEW_BASE_URI}0"`);
    console.log('  3. Refresh on NiftyFair / OpenSea (may take 24h to re-index)');
  } else {
    console.error('✗ Transaction reverted');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
