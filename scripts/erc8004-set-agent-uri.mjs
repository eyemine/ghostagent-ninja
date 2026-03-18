/**
 * ERC-8004 setAgentURI via Gnosis Safe (single-owner, threshold=1)
 *
 * Updates the tokenURI for an ERC-8004 agentId where the token is owned by a Safe.
 * The EOA (PRIVATE_KEY) must be the sole owner of the Safe.
 *
 * Usage:
 *   node scripts/erc8004-set-agent-uri.mjs <agentId> <newURI> [--chain gnosis|base|baseSepolia]
 *
 * Examples:
 *   node scripts/erc8004-set-agent-uri.mjs 3199 "https://ghostagent.ninja/api/agent-card?agent=ghostagent&sld=vault" --chain gnosis
 *   node scripts/erc8004-set-agent-uri.mjs 32756 "https://ghostagent.ninja/api/agent-card?agent=ghostagent&sld=vault" --chain base
 *   node scripts/erc8004-set-agent-uri.mjs 1766 "https://ghostagent.ninja/api/agent-card?agent=ghostagent&sld=vault" --chain baseSepolia
 */

import { createWalletClient, createPublicClient, http, parseAbi, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, base, baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
let envContent = '';
try { envContent = readFileSync(envPath, 'utf8'); } catch {
  try { envContent = readFileSync(resolve(__dirname, '../.env'), 'utf8'); } catch {}
}
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const PRIVATE_KEY = env.PRIVATE_KEY || process.env.PRIVATE_KEY;
const SAFE_ADDRESS = '0xb7e493e3d226f8fE722CC9916fF164B793af13F4';

const CHAINS = {
  gnosis:      { chainId: 100,   registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', rpc: 'https://rpc.gnosischain.com',  explorer: 'https://gnosisscan.io',              viemChain: gnosis      },
  base:        { chainId: 8453,  registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', rpc: 'https://mainnet.base.org',    explorer: 'https://basescan.org',               viemChain: base        },
  baseSepolia: { chainId: 84532, registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e', rpc: 'https://sepolia.base.org',   explorer: 'https://sepolia.basescan.org',        viemChain: baseSepolia },
};

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function setAgentURI(uint256 agentId, string agentURI)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
]);

// Gnosis Safe ABI — minimal execTransaction
const SAFE_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes memory signatures) payable returns (bool success)',
  'function getTransactionHash(address to, uint256 value, bytes calldata data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function nonce() view returns (uint256)',
]);

async function main() {
  const args      = process.argv.slice(2);
  const agentId   = args[0];
  const newUri    = args[1];
  const chainIdx  = args.indexOf('--chain');
  const chainKey  = chainIdx !== -1 ? args[chainIdx + 1] : 'gnosis';

  if (!agentId || !newUri) {
    console.error('Usage: node scripts/erc8004-set-agent-uri.mjs <agentId> <newURI> [--chain gnosis|base|baseSepolia]');
    process.exit(1);
  }

  const net = CHAINS[chainKey];
  if (!net) {
    console.error(`Unknown chain: ${chainKey}. Use gnosis, base, or baseSepolia`);
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env.local');
    process.exit(1);
  }

  const account      = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: net.viemChain, transport: http(net.rpc) });
  const walletClient = createWalletClient({ account, chain: net.viemChain, transport: http(net.rpc) });

  console.log(`\n⛓  Chain:    ${chainKey} (${net.chainId})`);
  console.log(`   Registry: ${net.registry}`);
  console.log(`   AgentId:  #${agentId}`);
  console.log(`   Safe:     ${SAFE_ADDRESS}`);
  console.log(`   EOA:      ${account.address}`);
  console.log(`   New URI:  ${newUri}`);

  // Verify current tokenURI
  const currentUri = await publicClient.readContract({
    address: net.registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'tokenURI',
    args: [BigInt(agentId)],
  });
  console.log(`\n   Current tokenURI: ${currentUri}`);

  // Verify owner
  const owner = await publicClient.readContract({
    address: net.registry, abi: IDENTITY_REGISTRY_ABI, functionName: 'ownerOf',
    args: [BigInt(agentId)],
  }).catch(() => null);
  console.log(`   Owner: ${owner}`);

  if (!owner) {
    console.error(`\n❌ Agent #${agentId} not found on ${chainKey}`);
    process.exit(1);
  }

  const ownerLower = owner.toLowerCase();
  const safeLower  = SAFE_ADDRESS.toLowerCase();
  const eoaLower   = account.address.toLowerCase();

  if (ownerLower === safeLower) {
    console.log('\n✓ Token owned by Safe — will use execTransaction');
    await execViaSafe(agentId, newUri, net, account, publicClient, walletClient);
  } else if (ownerLower === eoaLower) {
    console.log('\n✓ Token owned by EOA — will call setAgentURI directly');
    await execDirect(agentId, newUri, net, walletClient);
  } else {
    console.error(`\n❌ Token owned by ${owner} — not the Safe or EOA. Cannot update.`);
    process.exit(1);
  }
}

async function execDirect(agentId, newUri, net, walletClient) {
  const hash = await walletClient.writeContract({
    address: net.registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setAgentURI',
    args: [BigInt(agentId), newUri],
  });
  console.log(`\n✓ setAgentURI tx: ${net.explorer}/tx/${hash}`);
  console.log('  Waiting for confirmation...');
}

async function execViaSafe(agentId, newUri, net, account, publicClient, walletClient) {
  // Encode setAgentURI call
  const data = encodeFunctionData({
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setAgentURI',
    args: [BigInt(agentId), newUri],
  });

  // Get Safe nonce
  const safeNonce = await publicClient.readContract({
    address: SAFE_ADDRESS, abi: SAFE_ABI, functionName: 'nonce',
  });
  console.log(`   Safe nonce: ${safeNonce}`);

  // Get Safe tx hash to sign
  const safeTxHash = await publicClient.readContract({
    address: SAFE_ADDRESS,
    abi: SAFE_ABI,
    functionName: 'getTransactionHash',
    args: [
      net.registry,  // to
      0n,            // value
      data,          // data
      0,             // operation (Call)
      0n,            // safeTxGas
      0n,            // baseGas
      0n,            // gasPrice
      '0x0000000000000000000000000000000000000000', // gasToken
      '0x0000000000000000000000000000000000000000', // refundReceiver
      safeNonce,     // nonce
    ],
  });
  console.log(`   Safe tx hash: ${safeTxHash}`);

  // Sign with EOA (EIP-191 personal_sign over the Safe tx hash)
  const sig = await account.signMessage({ message: { raw: safeTxHash } });

  // Adjust v: Safe expects v+4 for eth_sign signatures (v=31 or v=32)
  const sigHex = sig.slice(0, -2);
  const v = parseInt(sig.slice(-2), 16);
  const adjustedSig = sigHex + (v + 4).toString(16).padStart(2, '0');

  console.log('\n⏳ Submitting execTransaction...');
  const hash = await walletClient.writeContract({
    address: SAFE_ADDRESS,
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [
      net.registry,  // to
      0n,            // value
      data,          // data
      0,             // operation
      0n,            // safeTxGas
      0n,            // baseGas
      0n,            // gasPrice
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      adjustedSig,   // signatures
    ],
  });

  console.log(`\n✓ execTransaction tx: ${net.explorer}/tx/${hash}`);
  console.log('  Waiting for confirmation...');
  console.log(`\n  Verify: curl -s "https://ghostagent.ninja/api/erc8004/agent?id=${agentId}&chain=${Object.keys(CHAINS).find(k => CHAINS[k] === net)}" | python3 -m json.tool | grep tokenUri`);
}

main().catch(e => { console.error(e); process.exit(1); });
