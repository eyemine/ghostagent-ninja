#!/bin/bash
# Upgrade Chonk agents to lite tier (Pro display)

WORKER_URL="https://nftmail-email-worker.richard-159.workers.dev"

echo "Enter WEBHOOK_SECRET:"
read -s WEBHOOK_SECRET

# List of Chonk agents to upgrade (add more as needed)
AGENTS=("chonk-697" "chonk-9534")

for agent in "${AGENTS[@]}"; do
  echo "Upgrading $agent..."
  curl -X POST "$WORKER_URL" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"upgradeNinjaTier\",\"label\":\"$agent\",\"newTier\":\"lite\",\"secret\":\"$WEBHOOK_SECRET\"}"
  echo ""
done

echo "Done!"
