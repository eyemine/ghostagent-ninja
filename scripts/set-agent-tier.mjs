#!/usr/bin/env node
/**
 * Set agent tier in worker KV via setAgentRecord action
 * Usage: node scripts/set-agent-tier.mjs <agentName> <tier>
 * tier: basic | lite | premium | ghost
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const raw of readFileSync(filePath, 'utf-8').split('\n')) {
    const line = raw.split('#')[0].trim();
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

async function main() {
  const agentName = process.argv[2];
  const tier = process.argv[3];

  if (!agentName || !tier) {
    console.error('Usage: node scripts/set-agent-tier.mjs <agentName> <tier>');
    console.error('  tier: basic | lite | premium | ghost');
    console.error('  Requires: WORKER_SECRET (router auth) + WEBHOOK_SECRET (action auth)');
    process.exit(1);
  }

  if (!WORKER_SECRET) {
    console.error('WORKER_SECRET env var required (router auth header)');
    process.exit(1);
  }
  if (!WEBHOOK_SECRET) {
    console.error('WEBHOOK_SECRET env var required (setAgentRecord action auth)');
    process.exit(1);
  }

  console.log(`Setting tier for ${agentName} to ${tier}...`);

  try {
    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': WORKER_SECRET,
        'X-Webhook-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        action: 'setAgentRecord',
        agentName,
        tier,
        secret: WEBHOOK_SECRET,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('Success:', result);
    } else {
      console.error('Error:', result);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
