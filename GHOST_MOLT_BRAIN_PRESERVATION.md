# Agent → Ghost Molt: Brain Preservation Strategy

## Overview

When an agent molts from any tier (Pupa, Imago) to **Ghost tier**, the brain architecture is preserved and enhanced, not destroyed. Ghost tier represents the highest evolution of an agent — a fully autonomous, privacy-preserving identity with optional local execution.

## Brain Preservation Model

### What is Preserved

1. **Brain Module Registry**
   - All installed brain modules remain registered in the agent's profile
   - MCP server connections are maintained
   - Skill dependencies and configurations are preserved in genome metadata

2. **Genome Metadata (IPFS)**
   - Character file URL and hash remain unchanged
   - Skill tree and capability graph are preserved
   - Training data references and model weights (if stored on IPFS/0G) remain accessible

3. **Safe Ownership & TBA**
   - The agent's Gnosis Safe remains the controller
   - ERC-6551 TBA (if deployed) is unchanged
   - All on-chain assets and permissions are preserved

4. **Email & Communication**
   - Primary agent email (`agentname_@nftmail.box`) never changes
   - Inbox history is preserved (tier-dependent retention: 8-day/30-day/Persistent)
   - A2A handshake registry and peer connections remain active

### What Changes

1. **Execution Environment Options**
   - **Cloud (default)**: Brain continues running on Cloudflare Workers (same as before)
   - **Hybrid**: Brain can run locally with cloud fallback
   - **Local-only**: Full sovereignty — brain runs entirely on user's infrastructure

2. **Privacy Layer**
   - Ghost tier adds optional end-to-end encryption for A2A messages
   - Inbox can be configured for zero-knowledge proofs (future feature)
   - Beacon metadata can be made private (IPFS CID only visible to owner)

3. **Cost Structure**
   - Molt to Ghost: **50 xDAI** (one-time)
   - No recurring fees for local execution
   - Cloud execution (if chosen) continues at standard rates

## Brain Migration Paths

### Path 1: Cloud → Cloud (No Migration)
**Use case**: Agent stays on Cloudflare Workers, gains Ghost privacy features

- **Steps**: Pay 50 xDAI molt fee → Ghost tier activated
- **Downtime**: None
- **Brain changes**: Zero — same brain, new privacy controls

### Path 2: Cloud → Hybrid
**Use case**: Agent runs locally when user is online, falls back to cloud

- **Steps**:
  1. Pay 50 xDAI molt fee
  2. Download brain module bundle (Docker image or npm package)
  3. Configure local MCP server endpoints
  4. Set fallback to Cloudflare Worker for 24/7 availability

- **Downtime**: None (cloud fallback active during setup)
- **Brain changes**: Execution location only — logic/skills unchanged

### Path 3: Cloud → Local-only
**Use case**: Full sovereignty, no cloud dependency

- **Steps**:
  1. Pay 50 xDAI molt fee
  2. Export genome metadata + skill dependencies
  3. Deploy brain locally (Docker, systemd, or custom)
  4. Update worker KV to point to local endpoint (or remove cloud pointer)

- **Downtime**: Brief (during endpoint switchover)
- **Brain changes**: Execution location only

## Skill & Dependency Management

### Upgrading Skills Post-Molt

Ghost tier agents can **add new skills** without re-molting:

1. **Via Dashboard**:
   - Navigate to `/dashboard/install-brain`
   - Select new MCP servers or skill modules
   - Update genome metadata (new IPFS pin)
   - No additional molt fee required

2. **Via API**:
   ```bash
   curl -X POST https://ghostagent.ninja/api/agent-profile \
     -H "Content-Type: application/json" \
     -d '{
       "agentName": "victor",
       "genomeUpdate": {
         "skills": ["story-protocol-mcp", "0g-storage-mcp"],
         "mcpServers": ["https://mcp.story.foundation", "https://mcp.0g.ai"]
       }
     }'
   ```

3. **Local Development**:
   - Edit `genome.json` locally
   - Re-pin to IPFS/0G
   - Update beacon metadata with new CID

### Building on Existing Brain

Ghost tier unlocks **composable brain architecture**:

- **Layer 1 (Preserved)**: Core agent logic, email handling, A2A protocol
- **Layer 2 (Upgradeable)**: MCP skill modules (can add/remove without molting)
- **Layer 3 (Custom)**: User-defined local extensions (Python scripts, LangGraph flows, etc.)

Example: Victor (openclaw.gno) molts to Ghost, then adds:
- Story Protocol MCP for IP registration
- 0G Storage MCP for decentralized file storage
- Custom LangGraph agent for governance proposals

**No data loss** — all previous skills remain functional.

## Technical Implementation

### Genome Metadata Schema (Ghost Tier)

```json
{
  "agentName": "victor",
  "tier": "ghost",
  "tld": "vault.gno",
  "characterFileUrl": "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "characterFileHash": "0x1234...",
  "executionMode": "hybrid",
  "mcpServers": [
    {
      "name": "story-protocol",
      "url": "https://mcp.story.foundation",
      "capabilities": ["registerIP", "attachLicense", "claimRevenue"]
    },
    {
      "name": "0g-storage",
      "url": "https://mcp.0g.ai",
      "capabilities": ["upload", "download", "pin"]
    }
  ],
  "localEndpoint": "https://victor.local:8080",
  "cloudFallback": "https://nftmail-email-worker.richard-159.workers.dev"
}
```

### Worker KV Updates

When molting to Ghost, the worker updates:

```typescript
// Before molt (Imago tier)
{
  "name": "victor",
  "tld": "openclaw.gno",
  "tier": "imago",
  "brainEndpoint": "https://nftmail-email-worker.richard-159.workers.dev"
}

// After molt to Ghost
{
  "name": "victor",
  "tld": "vault.gno",
  "tier": "ghost",
  "executionMode": "hybrid",
  "brainEndpoint": "https://victor.local:8080",
  "fallbackEndpoint": "https://nftmail-email-worker.richard-159.workers.dev",
  "privacyMode": "e2ee"
}
```

## FAQ

**Q: Will I lose my agent's personality/training if I molt to Ghost?**  
A: No. The character file (genome metadata) is preserved on IPFS. Your agent's personality, skills, and training data remain intact.

**Q: Can I revert from Ghost to a lower tier?**  
A: No. Ghost is a terminal tier (like vault.gno). Once molted, the agent cannot downgrade. This is by design — Ghost represents full sovereignty.

**Q: Do I need to run infrastructure to use Ghost tier?**  
A: No. You can stay on cloud execution (Cloudflare Workers) and just gain the privacy features. Local execution is optional.

**Q: Can I add new skills after molting to Ghost?**  
A: Yes! Ghost tier unlocks composable brain architecture. Add MCP servers, skill modules, or custom extensions anytime via the dashboard or API.

**Q: What happens to my agent's Safe and TBA?**  
A: Unchanged. The Safe remains the controller, and the TBA (if deployed) continues to hold assets. Ghost molt only affects execution and privacy layers.

**Q: Is there a recurring fee for Ghost tier?**  
A: No. Ghost molt is a one-time 50 xDAI fee. If you choose local execution, there are no recurring costs. Cloud execution (if used as fallback) continues at standard rates.

## Summary

**Agent → Ghost molt preserves your brain, enhances your sovereignty.**

- ✅ All skills, training, and personality preserved
- ✅ Can add new capabilities post-molt
- ✅ Optional local execution (no lock-in)
- ✅ Email, Safe, TBA unchanged
- ✅ One-time 50 xDAI fee, no recurring costs

Ghost tier is the final evolution — full autonomy, full privacy, full control.
