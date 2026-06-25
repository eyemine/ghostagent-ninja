#!/usr/bin/env node
/**
 * Run a single advanceCursor draw on GhostAgentSpendCursor (Chiado, chainId 10200).
 *
 * Prerequisites:
 *   - Leaf registered via chiado-leaf-init.mjs
 *   - AGENT_SPENDING_KEY set in .env (the BIP-340 key whose px = issuer)
 *
 * Usage:
 *   CHIADO_RPC=https://rpc.chiado.gnosis.gateway.fm \
 *   AGENT_SPENDING_KEY=0x... \
 *   node scripts/chiado-draw-test.mjs
 */
import { createWalletClient, createPublicClient, http, encodeAbiParameters, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosisChiado } from 'viem/chains';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { config } from 'dotenv';
config();

// ── Constants (must match registration) ────────────────────────────────────────
const CURSOR_CONTRACT = '0x5235249f1409a315349036af4ea914a9efdb7cbf';
const CURSOR_SCOPE_ID = keccak256(new TextEncoder().encode('ghostagent-cursor-1'));
const SCOPE_ID        = keccak256(new TextEncoder().encode('default'));
const SUB_CAP         = BigInt('100000000000000000');   // 0.1 xDAI
const ASSET           = '0x0000000000000000000000000000000000000000';
const ISSUER          = '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5';
const SAFE_ADDRESS    = '0xb7e493e3d226f8fe722cc9916ff164b793af13f4';
const PAYEE           = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // vitalik.eth — demo payee
const DRAW_AMOUNT     = BigInt('500000000000000');   // 0.0005 xDAI (well under subCap)
const CHAIN_ID        = '10200';
const SESSION_ID      = `demo-draw-${Date.now()}`;  // unique per run

// ── Helpers ─────────────────────────────────────────────────────────────────────
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

// ── Build spend witness ─────────────────────────────────────────────────────────
const key = process.env.AGENT_SPENDING_KEY;
if (!key) { console.error('AGENT_SPENDING_KEY not set'); process.exit(1); }

const privKeyBytes = hexToBytes(key);
const pubkeyBytes  = schnorr.getPublicKey(privKeyBytes);
const px           = bytesToHex(pubkeyBytes);

// Derive nonce: sha256("safeAddress:payee:amountWei:sessionId")
const nonceInput = new TextEncoder().encode(
  `${SAFE_ADDRESS}:${PAYEE.toLowerCase()}:${DRAW_AMOUNT.toString()}:${SESSION_ID}`
);
const nonce = bytesToHex(sha256(nonceInput));

// Canonical JSON preimage (sorted keys, no whitespace)
const preimageObj = {
  amountWei:   DRAW_AMOUNT.toString(),
  chainId:     CHAIN_ID,
  cursorId:    CURSOR_CONTRACT.toLowerCase(),
  nonce,
  payee:       PAYEE.toLowerCase(),
  safeAddress: SAFE_ADDRESS.toLowerCase(),
};
const canonicalJson = JSON.stringify(
  Object.fromEntries(Object.entries(preimageObj).sort(([a],[b]) => a.localeCompare(b)))
);
const preimageBytes = new TextEncoder().encode(canonicalJson);
const artifactHash  = bytesToHex(sha256(preimageBytes));

// BIP-340 sign
const sigBytes = schnorr.sign(sha256(preimageBytes), privKeyBytes);
const rx = bytesToHex(pad32(sigBytes.slice(0, 32)));
const s  = bytesToHex(pad32(sigBytes.slice(32, 64)));

// Inner receiptProof = abi.encode(px, rx, s, cursorId, nonce, payee, safeAddress)
const receiptProof = encodeAbiParameters(
  [{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'address'},{type:'bytes32'},{type:'address'},{type:'address'}],
  [px, rx, s, CURSOR_CONTRACT, nonce, PAYEE, SAFE_ADDRESS]
);

// receiptId = nonce (draw-once nullifier, same value)
const receiptId = nonce;

// ── Encode AdvanceWitness ────────────────────────────────────────────────────────
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
    amount: DRAW_AMOUNT,
    receiptId,
    receiptProof,
  }]
);

// ── ABI ─────────────────────────────────────────────────────────────────────────
const ADVANCE_ABI = [{
  name: 'advanceCursor',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'id',             type: 'bytes32' },
    { name: 'encodedWitness', type: 'bytes'   },
  ],
  outputs: [],
}];

const LEAF_SPENT_ABI = [{
  name: 'leafSpent',
  type: 'function',
  stateMutability: 'view',
  inputs:  [{ name: 'id', type: 'bytes32' }, { name: 'scopeId', type: 'bytes32' }],
  outputs: [{ name: '',   type: 'uint256' }],
}];

// ── Log params ──────────────────────────────────────────────────────────────────
console.log('=== Draw Test ===');
console.log('cursorScopeId:', CURSOR_SCOPE_ID);
console.log('amount:       ', DRAW_AMOUNT.toString(), 'wei');
console.log('nonce:        ', nonce);
console.log('receiptId:    ', receiptId);
console.log('artifactHash: ', artifactHash);
console.log('px:           ', px);
console.log('');

// ── Setup ───────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(key);
const rpc     = process.env.CHIADO_RPC ?? 'https://rpc.chiado.gnosis.gateway.fm';

const publicClient = createPublicClient({ chain: gnosisChiado, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: gnosisChiado, transport: http(rpc) });

// Pre-draw leafSpent
const spentBefore = await publicClient.readContract({
  address: CURSOR_CONTRACT, abi: LEAF_SPENT_ABI,
  functionName: 'leafSpent', args: [CURSOR_SCOPE_ID, SCOPE_ID],
}).catch(() => 0n);
console.log('leafSpent before:', spentBefore.toString(), 'wei');

// ── Draw ─────────────────────────────────────────────────────────────────────────
console.log('Submitting advanceCursor...');
const hash = await walletClient.writeContract({
  address: CURSOR_CONTRACT,
  abi: ADVANCE_ABI,
  functionName: 'advanceCursor',
  args: [CURSOR_SCOPE_ID, encodedWitness],
});

console.log('Tx:', hash);
console.log(`Explorer: https://gnosis-chiado.blockscout.com/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 3_000 });
console.log('Status:', receipt.status, '| block:', receipt.blockNumber.toString());

if (receipt.status === 'success') {
  const spentAfter = await publicClient.readContract({
    address: CURSOR_CONTRACT, abi: LEAF_SPENT_ABI,
    functionName: 'leafSpent', args: [CURSOR_SCOPE_ID, SCOPE_ID],
  }).catch(() => 0n);
  console.log('leafSpent after: ', spentAfter.toString(), 'wei');
  console.log(`Delta: +${(spentAfter - spentBefore).toString()} wei (${Number(spentAfter - spentBefore)/1e18} xDAI) ✅`);
}
