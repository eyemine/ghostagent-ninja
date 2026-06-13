// Run with:  node csv-to-manifest.js
// No npm dependencies required
'use strict';
const fs   = require('fs');
const path = require('path');

const TYPE_TIER = { Normie:'Standard', Human:'Social', Agent:'Advanced', Cat:'Playful', Alien:'Experimental' };
const TYPE_FEATURES = {
  Standard:     ['email_inbox','basic_chat','identity'],
  Social:       ['email_inbox','enhanced_social','profile_customization'],
  Advanced:     ['email_inbox','advanced_ai','api_access'],
  Playful:      ['email_inbox','playful_interactions','game_features'],
  Experimental: ['email_inbox','experimental_features','beta_access'],
};

const csvPath  = path.join(__dirname, 'FakeNormies-manifest.csv');
const outPath  = path.join(__dirname, 'manifest.json');

const lines  = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const tokens = lines
  .map(line => {
    const [svgFilename, adjective, type] = line.trim().split(',');
    if (!svgFilename || !adjective || !type) return null;
    const tokenId  = parseInt(svgFilename.replace('.svg', ''), 10);
    const slug     = `${adjective}.${type}`.toLowerCase();
    return { tokenId, svgFilename, name: `${adjective} ${type}`, adjective, type, slug, email: `${slug}@nftmail.box` };
  })
  .filter(Boolean)
  .sort((a, b) => a.tokenId - b.tokenId);

// Detect duplicate slugs and append tokenId to disambiguate
const slugCount = {};
tokens.forEach(t => { slugCount[t.slug] = (slugCount[t.slug] || 0) + 1; });
const slugSeen  = {};
tokens.forEach(t => {
  if (slugCount[t.slug] > 1) {
    slugSeen[t.slug] = (slugSeen[t.slug] || 0) + 1;
    if (slugSeen[t.slug] > 1) {
      t.slug  = `${t.slug}.${t.tokenId}`;
      t.email = `${t.slug}@nftmail.box`;
      t.duplicate = true;
    }
  }
});

// Build slug → tokenId index for fast reserved-name lookups
const slugIndex = {};
tokens.forEach(t => { slugIndex[t.slug] = t.tokenId; });

const manifest = {
  collection: {
    name: 'FakeNormies',
    symbol: 'FNORM',
    totalSupply: tokens.length,
    contract: process.env.FAKE_NORMIE_CONTRACT || '',
    chain: 'gnosis',
  },
  slugIndex,
  tokens,
};

fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`✓ manifest.json written — ${tokens.length} tokens`);
const dupes = tokens.filter(t => t.duplicate);
if (dupes.length) console.log(`  ⚠ ${dupes.length} duplicate slug(s) disambiguated:`, dupes.map(t => t.slug));
