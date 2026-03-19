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
import { baseSepolia } from 'viem/chains';
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

const PRIVATE_KEY           = env.PRIVATE_KEY           || process.env.PRIVATE_KEY;
const RESPONDER_PRIVATE_KEY = env.RESPONDER_PRIVATE_KEY  || process.env.RESPONDER_PRIVATE_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

// ERC-8004 Reputation Registry on Base Sepolia (hackathon chain)
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const CHAIN_ID = 84532;

const REPUTATION_REGISTRY_ABI = parseAbi([
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackGiven(uint256 indexed agentId, address indexed from, int128 value, string tag1, string tag2)',
]);

async function main() {
  const args      = process.argv.slice(2);
  const agentName = args.find(a => !a.startsWith('--'));
  const agentId   = Number(args.filter(a => !a.startsWith('--'))[1]);
  const isNeg     = args.includes('--negative');
  const useGnosis = args.includes('--gnosis');
  const useBase   = args.includes('--base');
  // default chain: base-sepolia (hackathon chain)

  if (!agentName || isNaN(agentId)) {
    console.error('Usage: node scripts/erc8004-reputation.mjs <agentName> <agentId> [--negative] [--gnosis|--base|--base-sepolia]');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  if (!RESPONDER_PRIVATE_KEY) {
    console.error('Missing RESPONDER_PRIVATE_KEY — giveFeedback cannot come from the agent owner (self-feedback not allowed).');
    console.error('Add RESPONDER_PRIVATE_KEY=<burner_key> to .env.local and fund the address with 0.01 xDAI.');
    process.exit(1);
  }

  const account = privateKeyToAccount(RESPONDER_PRIVATE_KEY);

  // Chain selection
  const { chain, rpc, explorer, reputationRegistry, chainId } = useGnosis
    ? { chain: (await import('viem/chains')).gnosis,      rpc: 'https://rpc.gnosischain.com', explorer: 'https://gnosisscan.io',       reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713', chainId: 100   }
    : useBase
    ? { chain: (await import('viem/chains')).base,        rpc: 'https://mainnet.base.org',    explorer: 'https://basescan.org',        reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713', chainId: 8453  }
    : { chain: (await import('viem/chains')).baseSepolia, rpc: 'https://sepolia.base.org',    explorer: 'https://sepolia.basescan.org',reputationRegistry: ERC8004_REPUTATION_REGISTRY,                   chainId: 84532 };

  // Fetch live agent status to build feedback URI with real telemetry
  let surgeScore = 0;
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAgentStatus', localPart: `${agentName}_` }),
    });
    if (res.ok) {
      const data = await res.json();
      surgeScore = data.surgeScore ?? 0;
    }
  } catch {}

  // Feedback URI — links to public audit card data
  const feedbackURI = `${APP_URL}/api/agent-lookup?q=${agentName}_`;
  const feedbackHash = keccak256(toBytes(feedbackURI));

  // value: int128. Scale: 2 decimals (100 = 1.00, -100 = -1.00)
  // Negative: fixed -75 (flagged bad actor). Positive: surgeScore-based, min 50.
  const reputationValue = isNeg
    ? -75
    : Math.max(50, Math.min(100, Math.round(surgeScore || 75)));

  const tag1 = isNeg ? 'fraud'  : 'A2A';
  const tag2 = isNeg ? 'badActor' : 'email';

  // Endpoint: the agent's A2A service endpoint
  const endpoint = WORKER_URL;

  console.log(`\n${isNeg ? '🚨' : '⭐'} Reputation Feedback${isNeg ? ' — NEGATIVE' : ''}`);
  console.log(`   Agent:    ${agentName} (agentId: ${agentId})`);
  console.log(`   From:     ${account.address}`);
  console.log(`   Value:    ${reputationValue} (${reputationValue / 100} on 2-decimal scale)`);
  console.log(`   Tags:     ${tag1}, ${tag2}`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Chain:    ${useGnosis ? 'Gnosis' : useBase ? 'Base' : 'Base Sepolia'} (${chainId})`);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpc),
  });

  console.log('\n⏳ Sending giveFeedback() transaction...');
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: reputationRegistry,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: 'giveFeedback',
      args: [
        BigInt(agentId),
        BigInt(reputationValue),  // value
        2,                        // valueDecimals (so 75 = 0.75)
        tag1,                     // tag1
        tag2,                     // tag2
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
  Explorer:    ${explorer}/tx/${txHash}
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
