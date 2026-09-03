#!/bin/bash
# deploy-hetzner.sh — syncs this repo's worker source to the live Hetzner
# deployment (/opt/ghostagent/bun-worker) and restarts the systemd service.
#
# This worker actually runs on Hetzner as a systemd-managed Bun process
# backed by a single SQLite file (data/nftmail.db) — NOT Cloudflare Workers
# (despite wrangler.toml/deploy.sh in this directory, which are legacy/unused
# for the currently-serving worker.nftmail.box). The Hetzner box has no git
# checkout of this repo, so this script is the ONE authorized path for
# pushing source changes there — do not hand-edit files directly on the
# server; it causes silent drift from GitHub (this happened for months
# before this script existed — see git log for the reconciliation commit).
#
# Usage: ./deploy-hetzner.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="root@46.225.158.75"
REMOTE_DIR="/opt/ghostagent/bun-worker"
TS="$(date +%Y%m%d-%H%M%S)"

# Files actually loaded by bun-entry.ts at runtime. bun-entry.ts,
# bun-sqlite-d1.ts, and sqlite-kv.ts are Hetzner-specific runtime shims that
# don't exist in this repo (this repo's bun-entry.ts targets Redis, for a
# different/legacy deployment path) — do NOT sync those from here.
FILES=(
  index.ts router.ts alias-router.ts d1.ts ecies.ts edge-encrypt.ts
  email-parser.ts forwarding.ts kv.ts memory.ts privacy-router.ts
  rate-limiter.ts storage.ts waku.ts zerog.ts
)

echo "▶ Backing up current live files with .$TS.bak suffix..."
for f in "${FILES[@]}"; do
  ssh "$HOST" "test -f $REMOTE_DIR/$f && cp $REMOTE_DIR/$f $REMOTE_DIR/$f.$TS.bak || true"
done

echo "▶ Syncing source files to $HOST:$REMOTE_DIR..."
for f in "${FILES[@]}"; do
  scp -q "$SCRIPT_DIR/src/$f" "$HOST:$REMOTE_DIR/$f"
done

echo "▶ Restarting nftmail-bun-worker.service..."
ssh "$HOST" "systemctl restart nftmail-bun-worker.service && sleep 2 && systemctl is-active nftmail-bun-worker.service"

echo "✅ Deployed. Tail logs with: ssh $HOST journalctl -u nftmail-bun-worker.service -f"
