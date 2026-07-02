#!/usr/bin/env node
/**
 * Cap enforcement revert test on GhostAgentSpendCursor (Chiado, chainId 10200).
 *
 * Reads current leafSpent, then attempts a draw of (remaining headroom + 1 wei).
 * The advanceCursor call MUST revert — if it succeeds the cap is broken.
 *
 * Usage:
 *   AGENT_SPENDING_KEY=0x... node scripts/chiado-cap-revert-test.mjs
 */
import { createWalletClient, createPublicClient, http, encodeAbiParameters, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosisChiado } from 'viem/chains';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { config } from 'dotenv';
config();

const CURSOR_CONTRACT = '0x5235249f1409a315349036af4ea914a9efdb7cbf';
const CURSOR_SCOPE_ID = keccak256(new TextEncoder().encode('ghostagent-cursor-1'));
const SCOPE_ID        = keccak256(new TextEncoder().encode('default'));
const SUB_CAP         = BigInt('100000000000000000');   // 0.1 xDAI
const ASSET           = '0x0000000000000000000000000000000000000000';
const ISSUER          = '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5';
const SAFE_ADDRESS    = '0xb7e493e3d226f8fe722cc9916ff164b793af13f4';
const PAYEE           = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function pad32(bytes) {
  if (bytes.length === 32) return bytes;
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

const LEAF_SPENT_ABI = [{
  name: 'leafSpent', type: 'function', stateMutability: 'view',
  inputs:  [{ name: 'id', type: 'bytes32' }, { name: 'scopeId', type: 'bytes32' }],
  outputs: [{ name: '',   type: 'uint256' }],
}];
const ADVANCE_ABI = [{
  name: 'advanceCursor', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'id', type: 'bytes32' }, { name: 'encodedWitness', type: 'bytes' }],
  outputs: [],
}];

const key = process.env.AGENT_SPENDING_KEY;
if (!key) { console.error('AGENT_SPENDING_KEY not set'); process.exit(1); }

const privKeyBytes = hexToBytes(key);
const pubkeyBytes  = schnorr.getPublicKey(privKeyBytes);
const px           = bytesToHex(pubkeyBytes);

const account      = privateKeyToAccount(key);
const rpc          = process.env.CHIADO_RPC ?? 'https://rpc.chiadochain.net';
const publicClient = createPublicClient({ chain: gnosisChiado, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: gnosisChiado, transport: http(rpc) });

// ── Read current state ───────────────────────────────────────────────────────────
const leafSpent = await publicClient.readContract({
  address: CURSOR_CONTRACT, abi: LEAF_SPENT_ABI,
  functionName: 'leafSpent', args: [CURSOR_SCOPE_ID, SCOPE_ID],
}).catch(() => 0n);

const headroom   = SUB_CAP - leafSpent;
const overAmount = headroom + 1n;   // 1 wei over the cap — must revert

console.log('=== Cap Revert Test ===');
console.log(`SUB_CAP:       ${SUB_CAP.toString()} wei (${Number(SUB_CAP)/1e18} xDAI)`);
console.log(`leafSpent:     ${leafSpent.toString()} wei (${Number(leafSpent)/1e18} xDAI)`);
console.log(`headroom:      ${headroom.toString()} wei (${Number(headroom)/1e18} xDAI)`);
console.log(`attempt draw:  ${overAmount.toString()} wei — SHOULD REVERT`);
console.log('');

// ── Build witness for the over-cap draw ─────────────────────────────────────────
const SESSION_ID  = `cap-revert-test-${Date.now()}`;
const CHAIN_ID    = '10200';
const nonceInput  = new TextEncoder().encode(
  `${SAFE_ADDRESS}:${PAYEE.toLowerCase()}:${overAmount.toString()}:${SESSION_ID}`
);
const nonce       = bytesToHex(sha256(nonceInput));

const preimageObj = {
  amountWei:   overAmount.toString(),
  chainId:     CHAIN_ID,
  cursorId:    CURSOR_CONTRACT.toLowerCase(),
  nonce,
  payee:       PAYEE.toLowerCase(),
  safeAddress: SAFE_ADDRESS.toLowerCase(),
};
const canonicalJson  = JSON.stringify(
  Object.fromEntries(Object.entries(preimageObj).sort(([a],[b]) => a.localeCompare(b)))
);
const preimageBytes  = new TextEncoder().encode(canonicalJson);
const sigBytes       = schnorr.sign(sha256(preimageBytes), privKeyBytes);
const rx             = bytesToHex(pad32(sigBytes.slice(0, 32)));
const s              = bytesToHex(pad32(sigBytes.slice(32, 64)));

const receiptProof = encodeAbiParameters(
  [{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'address'},{type:'bytes32'},{type:'address'},{type:'address'}],
  [px, rx, s, CURSOR_CONTRACT, nonce, PAYEE, SAFE_ADDRESS]
);

const encodedWitness = encodeAbiParameters(
  [{type:'tuple',components:[
    {name:'leaf',type:'tuple',components:[
      {name:'scopeId',type:'bytes32'},{name:'subCap',type:'uint256'},
      {name:'asset',type:'address'},{name:'issuer',type:'bytes32'},
    ]},
    {name:'capProof',type:'bytes32[]'},
    {name:'amount',type:'uint256'},
    {name:'receiptId',type:'bytes32'},
    {name:'receiptProof',type:'bytes'},
  ]}],
  [{
    leaf: { scopeId: SCOPE_ID, subCap: SUB_CAP, asset: ASSET, issuer: ISSUER },
    capProof: [],
    amount: overAmount,
    receiptId: nonce,
    receiptProof,
  }]
);

// ── Attempt the over-cap draw ────────────────────────────────────────────────────
console.log('Submitting over-cap advanceCursor (expect revert)...');
try {
  const hash = await walletClient.writeContract({
    address: CURSOR_CONTRACT, abi: ADVANCE_ABI,
    functionName: 'advanceCursor',
    args: [CURSOR_SCOPE_ID, encodedWitness],
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  console.error('❌ FAIL — transaction succeeded but should have reverted!');
  console.error('   Cap enforcement is BROKEN. Tx:', hash);
  process.exit(1);
} catch (err) {
  const msg = err.message ?? '';
  if (msg.includes('revert') || msg.includes('Reverted') || msg.includes('execution reverted')) {
    console.log('✅ PASS — advanceCursor reverted as expected. Cap is enforced.');
    console.log(`   Revert reason: ${msg.split('\n')[0]}`);
  } else {
    console.warn('⚠️  Unexpected error (not a revert):', msg.split('\n')[0]);
    process.exit(1);
  }
}

// ── Confirm leafSpent unchanged ──────────────────────────────────────────────────
const leafSpentAfter = await publicClient.readContract({
  address: CURSOR_CONTRACT, abi: LEAF_SPENT_ABI,
  functionName: 'leafSpent', args: [CURSOR_SCOPE_ID, SCOPE_ID],
}).catch(() => 0n);

if (leafSpentAfter === leafSpent) {
  console.log(`✅ leafSpent unchanged: ${leafSpent.toString()} wei — no state mutation on revert.`);
} else {
  console.error(`❌ leafSpent changed after revert! before=${leafSpent} after=${leafSpentAfter}`);
  process.exit(1);
}

console.log('\n=== Cap revert test complete ===');
