#!/usr/bin/env node
/**
 * Generate a signed tier-upgrade coupon for a FakeNormie agent.
 *
 * Coupon format (URL-safe base64):
 *   base64url(JSON({ slug, tier, expiry })) + "." + base64url(HMAC-SHA256)
 *
 * Usage:
 *   WEBHOOK_SECRET=<secret> node scripts/generate-coupon.mjs <slug> <tier> [expiry_days]
 *
 * Examples:
 *   WEBHOOK_SECRET=xxx node scripts/generate-coupon.mjs iron pro 30
 *   WEBHOOK_SECRET=xxx node scripts/generate-coupon.mjs iron premium 0   # permanent
 *
 * tier: basic | pro | premium
 * expiry_days: 0 = permanent, otherwise days from now
 */

import { createHmac } from 'crypto';

const TIERS = ['basic', 'pro', 'premium'];

const slug        = process.argv[2];
const tier        = process.argv[3]?.toLowerCase();
const expiryDays  = parseInt(process.argv[4] ?? '0', 10);

if (!slug || !tier || !TIERS.includes(tier)) {
  console.error('Usage: WEBHOOK_SECRET=<s> node generate-coupon.mjs <slug> <tier> [expiry_days]');
  console.error('  tier: basic | pro | premium');
  process.exit(1);
}

const secret = process.env.WEBHOOK_SECRET;
if (!secret) { console.error('WEBHOOK_SECRET env var required'); process.exit(1); }

const expiry = expiryDays > 0
  ? Math.floor(Date.now() / 1000) + expiryDays * 86400
  : 0;

const payload = { slug, tier, expiry, issuedAt: Math.floor(Date.now() / 1000) };
const payloadJson = JSON.stringify(payload);
const payloadB64  = Buffer.from(payloadJson).toString('base64url');

const sig    = createHmac('sha256', secret).update(payloadB64).digest('base64url');
const coupon = `${payloadB64}.${sig}`;

console.log('\n════════════════════════════════════════════════');
console.log(`  Tier Upgrade Coupon`);
console.log('════════════════════════════════════════════════');
console.log(`  slug    : ${slug}`);
console.log(`  tier    : ${tier}`);
console.log(`  expiry  : ${expiry === 0 ? 'permanent' : new Date(expiry * 1000).toISOString()}`);
console.log('');
console.log('  COUPON CODE:');
console.log(`  ${coupon}`);
console.log('');
console.log('  Redeem at:');
console.log(`  POST /api/fakenormies/redeem-coupon`);
console.log(`  { "coupon": "<code>" }`);
console.log('');
console.log('  Or run directly:');
console.log(`  WEBHOOK_SECRET=xxx node scripts/redeem-coupon.mjs ${coupon}`);
console.log('════════════════════════════════════════════════\n');
