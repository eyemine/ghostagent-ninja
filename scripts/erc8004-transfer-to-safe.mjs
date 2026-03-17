/**
 * ERC-8004 Identity Token — transfer agentId NFT to agent's Gnosis Safe
 *
 * Usage:
 *   node scripts/erc8004-transfer-to-safe.mjs <agentId> <safeAddress> [--gnosis|--base-sepolia]
 *
 * Examples:
 *   # Transfer agentId 1766 to Safe on Base Sepolia
 *   node scripts/erc8004-transfer-to-safe.mjs 1766 0xYourSafeAddress --base-sepolia
 *
 *   # Transfer agentId 3184 to Safe on Gnosis mainnet
 *   node scripts/erc8004-transfer-to-safe.mjs 3184 0xYourSafeAddress --gnosis
 *
 * The agentId ERC-721 is transferred from PRIVATE_KEY EOA → Safe.
 * All reputation history (giveFeedback) stays intact — it's indexed by agentId, not owner.
 */

import { createWalletClient, createPublicClient, http, parseAbi, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let envContent = '';
try { envContent = readFileSync(resolve(__dirname, '../.env.local'), 'utf8'); } catch {
  try { envContent = readFileSync(resolve(__dirname, '../.env'), 'utf8'); } catch {}
}
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const PRIVATE_KEY = env.PRIVATE_KEY || env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;

const REGISTRIES = {
  gnosis:      { chainId: 100,   address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', rpc: 'https://rpc.gnosischain.com',  explorer: 'https://gnosisscan.io' },
  baseSepolia: { chainId: 84532, address: '0x8004A818BFB912233c491871b3d84c89A494BD9e', rpc: 'https://sepolia.base.org',     explorer: 'https://sepolia.basescan.org' },
};

const ERC721_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

async function main() {
  const args       = process.argv.slice(2);
  const agentId    = Number(args.find(a => !a.startsWith('--') && !a.startsWith('0x')));
  const safeAddr   = args.find(a => a.startsWith('0x'));
  const useGnosis  = args.includes('--gnosis');
  const useBaseSep = args.includes('--base-sepolia');

  if (!agentId || !safeAddr || (!useGnosis && !useBaseSep)) {
    console.error('Usage: node scripts/erc8004-transfer-to-safe.mjs <agentId> <safeAddress> [--gnosis|--base-sepolia]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/erc8004-transfer-to-safe.mjs 1766 0xSafeAddr --base-sepolia');
    console.error('  node scripts/erc8004-transfer-to-safe.mjs 3184 0xSafeAddr --gnosis');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const net    = useGnosis ? REGISTRIES.gnosis : REGISTRIES.baseSepolia;
  const chain  = useGnosis ? gnosis : baseSepolia;
  const label  = useGnosis ? 'Gnosis Mainnet' : 'Base Sepolia';

  const account = privateKeyToAccount(PRIVATE_KEY);

  const publicClient = createPublicClient({ chain, transport: http(net.rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(net.rpc) });

  console.log(`\n🔍 ERC-8004 Token Transfer`);
  console.log(`   Chain:    ${label} (${net.chainId})`);
  console.log(`   Registry: ${net.address}`);
  console.log(`   agentId:  ${agentId}`);
  console.log(`   From:     ${account.address} (your EOA)`);
  console.log(`   To:       ${safeAddr} (agent Safe)`);

  // Verify current owner
  let currentOwner;
  try {
    currentOwner = await publicClient.readContract({
      address: net.address,
      abi: ERC721_ABI,
      functionName: 'ownerOf',
      args: [BigInt(agentId)],
    });
    console.log(`\n   Current owner: ${currentOwner}`);
  } catch (e) {
    console.error(`❌ Could not read ownerOf(${agentId}): ${e.message}`);
    console.error('   Verify the agentId exists on this chain/registry.');
    process.exit(1);
  }

  if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ PRIVATE_KEY address (${account.address}) does not own agentId ${agentId}`);
    console.error(`   Current owner: ${currentOwner}`);
    process.exit(1);
  }

  if (currentOwner.toLowerCase() === safeAddr.toLowerCase()) {
    console.log(`\n✅ agentId ${agentId} is already owned by the Safe — nothing to do.`);
    process.exit(0);
  }

  // ── Activation tx FIRST — EOA still owns token, setMetadata authorized ───
  await sendActivationTx({ walletClient, publicClient, net, agentId, safeAddr, label });

  console.log(`\n⏳ Sending transferFrom() transaction...`);
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: net.address,
      abi: ERC721_ABI,
      functionName: 'transferFrom',
      args: [account.address, safeAddr, BigInt(agentId)],
    });
  } catch (err) {
    console.error('❌ Transaction failed:', err.shortMessage || err.message);
    process.exit(1);
  }

  console.log(`   Tx: ${txHash}`);
  console.log('   Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  // Verify new owner
  const newOwner = await publicClient.readContract({
    address: net.address,
    abi: ERC721_ABI,
    functionName: 'ownerOf',
    args: [BigInt(agentId)],
  });

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Transfer + activation complete
  agentId:   ${agentId}
  New owner: ${newOwner}
  Safe:      ${safeAddr}
  Chain:     ${label}
  Transfer:  ${net.explorer}/tx/${txHash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  All reputation history is preserved — giveFeedback() is
  indexed by agentId, not by token owner address.

  ⚠️  Note: future giveFeedback() calls still use RESPONDER_PRIVATE_KEY
  (a separate EOA). The Safe owns the identity token but reputation
  submissions come from any address — ownership is irrelevant for feedback.
`);
}

// ── Activation tx — setMetadata('activated') seeds on-chain telemetry ────────────
// Emits MetadataSet event in the IdentityRegistry — shows as confirmed agent activity
// on block explorers and telemetry dashboards. Non-fatal if it fails.
async function sendActivationTx({ walletClient, publicClient, net, agentId, safeAddr, label }) {
  console.log(`\n⏳ Sending activation tx — setMetadata('activated')...`);
  const payload = JSON.stringify({
    activatedAt: new Date().toISOString(),
    safeOwner:   safeAddr,
    chain:       label,
    hello:       'GhostAgent activated',
  });
  const valueBytes = `0x${Buffer.from(new TextEncoder().encode(payload)).toString('hex')}`;

  try {
    const actTx = await walletClient.writeContract({
      address: net.address,
      abi: parseAbi(['function setMetadata(uint256 agentId, string key, bytes value)']),
      functionName: 'setMetadata',
      args: [BigInt(agentId), 'activated', valueBytes],
    });
    const actReceipt = await publicClient.waitForTransactionReceipt({ hash: actTx });
    console.log(`   ✓ Activation confirmed block ${actReceipt.blockNumber}`);
    console.log(`   Tx: ${net.explorer}/tx/${actTx}`);
  } catch (e) {
    console.warn(`   ⚠️  Activation tx failed (non-fatal): ${e.shortMessage || e.message}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
