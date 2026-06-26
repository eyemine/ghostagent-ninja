#!/usr/bin/env node
/**
 * Backfill FakeNormies KV metadata: image + TLD + originNft
 * Usage: node scripts/backfill-fakenormie-metadata.mjs [slug]
 *   slug: optional — only fix this agent (e.g. "super.normie"). Omit to fix all.
 * Requires: WORKER_SECRET + WEBHOOK_SECRET (loaded from .env / .env.local automatically)
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env / .env.local manually (no dotenv dependency needed)
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  for (const raw of lines) {
    const line = raw.split('#')[0].trim(); // strip inline comments
    if (!line || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(join(ROOT, '.env'));
loadEnvFile(join(ROOT, '.env.local'));

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

const FN_SVG_BASE = 'https://ipfs.io/ipfs/bafybeibn726tei6kue2ixjqfyeiefjnlvd5wm3cc6r76qqwixebvqlfaga';
const FAKENORMIES_ADDRESS = '0x1d6b9e2af40322d2311ff0df66dade4490ac4c29';

if (!WORKER_SECRET) {
  console.error('WORKER_SECRET env var required (check .env or export it)');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('WEBHOOK_SECRET env var required (check .env.local or export it)');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(__dirname, '../public/FakeNormies/manifest.json'), 'utf-8'));
const tokens = manifest.tokens;

const filterSlug = process.argv[2] || null;

async function post(body) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': WORKER_SECRET,
      'X-Webhook-Secret': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

async function kvGet(key) {
  const r = await post({ action: 'kvGet', key });
  return r?.value ?? null;
}

async function fixAgent(token) {
  const { tokenId, slug } = token;
  const svgFilename = String(tokenId).padStart(2, '0') + '.svg';
  const imageUrl = `${FN_SVG_BASE}/${svgFilename}`;

  // Check current tier to determine correct TLD
  let currentTier = 'basic';
  try {
    const tierRaw = await kvGet(`acct-tier:${slug}`);
    if (tierRaw) {
      const tierObj = JSON.parse(tierRaw);
      currentTier = tierObj.tier || 'basic';
    }
  } catch {}

  const isUpgraded = currentTier !== 'basic';
  const targetTld = isUpgraded ? 'agent.gno' : 'fakenormie';
  const originNft = isUpgraded ? `${slug.replace(/\./g, '-')}.agent.gno` : `${slug}.fakenormie`;

  console.log(`\n[${slug}] tokenId=${tokenId} tier=${currentTier} tld=${targetTld}`);

  // 1. Store FakeNormies SVG image
  const imgRes = await post({
    action: 'kvPut',
    key: `byo-origin-image:${slug}`,
    value: JSON.stringify({ imageUrl, nftType: 'fakenormie', tokenId: String(tokenId), storedAt: Date.now() }),
    ownerAddress: '0x0000000000000000000000000000000000000001',
    webhookSecret: WEBHOOK_SECRET,
  });
  console.log(`  image: ${imgRes?.status || imgRes?.error || JSON.stringify(imgRes)}`);

  // 2. Set correct TLD
  const tldRes = await post({
    action: 'setTld',
    secret: WEBHOOK_SECRET,
    agentName: slug,
    tld: targetTld,
  });
  console.log(`  tld: ${tldRes?.status || tldRes?.error || JSON.stringify(tldRes)}`);

  // 3. Update originNft in nftmailgno:{slug} beacon record
  const beaconRes = await post({
    action: 'setAgentRecord',
    secret: WEBHOOK_SECRET,
    agentName: slug,
    originNft,
    mintedTokenId: tokenId,
    registrar: FAKENORMIES_ADDRESS,
  });
  console.log(`  beacon: ${beaconRes?.status || beaconRes?.error || JSON.stringify(beaconRes)}`);
}

async function main() {
  const toFix = filterSlug
    ? tokens.filter(t => t.slug === filterSlug)
    : tokens;

  if (toFix.length === 0) {
    console.error(`No token found for slug: ${filterSlug}`);
    process.exit(1);
  }

  console.log(`Fixing ${toFix.length} FakeNormies agent(s)...`);
  for (const token of toFix) {
    await fixAgent(token);
  }
  console.log('\nDone.');
}

main().catch(console.error);
