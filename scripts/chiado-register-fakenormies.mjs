#!/usr/bin/env node
/**
 * Batch-register ERC-8312 cursor leaves on Chiado for FakeNormies #0–5.
 *
 * For each token:
 *   1. Reads cursor[mandate] from ERC-8048 on Gnosis mainnet
 *   2. Derives subCap from mandate (matching getSubCapFromMandate in erc8048-publisher.ts)
 *   3. Computes capRoot = keccak256(abi.encode(leafScopeId, subCap, ZERO_ADDR, ISSUER))
 *      where leafScopeId = keccak256("default")
 *   4. Calls register(cursorScopeId, capRoot) on Chiado
 *      where cursorScopeId = keccak256("erc8048:fakenormie:N")
 *   5. Skips if leaf already registered (capRoot != NULL_ROOT)
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... node scripts/chiado-register-fakenormies.mjs
 *
 * Optional:
 *   TOKENS=0,1,2,3,4,5          (default: all 6)
 *   GNOSIS_RPC=https://...       (default: https://rpc.gnosischain.com)
 *   CHIADO_RPC=https://...       (default: https://rpc.chiado.gnosis.gateway.fm)
 *   DRY_RUN=1                   (print computed values, no on-chain writes)
 */

import { createWalletClient, createPublicClient, http, keccak256, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, gnosisChiado } from 'viem/chains';

// ── Constants (must match erc8048-publisher.ts exactly) ──────────────────────────

const CURSOR_CONTRACT  = '0x5235249f1409a315349036af4ea914a9efdb7cbf';
const ERC8048_REGISTRY = '0x0106341056a8790f4b924c380ed5B81B2a062bCE';
// CURSOR_ISSUER: 32-byte BIP-340 x-only pubkey (x-coordinate only, no prefix byte)
const CURSOR_ISSUER    = '0xb51441f05717e0321ac6c72271989bffd07a8a12c1364ccc51119c6ff46a80c5';
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';
const NULL_ROOT        = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Inner leaf scope — always "default" (matches dashboard handleApplyCeiling)
const LEAF_SCOPE_ID = keccak256(new TextEncoder().encode('default'));

// subCap per mandate (must match getSubCapFromMandate in erc8048-publisher.ts)
function getSubCap(mandate) {
  switch (mandate) {
    case 'restricted': return 1_000_000_000_000n;   // 0.000001 xDAI
    case 'worker':     return 20_000_000_000_000n;  // 0.00002  xDAI
    case 'executive':  return 100_000_000_000_000n; // 0.0001   xDAI
    default:           return 1_000_000_000_000n;   // fallback = restricted
  }
}

// ── ABIs ─────────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [{
  name: 'metadata', type: 'function', stateMutability: 'view',
  inputs:  [{ name: 'tokenId', type: 'uint256' }, { name: 'key', type: 'string' }],
  outputs: [{ name: '', type: 'bytes' }],
}];

const CURSOR_READ_ABI = [{
  name: 'capabilityRoot', type: 'function', stateMutability: 'view',
  inputs:  [{ name: 'id', type: 'bytes32' }],
  outputs: [{ name: '', type: 'bytes32' }],
}];

const REGISTER_ABI = [{
  name: 'register', type: 'function', stateMutability: 'nonpayable',
  inputs:  [{ name: 'id', type: 'bytes32' }, { name: 'capRoot', type: 'bytes32' }],
  outputs: [],
}];

// ── Helpers ──────────────────────────────────────────────────────────────────────

function decodeStringValue(hex) {
  try {
    const raw = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (!raw) return '';
    const arr = new Uint8Array(raw.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    return new TextDecoder().decode(arr);
  } catch { return ''; }
}

function computeCapRoot(subCap) {
  const leafEncoded = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
    [LEAF_SCOPE_ID, subCap, ZERO_ADDR, CURSOR_ISSUER],
  );
  return keccak256(leafEncoded);
}

// ── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) { console.error('DEPLOYER_PRIVATE_KEY required'); process.exit(1); }

  const dryRun   = process.env.DRY_RUN === '1';
  const tokenIds = (process.env.TOKENS ?? '0,1,2,3,4,5').split(',').map(t => parseInt(t.trim(), 10));
  const gnosisRpc = process.env.GNOSIS_RPC ?? 'https://rpc.gnosischain.com';
  const chiadoRpc = process.env.CHIADO_RPC ?? 'https://rpc.chiado.gnosis.gateway.fm';

  const account      = privateKeyToAccount(privateKey);
  const gnosisClient = createPublicClient({ chain: gnosis,       transport: http(gnosisRpc) });
  const chiadoClient = createPublicClient({ chain: gnosisChiado, transport: http(chiadoRpc) });
  const walletClient = createWalletClient({ chain: gnosisChiado, transport: http(chiadoRpc), account });

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FakeNormie Chiado Leaf Registrar${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`  Registering tokens: ${tokenIds.join(', ')}`);
  console.log(`  Caller: ${account.address}`);
  console.log(`${'═'.repeat(60)}\n`);

  const results = [];

  for (const tokenId of tokenIds) {
    console.log(`── FakeNormie #${tokenId} ─────────────────────────────────────`);

    // 1. Read mandate from ERC-8048 on Gnosis
    let mandate = 'worker'; // fallback
    try {
      const mandateBytes = await gnosisClient.readContract({
        address: ERC8048_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'metadata',
        args: [BigInt(tokenId), 'cursor[mandate]'],
      });
      const decoded = decodeStringValue(mandateBytes);
      if (decoded) mandate = decoded;
      console.log(`  mandate (ERC-8048): ${mandate}`);
    } catch {
      console.warn(`  ⚠ Could not read ERC-8048 mandate — defaulting to "${mandate}"`);
    }

    // 2. Derive subCap and compute capRoot
    const subCap       = getSubCap(mandate);
    const capRoot      = computeCapRoot(subCap);
    const cursorScopeId = keccak256(new TextEncoder().encode(`erc8048:fakenormie:${tokenId}`));

    console.log(`  subCap:         ${subCap} wei  (${Number(subCap) / 1e18} xDAI)`);
    console.log(`  cursorScopeId:  ${cursorScopeId}`);
    console.log(`  capRoot:        ${capRoot}`);

    // 3. Check if already registered
    let existingRoot = NULL_ROOT;
    try {
      existingRoot = await chiadoClient.readContract({
        address: CURSOR_CONTRACT,
        abi: CURSOR_READ_ABI,
        functionName: 'capabilityRoot',
        args: [cursorScopeId],
      });
    } catch {
      console.warn(`  ⚠ Could not read existing capabilityRoot from Chiado`);
    }

    if (existingRoot && existingRoot !== NULL_ROOT) {
      if (existingRoot === capRoot) {
        console.log(`  ✅ Already registered with matching capRoot — skipping\n`);
        results.push({ tokenId, status: 'skipped', mandate, capRoot });
        continue;
      } else {
        console.warn(`  ⚠ Already registered but capRoot MISMATCH`);
        console.warn(`     On-chain: ${existingRoot}`);
        console.warn(`     Expected: ${capRoot}`);
        console.warn(`  ⚠ Skipping — cursor contract does not allow re-registration\n`);
        results.push({ tokenId, status: 'mismatch', mandate, capRoot, onChain: existingRoot });
        continue;
      }
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would call register(${cursorScopeId.slice(0,10)}…, ${capRoot.slice(0,10)}…)\n`);
      results.push({ tokenId, status: 'dry-run', mandate, capRoot });
      continue;
    }

    // 4. Register on Chiado
    try {
      const txHash = await walletClient.writeContract({
        address: CURSOR_CONTRACT,
        abi: REGISTER_ABI,
        functionName: 'register',
        args: [cursorScopeId, capRoot],
      });
      console.log(`  📡 Tx submitted: ${txHash}`);
      console.log(`     https://gnosis-chiado.blockscout.com/tx/${txHash}`);
      const receipt = await chiadoClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'success') {
        console.log(`  ✅ Registered — block ${receipt.blockNumber}\n`);
        results.push({ tokenId, status: 'registered', mandate, capRoot, txHash });
      } else {
        console.error(`  ✗ Transaction reverted\n`);
        results.push({ tokenId, status: 'reverted', mandate, capRoot, txHash });
      }
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}\n`);
      results.push({ tokenId, status: 'error', mandate, capRoot, error: err.message });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Summary');
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    const icon = r.status === 'registered' ? '✅' : r.status === 'skipped' ? '⏭ ' : r.status === 'dry-run' ? '🔍' : '✗ ';
    console.log(`  ${icon} #${r.tokenId}  ${r.mandate.padEnd(12)}  ${r.status}${r.txHash ? `  ${r.txHash.slice(0, 18)}…` : ''}`);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
