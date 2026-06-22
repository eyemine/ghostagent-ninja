#!/usr/bin/env node
/**
 * Upgrade FakeNormie tier on-chain
 * Usage: node scripts/upgrade-fakenormie-tier.mjs <tokenId> <tier> <expiry>
 * tier: 0=basic, 1=pro, 2=premium
 * expiry: timestamp (only for premium tier, 0 for permanent)
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let slugIndex = {};
try {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../public/FakeNormies/manifest.json'), 'utf-8'));
  slugIndex = manifest.slugIndex || {};
} catch {}

const FAKENORMIES_ADDRESS = '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29';
const GNOSIS_RPC = 'https://rpc.gnosischain.com';
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

const TIER_NAMES = { 0: 'basic', 1: 'pro', 2: 'premium' };

const setTierABI = [
  {
    name: 'setTier',
    type: 'function',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
      { name: 'expiry', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

async function main() {
  const tokenId = process.argv[2];
  const tier = process.argv[3];
  const expiry = process.argv[4] || '0';

  if (!tokenId || !tier) {
    console.error('Usage: node scripts/upgrade-fakenormie-tier.mjs <tokenId> <tier> [expiry]');
    console.error('  tier: 0=basic, 1=pro, 2=premium');
    console.error('  expiry: unix timestamp (only for premium, 0 for permanent)');
    process.exit(1);
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error('DEPLOYER_PRIVATE_KEY env var required');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    chain: gnosis,
    transport: http(GNOSIS_RPC),
    account,
  });
  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(GNOSIS_RPC),
  });

  console.log(`Upgrading FakeNormie #${tokenId} to tier ${tier} (expiry: ${expiry})...`);

  // Resolve slug from tokenId for KV sync
  const tokenIdNum = parseInt(tokenId);
  const slug = Object.entries(slugIndex).find(([, id]) => id === tokenIdNum)?.[0] ?? null;
  if (slug) {
    console.log(`Agent slug: ${slug}`);
  } else {
    console.warn(`No slug found for tokenId ${tokenId} — KV sync will be skipped`);
  }

  try {
    const hash = await walletClient.writeContract({
      address: FAKENORMIES_ADDRESS,
      abi: setTierABI,
      functionName: 'setTier',
      args: [BigInt(tokenId), parseInt(tier), BigInt(expiry)],
    });

    console.log(`Transaction submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed}`);

    // ── Sync KV tier + TLD so worker reflects the on-chain change immediately ──
    if (slug && WEBHOOK_SECRET) {
      const tierName = TIER_NAMES[parseInt(tier)] ?? 'basic';
      const headers = { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET, 'X-Webhook-Secret': WEBHOOK_SECRET };

      const kvRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'setAgentRecord', agentName: slug, tier: tierName, secret: WEBHOOK_SECRET }),
      }).then(r => r.json()).catch(() => null);
      if (kvRes?.status === 'updated') {
        console.log(`✅ KV tier synced: ${slug} → ${tierName}`);
      } else {
        console.warn(`⚠️  KV tier sync failed:`, kvRes);
      }

      // Set tld:slug = agent.gno so agent-card route returns correct TLD
      const tldRes = await fetch(WORKER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'setTld', agentName: slug, tld: 'agent.gno', webhookSecret: WEBHOOK_SECRET }),
      }).then(r => r.json()).catch(() => null);
      if (tldRes?.status === 'ok' || tldRes?.tld) {
        console.log(`✅ KV tld synced: ${slug} → agent.gno`);
      } else {
        console.warn(`⚠️  KV tld sync failed:`, tldRes);
      }
    } else if (!WEBHOOK_SECRET) {
      console.warn(`⚠️  WEBHOOK_SECRET not set — KV not synced. Run: node scripts/set-agent-tier.mjs ${slug} ${TIER_NAMES[parseInt(tier)]}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
