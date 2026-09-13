#!/usr/bin/env node
/**
 * verify.mjs — post-migration sanity checks against Redis (Layer 1).
 *
 * Confirms the KV migration landed real data and spot-checks known agents.
 * Prints presence + tier, never prints email bodies.
 *
 * Usage (on Hetzner or via tunnel):
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=xxx node verify.mjs
 */

import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

// Known agents to spot-check (add more as needed).
const SPOT_CHECK = ['ghostagent-og.cast', 'ghostagent', 'eyemine', 'victor'];

async function countByPrefix(prefix) {
  let cursor = '0', count = 0;
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = next;
    count += batch.length;
  } while (cursor !== '0');
  return count;
}

(async () => {
  console.log('── Key-space counts ──');
  for (const p of ['agentprofile:', 'acct-tier:', 'tld:', 'erc8004:', 'blind-index:', 'blind:', 'beacon:', 'calendar:']) {
    console.log(`  ${p.padEnd(16)} ${await countByPrefix(p)}`);
  }

  console.log('\n── Spot-check agents ──');
  for (const name of SPOT_CHECK) {
    const profile = await redis.get(`agentprofile:${name}`);
    const tier = await redis.get(`acct-tier:${name}`);
    const idx = await redis.get(`blind-index:${name}`);
    let tierVal = '—', profileTier = '—', msgCount = 0;
    try { if (tier) tierVal = JSON.parse(tier).tier ?? '—'; } catch {}
    try { if (profile) profileTier = JSON.parse(profile).tier ?? '(profile present)'; } catch {}
    try { if (idx) msgCount = JSON.parse(idx).length ?? 0; } catch {}
    console.log(`  ${name.padEnd(22)} profile=${profile ? 'Y' : 'N'} acct-tier=${tierVal} profile.tier=${profileTier} kvInbox=${msgCount}`);
  }

  await redis.quit();
})().catch((e) => { console.error('✗ verify error:', e); process.exit(1); });
