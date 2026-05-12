#!/usr/bin/env node
/**
 * Admin script: Clear expires_at for all Farcaster (LARVA) accounts
 * 
 * Usage:
 *   CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx node scripts/clear-farcaster-expiry.js
 * 
 * Or use wrangler:
 *   npx wrangler kv:key list --namespace-id=INBOX_KV --preview=false | jq ...
 */

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN || process.env.WRANGLER_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('Error: Need CF_ACCOUNT_ID and CF_API_TOKEN (or WRANGLER_API_TOKEN)');
  process.exit(1);
}

async function kvList(prefix = '') {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values`);
  if (prefix) url.searchParams.set('prefix', prefix);
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` }
  });
  
  if (!res.ok) throw new Error(`KV list failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.result || [];
}

async function kvGet(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` }
  });
  
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
  
  if (!res.ok) throw new Error(`KV put failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function main() {
  console.log('Fetching acct-tier keys...');
  
  // List all acct-tier keys
  const keys = await kvList('acct-tier:');
  console.log(`Found ${keys.length} tier entries`);
  
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const key of keys) {
    const agentName = key.name.replace('acct-tier:', '');
    
    try {
      const tierData = await kvGet(key.name);
      if (!tierData) {
        console.log(`  [SKIP] ${agentName}: no tier data`);
        skipped++;
        continue;
      }
      
      // Check if it's a basic (LARVA) tier with expires_at set
      if (tierData.tier !== 'basic') {
        console.log(`  [SKIP] ${agentName}: tier=${tierData.tier} (not basic)`);
        skipped++;
        continue;
      }
      
      if (tierData.expires_at === null || tierData.expires_at === undefined) {
        console.log(`  [SKIP] ${agentName}: already no expiry`);
        skipped++;
        continue;
      }
      
      // Check if it's a Farcaster account (has FID in identity)
      const identityKey = key.name.replace('acct-tier:', '');
      const identityData = await kvGet(identityKey);
      
      const isFarcaster = identityData && identityData.fid;
      
      // Update: clear expires_at and set account_ttl to 'never'
      const updatedTier = {
        ...tierData,
        expires_at: null,
        account_ttl: 'never'
      };
      
      await kvPut(key.name, updatedTier);
      
      if (isFarcaster) {
        console.log(`  [UPDATED] ${agentName}: Farcaster FID=${identityData.fid}, cleared 30-day expiry`);
      } else {
        console.log(`  [UPDATED] ${agentName}: basic tier, cleared expiry (was ${new Date(tierData.expires_at).toISOString()})`);
      }
      updated++;
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
      
    } catch (err) {
      console.error(`  [ERROR] ${agentName}: ${err.message}`);
      errors++;
    }
  }
  
  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${errors} errors`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
