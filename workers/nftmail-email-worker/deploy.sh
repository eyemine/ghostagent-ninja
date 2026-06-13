#!/bin/bash
# Run from anywhere — deploys nftmail-email-worker to Cloudflare
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "▶ Deploying from: $SCRIPT_DIR"
npx --prefix "$SCRIPT_DIR" wrangler deploy --config "$SCRIPT_DIR/wrangler.toml"
echo "✅ nftmail-email-worker deployed"
