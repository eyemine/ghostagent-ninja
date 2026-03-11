/**
 * ERC-8004 Validation Registry — validationRequest() on Base Sepolia
 *
 * Usage:
 *   node scripts/erc8004-validate.mjs <agentName> <agentId>
 *   e.g. node scripts/erc8004-validate.mjs ghostagent 1
 *
 * Submits a validation request for the agent's registration.json
 * The validator can then call validationResponse() with a 0-100 score.
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

const PRIVATE_KEY = env.PRIVATE_KEY || process.env.PRIVATE_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';

// ERC-8004 Identity Registry on Base Sepolia (also handles validation requests)
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_VALIDATION_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const CHAIN_ID = 84532;

const VALIDATION_REGISTRY_ABI = parseAbi([
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) returns (bytes32 requestId)',
  'event ValidationRequested(bytes32 indexed requestId, uint256 indexed agentId, address indexed validator, string requestURI)',
]);

// Self-validator: the agent owner acts as initial validator
// In production this would be a third-party TEE or reputation service
const SELF_VALIDATOR_ADDRESS = null; // filled from account below

async function main() {
  const agentName = process.argv[2];
  const agentId = Number(process.argv[3]);

  if (!agentName || isNaN(agentId)) {
    console.error('Usage: node scripts/erc8004-validate.mjs <agentName> <agentId>');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const validatorAddress = account.address;

  // Request URI points to the agent's registration.json — this is what the validator will check
  const requestURI = `${APP_URL}/api/agent/${agentName}/registration.json`;
  // requestHash = keccak256 of the URI string
  const requestHash = keccak256(toBytes(requestURI));

  console.log(`\n🔍 Validation Request`);
  console.log(`   Agent:     ${agentName} (agentId: ${agentId})`);
  console.log(`   Validator: ${validatorAddress}`);
  console.log(`   RequestURI: ${requestURI}`);
  console.log(`   Hash:      ${requestHash}`);
  console.log(`   Chain:     Base Sepolia (${CHAIN_ID})`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  console.log('\n⏳ Sending validationRequest() transaction...');
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: ERC8004_VALIDATION_REGISTRY,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'validationRequest',
      args: [validatorAddress, BigInt(agentId), requestURI, requestHash],
    });
  } catch (err) {
    console.error('❌ Transaction failed:', err.shortMessage || err.message);
    process.exit(1);
  }

  console.log(`   Tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`   ✓ Confirmed in block ${receipt.blockNumber}`);

  // Decode requestId from event
  let requestId = null;
  for (const log of receipt.logs) {
    try {
      const decoded = publicClient.decodeEventLog({
        abi: VALIDATION_REGISTRY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'ValidationRequested') {
        requestId = decoded.args.requestId;
        break;
      }
    } catch {}
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Validation Request Submitted
  Agent:      ${agentName} (agentId: ${agentId})
  RequestId:  ${requestId ?? '(check logs)'}
  RequestURI: ${requestURI}
  Tx:         ${txHash}
  Explorer:   https://sepolia.basescan.org/tx/${txHash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next step: Run reputation feedback
  node scripts/erc8004-reputation.mjs ${agentName} ${agentId}
`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
