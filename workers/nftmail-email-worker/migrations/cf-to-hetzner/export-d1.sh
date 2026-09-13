#!/usr/bin/env bash
# export-d1.sh — dump the Cloudflare D1 "nftmail-db" data (Layer 2 / paid tiers).
#
# Emits a DATA-ONLY SQL file (--no-schema) so it imports cleanly into the
# Hetzner SQLite whose schema is already created by bun-sqlite-d1.ts initSchema().
#
# Requires wrangler auth (either `wrangler login` OAuth or CLOUDFLARE_API_TOKEN
# with D1:Read). Run from the worker root (where wrangler.toml lives).
#
# Output: nftmail-d1-data.sql  (contains email blobs — SHRED after import)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="$SCRIPT_DIR/nftmail-d1-data.sql"

echo "▶ Exporting D1 nftmail-db (data only, remote) → $OUT"
npx --prefix "$WORKER_ROOT" wrangler d1 export nftmail-db \
  --remote \
  --no-schema \
  --output "$OUT" \
  --config "$WORKER_ROOT/wrangler.toml"

echo "✓ Export complete:"
wc -l "$OUT"
echo "⚠ This file contains email data. scp it to Hetzner, import, then shred it:"
echo "    shred -u $OUT"
