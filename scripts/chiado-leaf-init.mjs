#!/usr/bin/env node
/**
 * Register a single leaf on GhostAgentSpendCursor (Chiado, chainId 10200).
 *
 * Uses Tiago's static capabilityRoot + Merkle membership design:
 *   - No setSubcap / no numeric leafId
 *   - Budget is committed inside the leaf at registration time
 *   - Single-leaf: capRoot = leafHash, capProof = []
 *
 * Flow:
 *   1. Build Leaf { scopeId, subCap, asset, issuer }
 *   2. leafHash  = keccak256(abi.encode(scopeId, subCap, asset, issuer))
 *   3. capRoot   = leafHash  (single-leaf tree)
 *   4. call register(cursorId, capRoot)  — reverts if already registered
 *
 * Usage:
 *   CHIADO_RPC=https://rpc.chiadochain.net \
 *   AGENT_SPENDING_KEY=0x... \
 *   node scripts/chiado-leaf-init.mjs
 */
import { createWalletClient, createPublicClient, http, encodeAbiParameters, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosisChiado } from 'viem/chains';
import { config } from 'dotenv';
config();

const CURSOR_CONTRACT = '0x5235249f1409a315349036af4ea914a9efdb7cbf';

// ── Leaf parameters ─────────────────────────────────────────────────────────────
const CURSOR_SCOPE_ID = keccak256(new TextEncoder().encode('ghostagent-cursor-1'));
const SCOPE_ID        = keccak256(new TextEncoder().encode('default'));
const SUB_CAP         = BigInt('100000000000000000');   // 0.1 xDAI (matches DailyBudgetModule cap)
const ASSET           = '0x0000000000000000000000000000000000000000'; // native xDAI
const ISSUER          = '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5';

// ── Compute leaf hash and capabilityRoot ────────────────────────────────────────
const leafEncoded = encodeAbiParameters(
  [
    { name: 'scopeId', type: 'bytes32' },
    { name: 'subCap',  type: 'uint256' },
    { name: 'asset',   type: 'address' },
    { name: 'issuer',  type: 'bytes32' },
  ],
  [SCOPE_ID, SUB_CAP, ASSET, ISSUER],
);

const leafHash = keccak256(leafEncoded);
const capRoot  = leafHash;   // single-leaf: root = leaf hash

console.log('=== Leaf Registration ===');
console.log('cursorScopeId: ', CURSOR_SCOPE_ID);
console.log('scopeId:       ', SCOPE_ID);
console.log('subCap:        ', SUB_CAP.toString(), 'wei');
console.log('issuer:        ', ISSUER);
console.log('leafHash:      ', leafHash);
console.log('capRoot:       ', capRoot);
console.log('');

// ── ABI ─────────────────────────────────────────────────────────────────────────
const REGISTER_ABI = [{
  name: 'register',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'id',      type: 'bytes32' },
    { name: 'capRoot', type: 'bytes32' },
  ],
  outputs: [],
}];

const CAPABILITY_ROOT_ABI = [{
  name: 'capabilityRoot',
  type: 'function',
  stateMutability: 'view',
  inputs:  [{ name: 'id', type: 'bytes32' }],
  outputs: [{ name: '',   type: 'bytes32' }],
}];

// ── Setup ───────────────────────────────────────────────────────────────────────
const key = process.env.AGENT_SPENDING_KEY;
if (!key) { console.error('AGENT_SPENDING_KEY not set'); process.exit(1); }

const account = privateKeyToAccount(key);
const rpc     = process.env.CHIADO_RPC ?? 'https://rpc.chiadochain.net';

const publicClient = createPublicClient({ chain: gnosisChiado, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: gnosisChiado, transport: http(rpc) });

// ── Probe existing root ─────────────────────────────────────────────────────────
const existingRoot = await publicClient.readContract({
  address: CURSOR_CONTRACT, abi: CAPABILITY_ROOT_ABI,
  functionName: 'capabilityRoot', args: [CURSOR_SCOPE_ID],
}).catch(() => null);

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
if (existingRoot && existingRoot !== ZERO_BYTES32) {
  console.log('Cursor already registered. capabilityRoot =', existingRoot);
  if (existingRoot === capRoot) {
    console.log('Root matches our leaf — registration is complete.');
  } else {
    console.log('WARNING: existing root differs from our computed capRoot!');
    console.log('  Expected:', capRoot);
    console.log('  On-chain:', existingRoot);
  }
  process.exit(0);
}

// ── Register ────────────────────────────────────────────────────────────────────
console.log('Registering leaf on cursor', CURSOR_CONTRACT, '...');
const hash = await walletClient.writeContract({
  address: CURSOR_CONTRACT,
  abi: REGISTER_ABI,
  functionName: 'register',
  args: [CURSOR_SCOPE_ID, capRoot],
});

console.log('Tx:', hash);
console.log(`Explorer: https://gnosis-chiado.blockscout.com/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Status:', receipt.status);
if (receipt.status === 'success') {
  console.log('Leaf registered. Ready for draws against cursorScopeId:', CURSOR_SCOPE_ID);
}
