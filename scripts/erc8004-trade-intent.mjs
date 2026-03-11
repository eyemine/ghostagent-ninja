/**
 * ERC-8004 EIP-712 TradeIntent — sign and submit a trade intent
 *
 * Usage:
 *   node scripts/erc8004-trade-intent.mjs <agentName> <agentId>
 *   e.g. node scripts/erc8004-trade-intent.mjs ghostagent 1
 *
 * Signs a TradeIntent using EIP-712 structured data and posts it
 * to the A2A endpoint (worker) for discovery by counter-agents.
 */

import { createWalletClient, http, parseAbi, keccak256, toBytes, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let envContent = '';
try { envContent = readFileSync(resolve(__dirname, '../.env.local'), 'utf8'); } catch {
  try { envContent = readFileSync(resolve(__dirname, '../.env'), 'utf8'); } catch {}
}
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const PRIVATE_KEY = env.PRIVATE_KEY || process.env.PRIVATE_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://ghostagent.ninja';
const WORKER_URL = env.NFTMAIL_WORKER_URL || 'https://nftmail-email-worker.richard-159.workers.dev';

const CHAIN_ID = 84532; // Base Sepolia
// ERC-8004 Identity Registry on Base Sepolia (used as verifying contract for EIP-712 domain)
// Source: https://github.com/erc-8004/erc-8004-contracts
const ERC8004_IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';

// EIP-712 domain for TradeIntents
const TRADE_INTENT_DOMAIN = {
  name: 'ERC8004TradeIntent',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: ERC8004_IDENTITY_REGISTRY,
};

// EIP-712 TradeIntent type definition
const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: 'agentId',      type: 'uint256' },
    { name: 'agentURI',     type: 'string'  },
    { name: 'action',       type: 'string'  },  // 'offer' | 'request' | 'A2A'
    { name: 'asset',        type: 'string'  },  // what's being traded
    { name: 'price',        type: 'string'  },  // price in xDAI / $IP / etc.
    { name: 'endpoint',     type: 'string'  },  // A2A endpoint to contact
    { name: 'nonce',        type: 'uint256' },
    { name: 'expiry',       type: 'uint256' },  // unix timestamp
  ],
};

async function main() {
  const agentName = process.argv[2];
  const agentId = Number(process.argv[3]);

  if (!agentName || isNaN(agentId)) {
    console.error('Usage: node scripts/erc8004-trade-intent.mjs <agentName> <agentId>');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('Missing PRIVATE_KEY in .env or .env.local');
    process.exit(1);
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const agentURI = `${APP_URL}/api/agent/${agentName}/registration.json`;

  // Build a demo TradeIntent — agent offering A2A email routing service
  const nonce = BigInt(Date.now());
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days

  const tradeIntent = {
    agentId:  BigInt(agentId),
    agentURI,
    action:   'offer',
    asset:    'A2A email routing via nftmail.box',
    price:    '0.001 xDAI per message',
    endpoint: WORKER_URL,
    nonce,
    expiry,
  };

  console.log(`\n📋 EIP-712 TradeIntent`);
  console.log(`   Agent:    ${agentName} (agentId: ${agentId})`);
  console.log(`   Signer:   ${account.address}`);
  console.log(`   Action:   ${tradeIntent.action}`);
  console.log(`   Asset:    ${tradeIntent.asset}`);
  console.log(`   Price:    ${tradeIntent.price}`);
  console.log(`   Nonce:    ${nonce}`);
  console.log(`   Expiry:   ${new Date(Number(expiry) * 1000).toISOString()}`);
  console.log(`   Chain:    Base Sepolia (${CHAIN_ID})`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  console.log('\n⏳ Signing EIP-712 TradeIntent...');
  let signature;
  try {
    signature = await walletClient.signTypedData({
      domain:      TRADE_INTENT_DOMAIN,
      types:       TRADE_INTENT_TYPES,
      primaryType: 'TradeIntent',
      message:     tradeIntent,
    });
  } catch (err) {
    console.error('❌ Signing failed:', err.shortMessage || err.message);
    process.exit(1);
  }

  console.log(`   ✓ Signature: ${signature.slice(0, 20)}...`);

  // Build the full signed TradeIntent envelope
  const signedIntent = {
    type:      'erc8004:trade-intent:v1',
    agentId,
    agentURI,
    intent:    {
      action:   tradeIntent.action,
      asset:    tradeIntent.asset,
      price:    tradeIntent.price,
      endpoint: tradeIntent.endpoint,
      nonce:    nonce.toString(),
      expiry:   expiry.toString(),
    },
    signer:    account.address,
    signature,
    domain:    TRADE_INTENT_DOMAIN,
    signedAt:  Date.now(),
  };

  // Store the signed TradeIntent in worker KV for A2A discovery
  console.log('\n⏳ Publishing TradeIntent to A2A endpoint...');
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'storeTradeIntent',
        agentName,
        agentId,
        signedIntent,
      }),
    });
    if (res.ok) {
      console.log('   ✓ TradeIntent published — discoverable by counter-agents via A2A');
    } else {
      const text = await res.text();
      console.warn(`   ⚠️  Publish failed (${res.status}): ${text}`);
      console.log('   (TradeIntent signed locally — signature is still valid)');
    }
  } catch (e) {
    console.warn(`   ⚠️  Could not publish: ${e.message}`);
    console.log('   (TradeIntent signed locally — signature is still valid)');
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EIP-712 TradeIntent Signed ✓
  Agent:     ${agentName} (agentId: ${agentId})
  Signer:    ${account.address}
  Signature: ${signature.slice(0, 42)}...
  Action:    ${tradeIntent.action}
  Asset:     ${tradeIntent.asset}
  Price:     ${tradeIntent.price}
  Expiry:    ${new Date(Number(expiry) * 1000).toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Full signed intent (paste into hackathon submission):
${JSON.stringify(signedIntent, null, 2)}
`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
