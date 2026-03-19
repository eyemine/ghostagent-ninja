/**
 * scripts/fetch-sld-images.mjs
 * Run as part of `prebuild` to download SLD background images from Lighthouse
 * and save them to public/sld-images/ so they're served as static assets.
 * This avoids runtime IPFS fetches in the serverless genome-image route.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'sld-images');
const GATEWAY = 'https://gateway.lighthouse.storage/ipfs';

const SLD_IMAGES = {
  agent:    'bafkreihdpulp5riv3dkhtomi2iurgeypvplhdsi3nnkumzmvx725xc4yly',
  openclaw: 'bafkreigyk2c7gg5ijwvg4v6pyopcioatdjsfffvnkplgqyc2t3jowe3t7e',
  molt:     'bafkreicyrwnh4oxk4e53kly7kzmlpb345pqr5gd2v5acf4kcyl75e4hjdy',
  picoclaw: 'bafkreic7ec6elxd7b425wpsovvgkumidkqsxmgj5ffnhp6icznagaqlgti',
  vault:    'bafkreibxujpkkylek6uznnl2d2d4vmpxi3aiowxyx2ydf5xo4xexcnksau',
  nftmail:  'bafkreiftlxmthuftcrcxa27jtsigsuf2s37dngcxpmqrnhefjaybstpscm',
};

mkdirSync(OUT_DIR, { recursive: true });

let allOk = true;

for (const [sld, cid] of Object.entries(SLD_IMAGES)) {
  const url = `${GATEWAY}/${cid}`;
  const outPath = join(OUT_DIR, `${sld}.png`);
  try {
    console.log(`Fetching ${sld} (${cid.slice(0, 16)}…)`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ghostagent-prebuild/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    writeFileSync(outPath, Buffer.from(buf));
    console.log(`  ✓ saved ${sld}.png (${(buf.byteLength / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`  ✗ failed ${sld}: ${err.message}`);
    allOk = false;
  }
}

if (!allOk) {
  console.warn('Some SLD images failed to fetch — gradient SVG fallback will be used for those.');
}
