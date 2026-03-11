/**
 * ERC-8004 Identity Registry — register(agentURI) on Base Sepolia
 *
 * Usage:
 *   node scripts/erc8004-register.mjs <agentName>
 *   e.g. node scripts/erc8004-register.mjs ghostagent
 *
 * Reads PRIVATE_KEY from .env
 * Writes agentId back to worker KV via storeErc8004AgentId action
 *
 * Contract: https://github.com/erc-8004/erc-8004-contracts
 * Base Sepolia deployment: 0x37f99bD5a96b52E12bfC9E01Abf2EB4e8Be028Ef
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env manually (no dotenv dependency)
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
const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

// ERC-8004 Identity Registry on Gnosis Mainnet
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const CHAIN_ID = 100; // Gnosis

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function setMetadata(uint256 agentId, string key, bytes value)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

async function main() {
  const agentName = process.argv[2];
  if (!agentName) {
    console.error('Usage: node scripts/erc8004-register.mjs <agentName>');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`\n🔑 Registering agent: ${agentName}`);
  console.log(`   Owner:    ${account.address}`);
  console.log(`   Chain:    Base Sepolia (${CHAIN_ID})`);
  console.log(`   Registry: ${ERC8004_IDENTITY_REGISTRY}`);

  const agentURI = `${APP_URL}/api/agent/${agentName}/registration.json`;
  console.log(`   agentURI: ${agentURI}`);

  // Verify the agentURI is reachable before registering
  console.log('\n⏳ Verifying agentURI is live...');
  try {
    const check = await fetch(agentURI);
    if (!check.ok) {
      console.warn(`   ⚠️  agentURI returned ${check.status} — registration.json endpoint may not be deployed yet`);
      console.warn('   Continuing anyway (Netlify may need a redeploy)...');
    } else {
      const json = await check.json();
      console.log(`   ✓ agentURI live — type: ${json.type || 'unknown'}`);
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not reach agentURI: ${e.message}`);
  }

  const walletClient = createWalletClient({
    account,
    chain: gnosis,
    transport: http('https://rpc.gnosischain.com'),
  });

  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http('https://rpc.gnosischain.com'),
  });

  console.log('\n⏳ Sending register() transaction...');
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: ERC8004_IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [agentURI],
    });
  } catch (err) {
    console.error('❌ Transaction failed:', err.shortMessage || err.message);
    process.exit(1);
  }

  console.log(`   Tx: ${txHash}`);
  console.log('   Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  // Decode Transfer event (ERC-721 mint: from=0x0) to get tokenId = agentId
  let agentId = null;
  for (const log of receipt.logs) {
    try {
      const decoded = publicClient.decodeEventLog({
        abi: IDENTITY_REGISTRY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Transfer' && decoded.args.from === '0x0000000000000000000000000000000000000000') {
        agentId = Number(decoded.args.tokenId);
        break;
      }
    } catch {}
  }

  if (agentId === null) {
    // Fallback: parse from last log (agentId is typically the first indexed arg)
    const lastLog = receipt.logs[receipt.logs.length - 1];
    if (lastLog?.topics?.[1]) {
      agentId = parseInt(lastLog.topics[1], 16);
    }
  }

  if (agentId === null) {
    console.error('❌ Could not decode agentId from receipt logs');
    process.exit(1);
  }

  console.log(`\n✅ ERC-8004 agentId: ${agentId}`);

  // Store agentId back in worker KV
  console.log('\n⏳ Storing agentId in worker KV...');
  try {
    const storeRes = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'setErc8004AgentId',
        agentName,
        erc8004AgentId: agentId,
        agentURI,
      }),
    });
    if (storeRes.ok) {
      console.log('   ✓ Stored in KV — Audit Card will now show ERC-8004 agentId');
    } else {
      const err = await storeRes.text();
      console.warn(`   ⚠️  KV store failed: ${err}`);
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not store agentId in worker KV: ${e.message}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Agent:     ${agentName}
  agentId:   ${agentId}
  agentURI:  ${agentURI}
  Registry:  eip155:100:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
  Tx:        ${txHash}
  Explorer:  https://gnosisscan.io/tx/${txHash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next steps:
  1. Run Validation Registry call:
     node scripts/erc8004-validate.mjs ${agentName} ${agentId}

  2. Run Reputation Registry call:
     node scripts/erc8004-reputation.mjs ${agentName} ${agentId}

  3. Check Audit Card — agentId should appear once Netlify redeploys.
`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
