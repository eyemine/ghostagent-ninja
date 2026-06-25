#!/usr/bin/env node
/**
 * Initialise the GhostAgentSpendCursor leaf on Chiado (chainId 10200).
 *
 * The cursor already has issuer key and Safe hardcoded at deploy time.
 * This script calls setSubcap(leafId, subcap) to activate the leaf
 * before the first draw can succeed.
 *
 * Run AFTER confirming leafId with blockbird (bytecode shows selector 0xd1cbe6bf).
 *
 * Usage:
 *   CHIADO_RPC=https://rpc.chiadochain.net \
 *   AGENT_SPENDING_KEY=0x... \
 *   node scripts/chiado-leaf-init.mjs
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosisChiado } from 'viem/chains';
import { config } from 'dotenv';
config();

const CURSOR    = '0x5235249f1409a315349036af4ea914a9efdb7cbf';
const SUBCAP    = BigInt('100000000000000000');  // 0.1 xDAI — matches DailyBudgetModule cap
const LEAF_ID   = 0n;                             // confirm with blockbird — likely 0 for single-leaf

// Selector 0xd1cbe6bf = setSubcap(uint256 leafId, uint256 subcap)
// Reverts with AlreadySet if called twice — idempotent-safe to probe first
const SET_SUBCAP_ABI = [{
  name: 'setSubcap',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'leafId', type: 'uint256' },
    { name: 'subcap', type: 'uint256' },
  ],
  outputs: [],
}];

const READ_SUBCAP_ABI = [{
  name: 'subcap',         // selector 0x4237ffa7 — reads mapping slot 0
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'leafId', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }],
}];

const key = process.env.AGENT_SPENDING_KEY;
if (!key) { console.error('AGENT_SPENDING_KEY not set'); process.exit(1); }

const account = privateKeyToAccount(key);
const rpc     = process.env.CHIADO_RPC ?? 'https://rpc.chiadochain.net';

const publicClient = createPublicClient({ chain: gnosisChiado, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: gnosisChiado, transport: http(rpc) });

// First: probe existing subcap
const existing = await publicClient.readContract({
  address: CURSOR, abi: READ_SUBCAP_ABI, functionName: 'subcap', args: [LEAF_ID],
}).catch(() => null);

if (existing !== null && existing > 0n) {
  console.log(`Leaf ${LEAF_ID} already initialized. subcap = ${existing} wei (${Number(existing)/1e18} xDAI)`);
  process.exit(0);
}

console.log(`Initializing leaf ${LEAF_ID} with subcap ${SUBCAP} wei on cursor ${CURSOR}...`);
const hash = await walletClient.writeContract({
  address: CURSOR,
  abi: SET_SUBCAP_ABI,
  functionName: 'setSubcap',
  args: [LEAF_ID, SUBCAP],
});

console.log('Tx:', hash);
console.log(`Explorer: https://gnosis-chiado.blockscout.com/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Status:', receipt.status);
