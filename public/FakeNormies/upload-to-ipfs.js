#!/usr/bin/env node
/**
 * Upload FakeNormies SVGs + manifest to IPFS via Pinata
 *
 * Setup:
 *   1. Create free account at https://pinata.cloud
 *   2. Generate a JWT: Pinata dashboard → API Keys → New Key → Admin → copy JWT
 *   3. Run: PINATA_JWT=<jwt> node public/FakeNormies/upload-to-ipfs.js
 *
 * After running, call setBaseURI on the deployed contract:
 *   cast send <FAKENORMIES_ADDRESS> "setBaseURI(string)" "ipfs://<SVG_CID>/" \
 *     --rpc-url gnosis --private-key $DEPLOYER_PRIVATE_KEY
 */

const fs   = require('fs');
const path = require('path');

const JWT = process.env.PINATA_JWT;
if (!JWT) {
  console.error('Error: PINATA_JWT env var not set');
  console.error('Get one at https://app.pinata.cloud/developers/api-keys');
  process.exit(1);
}

const SVGS_DIR = path.join(__dirname, 'SVGS');
const MANIFEST  = path.join(__dirname, 'manifest.json');
const PINATA_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

async function pinFolder(dirPath, pinName) {
  const form = new FormData();
  const files = fs.readdirSync(dirPath).sort();
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isFile()) {
      const blob = new Blob([fs.readFileSync(fullPath)], { type: 'image/svg+xml' });
      form.append('file', blob, `${pinName}/${file}`);
    }
  }
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  form.append('pinataMetadata', JSON.stringify({ name: pinName }));

  const res = await fetch(PINATA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata error ${res.status}: ${await res.text()}`);
  return (await res.json()).IpfsHash;
}

async function pinFile(filePath, pinName) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)], { type: 'application/json' });
  form.append('file', blob, path.basename(filePath));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  form.append('pinataMetadata', JSON.stringify({ name: pinName }));

  const res = await fetch(PINATA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata error ${res.status}: ${await res.text()}`);
  return (await res.json()).IpfsHash;
}

const KNOWN_SVG_CID = 'bafybeibn726tei6kue2ixjqfyeiefjnlvd5wm3cc6r76qqwixebvqlfaga';

async function upload() {
  let svgCid = KNOWN_SVG_CID;

  if (process.argv[2] !== '--manifest-only') {
    console.log('Pinning SVGS folder to IPFS via Pinata...');
    svgCid = await pinFolder(SVGS_DIR, 'FakeNormies-SVGS');
    console.log('SVGs CID:', svgCid);
  } else {
    console.log('Skipping SVGs (already pinned):', svgCid);
  }

  console.log('\nPinning manifest.json...');
  let manifestCid;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      manifestCid = await pinFile(MANIFEST, 'FakeNormies-manifest');
      break;
    } catch (err) {
      console.error(`  Attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  console.log('Manifest CID:', manifestCid);

  console.log('\n──────────────────────────────────────────');
  console.log('SVG base URI  → ipfs://' + svgCid + '/');
  console.log('Manifest URI  → ipfs://' + manifestCid);
  console.log('\nSet base URI on the contract:');
  console.log(`  cast send <FAKENORMIES_ADDRESS> "setBaseURI(string)" "ipfs://${svgCid}/" \\`);
  console.log(`    --rpc-url gnosis --private-key $DEPLOYER_PRIVATE_KEY`);
  console.log('──────────────────────────────────────────\n');
}

upload().catch(err => {
  console.error('Upload error:', err?.message || err);
  process.exit(1);
});
