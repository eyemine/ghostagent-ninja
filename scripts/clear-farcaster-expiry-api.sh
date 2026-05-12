#!/bin/bash
# Clear Farcaster expiry using Cloudflare REST API
# Requires: CF_ACCOUNT_ID and CF_API_TOKEN env vars

set -e

if [ -z "$CF_ACCOUNT_ID" ] || [ -z "$CF_API_TOKEN" ]; then
  echo "Error: Set CF_ACCOUNT_ID and CF_API_TOKEN"
  echo "Get API token from: https://dash.cloudflare.com/profile/api-tokens"
  exit 1
fi

# Get namespace ID for INBOX_KV
NAMESPACE_ID=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[] | select(.title | contains("INBOX")) | .id' | head -1)

if [ -z "$NAMESPACE_ID" ]; then
  echo "Error: Could not find INBOX_KV namespace"
  exit 1
fi

echo "Using namespace: $NAMESPACE_ID"
echo "Listing acct-tier keys..."

# List keys with acct-tier prefix
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$NAMESPACE_ID/keys?prefix=acct-tier:" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[].name' > /tmp/tier-keys.txt

TOTAL=$(wc -l < /tmp/tier-keys.txt)
echo "Found $TOTAL tier entries to check"

if [ "$TOTAL" -eq 0 ]; then
  echo "No acct-tier keys found"
  exit 0
fi

UPDATED=0
SKIPPED=0

while read -r key; do
  agentName="${key#acct-tier:}"
  
  # Get current value
  value=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$NAMESPACE_ID/values/$key" \
    -H "Authorization: Bearer $CF_API_TOKEN" 2>/dev/null)
  
  if [ -z "$value" ] || [ "$value" = "null" ]; then
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
  
  # Put back
  response=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$NAMESPACE_ID/values/$key" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$new_value")
  
  if echo "$response" | jq -e '.success' > /dev/null; then
    echo "[UPDATED] $agentName: cleared expiry (was $expires_at)"
    UPDATED=$((UPDATED + 1))
  else
    echo "[ERROR] $agentName: failed to update"
    echo "$response" | jq '.errors'
  fi
  
  # Rate limit protection
  sleep 0.2
  
done < /tmp/tier-keys.txt

echo ""
echo "Done: $UPDATED updated, $SKIPPED skipped"
rm -f /tmp/tier-keys.txt
