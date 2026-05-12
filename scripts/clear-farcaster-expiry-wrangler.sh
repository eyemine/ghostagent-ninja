#!/bin/bash
# Clear Farcaster expiry using wrangler CLI
# Usage: ./scripts/clear-farcaster-expiry-wrangler.sh
# Requires: npm i -g wrangler && wrangler login

echo "Listing all acct-tier keys..."
npx wrangler kv:key list --binding=INBOX_KV --preview=false --json 2>/dev/null | jq -r '.[] | select(.name | startswith("acct-tier:")) | .name' > /tmp/tier-keys.txt

TOTAL=$(wc -l < /tmp/tier-keys.txt)
echo "Found $TOTAL tier entries to check"

UPDATED=0
SKIPPED=0

while read -r key; do
  agentName="${key#acct-tier:}"
  
  # Get current value
  value=$(npx wrangler kv:key get "$key" --binding=INBOX_KV --preview=false 2>/dev/null)
  
  if [ -z "$value" ]; then
    echo "[SKIP] $agentName: no data"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  
  # Check if basic tier with expires_at
  is_basic=$(echo "$value" | jq -r 'select(.tier == "basic") | .tier')
  expires_at=$(echo "$value" | jq -r '.expires_at // "null"')
  
  if [ "$is_basic" != "basic" ]; then
    echo "[SKIP] $agentName: tier=$is_basic"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  
  if [ "$expires_at" = "null" ]; then
    echo "[SKIP] $agentName: already no expiry"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  
  # Update: clear expires_at
  new_value=$(echo "$value" | jq '.expires_at = null | .account_ttl = "never"')
  
  # Put back (using printf to handle special chars)
  printf '%s' "$new_value" | npx wrangler kv:key put "$key" --binding=INBOX_KV --preview=false --path=- 2>/dev/null
  
  if [ $? -eq 0 ]; then
    echo "[UPDATED] $agentName: cleared expiry (was $expires_at)"
    UPDATED=$((UPDATED + 1))
  else
    echo "[ERROR] $agentName: failed to update"
  fi
  
  # Rate limit protection
  sleep 0.1
  
done < /tmp/tier-keys.txt

echo ""
echo "Done: $UPDATED updated, $SKIPPED skipped"
rm -f /tmp/tier-keys.txt
