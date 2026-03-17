/**
 * ERC-8004 Identity Registry — register(agentURI) + optional auto-transfer to Safe
 *
 * Usage:
 *   node scripts/erc8004-register.mjs <agentName> [--base-sepolia|--gnosis] [--safe <safeAddress>]
 *
 * Examples:
 *   node scripts/erc8004-register.mjs ghostagent --gnosis --safe 0xb7e493e3d226f8fE722CC9916fF164B793af13F4
 *   node scripts/erc8004-register.mjs ghostagent --base-sepolia --safe 0xYourBaseSepSafe
 *   node scripts/erc8004-register.mjs ghostagent --base-sepolia   # stays on EOA
 *
 * Flow:
 *   1. register(agentURI) — mints ERC-721 agentId to PRIVATE_KEY EOA (contract limitation)
 *   2. transferFrom(EOA → Safe) — if --safe provided, immediately moves token to agent Safe
 *   3. Stores agentId in worker KV
 *
 * Reputation (giveFeedback) is indexed by agentId — NOT owner. Transfer loses nothing.
 *
 * Failsafe flow:
 *   - After register(): writes erc8004PendingTransfer to KV immediately
 *   - After transferFrom(): clears pending record, writes final state
 *   - If script dies between steps, KV has the pending record for recovery
 *   - Use --recover to detect and retry any stuck pending transfers
 *
 * Recovery:
 *   node scripts/erc8004-register.mjs ghostagent --recover [--base-sepolia|--gnosis]
 *
 * Contract: https://github.com/erc-8004/erc-8004-contracts
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis, baseSepolia, base } from 'viem/chains';
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

// ERC-8004 Identity Registry addresses
// Source: https://github.com/erc-8004/erc-8004-contracts
const REGISTRIES = {
  gnosis:      { chainId: 100,   identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', rpc: 'https://rpc.gnosischain.com', explorer: 'https://gnosisscan.io',         viemChain: gnosis      },
  base:        { chainId: 8453,  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', rpc: 'https://mainnet.base.org',   explorer: 'https://basescan.org',           viemChain: base        },
  baseSepolia: { chainId: 84532, identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e', rpc: 'https://sepolia.base.org',   explorer: 'https://sepolia.basescan.org',   viemChain: baseSepolia },
};

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function setMetadata(uint256 agentId, string key, bytes value)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

async function main() {
  const args       = process.argv.slice(2);
  const agentName  = args.find(a => !a.startsWith('--') && !a.startsWith('0x'));
  const useBaseSep  = args.includes('--base-sepolia');
  const useBase     = args.includes('--base');
  const useGnosis   = args.includes('--gnosis');

  // --safe <address>
  const safeIdx   = args.indexOf('--safe');
  const safeAddr  = safeIdx !== -1 ? args[safeIdx + 1] : null;
  const isRecover = args.includes('--recover');

  if (!agentName && !isRecover) {
    console.error('Usage: node scripts/erc8004-register.mjs <agentName> [--base-sepolia|--gnosis] [--safe <safeAddress>]');
    console.error('       node scripts/erc8004-register.mjs --recover [--base-sepolia|--gnosis]  # retry stuck transfers');
    process.exit(1);
  }

  const net   = useBaseSep ? REGISTRIES.baseSepolia : useBase ? REGISTRIES.base : REGISTRIES.gnosis;
  const chain = net.viemChain;

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const account      = privateKeyToAccount(PRIVATE_KEY);
  const chainLabel   = useBaseSep ? `Base Sepolia (${net.chainId})` : useBase ? `Base Mainnet (${net.chainId})` : `Gnosis Mainnet (${net.chainId})`;
  const publicClient = createPublicClient({ chain, transport: http(net.rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(net.rpc) });

  // ── Recovery mode: retry any stuck pending transfers, then exit ───────────
  if (isRecover) {
    await recover(WORKER_URL, net, chain, account, walletClient, publicClient, chainLabel);
    process.exit(0);
  }

  console.log(`\n🔑 Registering agent: ${agentName}`);
  console.log(`   EOA:      ${account.address}`);
  console.log(`   Chain:    ${chainLabel}`);
  console.log(`   Registry: ${net.identityRegistry}`);
  if (safeAddr) {
    console.log(`   Safe:     ${safeAddr} (token will be transferred here after mint)`);
  } else {
    console.log(`   Safe:     none — token stays on EOA (use --safe <addr> to transfer)`);
  }

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

  console.log('\n⏳ Sending register() transaction...');
  let txHash;
  try {
    txHash = await walletClient.writeContract({
      address: net.identityRegistry,
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
  console.log(`   Minted to: ${account.address} (EOA)`);

  // ── Checkpoint: write pending transfer to KV immediately after mint ───────
  // If the script dies before transferFrom(), this record allows recovery.
  if (safeAddr) {
    await kvStore(WORKER_URL, agentName, {
      action: 'setErc8004PendingTransfer',
      agentName,
      erc8004AgentId: agentId,
      pendingTransfer: {
        agentId,
        safeAddr,
        eoaAddr:   account.address,
        chain:     chainLabel,
        chainId:   net.chainId,
        registry:  net.identityRegistry,
        mintTx:    txHash,
        createdAt: new Date().toISOString(),
      },
    }, 'pending transfer checkpoint');
  }

  // ── Step 2: activation tx FIRST — EOA still owns token, setMetadata authorized
  if (safeAddr) {
    await sendActivationTx({
      walletClient, publicClient, net, agentId,
      agentName, agentURI, safeAddr, chainLabel,
    });
  }

  // ── Step 3: transferFrom(EOA → Safe) ──────────────────────────────────────
  if (safeAddr) {
    console.log(`\n⏳ Transferring agentId ${agentId} → Safe ${safeAddr}...`);
    let transferHash;
    try {
      transferHash = await walletClient.writeContract({
        address: net.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'transferFrom',
        args: [account.address, safeAddr, BigInt(agentId)],
      });
    } catch (err) {
      console.error('❌ transferFrom() failed:', err.shortMessage || err.message);
      console.error(`   agentId ${agentId} remains on EOA. Transfer manually:`);
      console.error(`   node scripts/erc8004-transfer-to-safe.mjs ${agentId} ${safeAddr} ${useBaseSep ? '--base-sepolia' : '--gnosis'}`);
      // Don't exit — still store agentId in KV
    }
    if (transferHash) {
      const xferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
      console.log(`   ✓ Transfer confirmed in block ${xferReceipt.blockNumber}`);
      console.log(`   Tx: ${net.explorer}/tx/${transferHash}`);
      const newOwner = await publicClient.readContract({
        address: net.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
      });
      console.log(`   ✓ New owner: ${newOwner}`);

      // ── Clear pending transfer checkpoint — transfer succeeded ─────────
      await kvStore(WORKER_URL, agentName, {
        action: 'clearErc8004PendingTransfer',
        agentName,
      }, 'clear pending transfer checkpoint');
    }
  }

  // ── Step 3: store final agentId in worker KV ──────────────────────────────
  console.log('\n⏳ Storing agentId in worker KV...');
  await kvStore(WORKER_URL, agentName, {
    action: 'setErc8004AgentId',
    agentName,
    erc8004AgentId: agentId,
    agentURI,
    safeOwner: safeAddr ?? null,
  }, 'agentId + Safe owner');

  const finalOwner = safeAddr || account.address;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Registration complete
  Agent:     ${agentName}
  agentId:   ${agentId}
  Owner:     ${finalOwner}${safeAddr ? ' (Safe ✓)' : ' (EOA — add --safe <addr> next time)'}
  Chain:     ${chainLabel}
  Registry:  eip155:${net.chainId}:${net.identityRegistry}
  agentURI:  ${agentURI}
  Mint tx:   ${net.explorer}/tx/${txHash}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Next step — give reputation feedback:
  node scripts/erc8004-reputation.mjs ${agentName} ${agentId} ${useBaseSep ? '--base-sepolia' : '--gnosis'}
`);
}

// ── Activation tx — setMetadata('activated') seeds on-chain telemetry ─────────
// Called after transferFrom() succeeds. Emits a MetadataSet event in the registry
// so block explorers + telemetry dashboards show confirmed agent activity.
async function sendActivationTx({ walletClient, publicClient, net, agentId, agentName, agentURI, safeAddr, chainLabel }) {
  console.log(`\n⏳ Sending activation tx — setMetadata('activated')...`);
  const payload = JSON.stringify({
    activatedAt: new Date().toISOString(),
    agentName,
    agentURI,
    safeOwner: safeAddr,
    chain: chainLabel,
    hello: 'GhostAgent activated',
  });
  // ABI-encode as bytes (simple UTF-8 encoding prefixed with length — compatible with ERC-8004 setMetadata)
  const encoded = new TextEncoder().encode(payload);
  const valueBytes = `0x${Buffer.from(encoded).toString('hex')}`;

  try {
    const txHash = await walletClient.writeContract({
      address: net.identityRegistry,
      abi: parseAbi(['function setMetadata(uint256 agentId, string key, bytes value)']),
      functionName: 'setMetadata',
      args: [BigInt(agentId), 'activated', valueBytes],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`   ✓ Activation confirmed block ${receipt.blockNumber}`);
    console.log(`   Tx: ${net.explorer}/tx/${txHash}`);
  } catch (e) {
    // Non-fatal — telemetry is nice-to-have, don't block on it
    console.warn(`   ⚠️  Activation tx failed (non-fatal): ${e.shortMessage || e.message}`);
  }
}

// ── KV helper — logs clearly on failure but never throws ─────────────────────
async function kvStore(workerUrl, agentName, payload, label) {
  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      console.log(`   ✓ KV: ${label}`);
    } else {
      const txt = await res.text();
      console.warn(`   ⚠️  KV write failed (${label}): ${txt}`);
      console.warn(`   ⚠️  Manual recovery: node scripts/erc8004-transfer-to-safe.mjs <agentId> <safeAddr> --gnosis|--base-sepolia`);
    }
  } catch (e) {
    console.warn(`   ⚠️  KV unreachable (${label}): ${e.message}`);
    console.warn(`   ⚠️  Manual recovery: node scripts/erc8004-transfer-to-safe.mjs <agentId> <safeAddr> --gnosis|--base-sepolia`);
  }
}

// ── Recovery mode — checks KV for pending transfers and retries ───────────────
async function recover(workerUrl, net, chain, account, walletClient, publicClient, chainLabel) {
  console.log(`\n🔍 Recovery mode — checking KV for pending transfers on ${chainLabel}...`);
  let pending;
  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getErc8004PendingTransfers' }),
    });
    if (!res.ok) { console.error('❌ Could not fetch pending transfers from KV'); return; }
    pending = await res.json();
  } catch (e) {
    console.error('❌ KV unreachable:', e.message);
    return;
  }

  const items = Array.isArray(pending) ? pending : (pending?.pendingTransfers ?? []);
  const forThisChain = items.filter(p => p.chainId === net.chainId);

  if (forThisChain.length === 0) {
    console.log('   ✓ No pending transfers found for this chain.');
    return;
  }

  console.log(`   Found ${forThisChain.length} pending transfer(s):`);

  for (const p of forThisChain) {
    console.log(`\n   agentId ${p.agentId} → Safe ${p.safeAddr}  (agent: ${p.agentName})`);

    // Check on-chain current owner
    let currentOwner;
    try {
      currentOwner = await publicClient.readContract({
        address: net.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'ownerOf',
        args: [BigInt(p.agentId)],
      });
    } catch (e) {
      console.warn(`   ⚠️  Could not read ownerOf(${p.agentId}): ${e.message} — skipping`);
      continue;
    }

    if (currentOwner.toLowerCase() === p.safeAddr.toLowerCase()) {
      console.log(`   ✓ agentId ${p.agentId} already owned by Safe — clearing stale checkpoint`);
      await kvStore(workerUrl, p.agentName, { action: 'clearErc8004PendingTransfer', agentName: p.agentName }, 'clear stale checkpoint');
      continue;
    }

    if (currentOwner.toLowerCase() !== account.address.toLowerCase()) {
      console.warn(`   ⚠️  agentId ${p.agentId} owned by ${currentOwner} — not our EOA, skipping`);
      continue;
    }

    console.log(`   ⏳ Retrying transferFrom(${account.address} → ${p.safeAddr})...`);
    try {
      const txHash = await walletClient.writeContract({
        address: net.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'transferFrom',
        args: [account.address, p.safeAddr, BigInt(p.agentId)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`   ✓ Transfer confirmed block ${receipt.blockNumber}: ${net.explorer}/tx/${txHash}`);
      await kvStore(workerUrl, p.agentName, { action: 'clearErc8004PendingTransfer', agentName: p.agentName }, 'clear pending after recovery');
    } catch (err) {
      console.error(`   ❌ Recovery transfer failed: ${err.shortMessage || err.message}`);
      console.error(`   Manual fix: node scripts/erc8004-transfer-to-safe.mjs ${p.agentId} ${p.safeAddr} --${net.chainId === 100 ? 'gnosis' : 'base-sepolia'}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
