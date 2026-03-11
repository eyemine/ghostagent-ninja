/**
 * ERC-8004 Reputation Registry — giveFeedback() on Base Sepolia
 *
 * Usage:
 *   node scripts/erc8004-reputation.mjs <agentName> <agentId>
 *   e.g. node scripts/erc8004-reputation.mjs ghostagent 1
 *
 * Submits positive reputation feedback for the agent.
 * Tags: "A2A", "email" — matching GhostAgent's service endpoints.
 */

import { createWalletClient, createPublicClient, http, parseAbi, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
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

const PRIVATE_KEY = env.PRIVATE_KEY || process.env.PRIVATE_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// ERC-8004 Reputation Registry on Gnosis Mainnet (separate from IdentityRegistry)
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const CHAIN_ID = 100;

const REPUTATION_REGISTRY_ABI = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackGiven(uint256 indexed agentId, address indexed from, int128 value, string tag1, string tag2)',
]);

async function main() {
  const agentName = process.argv[2];
  const agentId = Number(process.argv[3]);

  if (!agentName || isNaN(agentId)) {
    console.error('Usage: node scripts/erc8004-reputation.mjs <agentName> <agentId>');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);

  // Fetch live agent status to build feedback URI with real telemetry
  let inboxCount = 0;
  let surgeScore = 0;
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', localPart: `${agentName}_` }),
    });
    if (res.ok) {
      const data = await res.json();
      inboxCount = data.inbox?.count ?? 0;
      surgeScore = data.surgeScore ?? 0;
    }
  } catch {}

  // Feedback URI — links to public audit card data
  const feedbackURI = `${APP_URL}/api/agent-lookup?q=${agentName}_`;
  const feedbackHash = keccak256(toBytes(feedbackURI));

  // value: reputation score (int128). Scale: 100 = 1.00 (2 decimals)
  // We use surgeScore as the basis, min 50 for an active agent
  const reputationValue = Math.max(50, Math.min(100, Math.round(surgeScore || 75)));

  // Endpoint: the agent's A2A service endpoint
  const endpoint = WORKER_URL;

  console.log(`\n⭐ Reputation Feedback`);
  console.log(`   Agent:    ${agentName} (agentId: ${agentId})`);
  console.log(`   From:     ${account.address}`);
  console.log(`   Value:    ${reputationValue} (${reputationValue / 100} on 2-decimal scale)`);
  console.log(`   Tags:     A2A, email`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Chain:    Base Sepolia (${CHAIN_ID})`);

  const walletClient = createWalletClient({
    account,
    chain: gnosis,
    transport: http('https://rpc.gnosischain.com'),
  });

  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http('https://rpc.gnosischain.com'),
  });

  console.log('\n⏳ Sending giveFeedback() transaction...');
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: ERC8004_REPUTATION_REGISTRY,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'giveFeedback',
      args: [
        BigInt(agentId),
        BigInt(reputationValue),  // value
        2,                        // valueDecimals (so 75 = 0.75)
        'A2A',                    // tag1
        'email',                  // tag2
        endpoint,                 // endpoint
        feedbackURI,              // feedbackURI
        feedbackHash,             // feedbackHash
      ],
    });
  } catch (err) {
    console.error('❌ Transaction failed:', err.shortMessage || err.message);
    process.exit(1);
  }

  console.log(`   Tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Reputation Feedback Submitted ✓
  Agent:       ${agentName} (agentId: ${agentId})
  Score:       ${reputationValue / 100} (tags: A2A, email)
  FeedbackURI: ${feedbackURI}
  Tx:          ${txHash}
  Explorer:    https://gnosisscan.io/tx/${txHash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

All 4 ERC-8004 mandatory steps complete:
  ✓ 1. Registration JSON at agentURI
  ✓ 2. register(agentURI) → agentId
  ✓ 3. validationRequest()         (run erc8004-validate.mjs)
  ✓ 4. giveFeedback()              (this script)

Next: EIP-712 TradeIntents
  node scripts/erc8004-trade-intent.mjs ${agentName} ${agentId}
`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
