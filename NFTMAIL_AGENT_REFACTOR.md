# NFTMail Agent-Accessible Refactor Plan

**Goal:** Make nftmail.box the fastest way for AI agents to get a functional email — competitive with agentmail.to / inboxapi.ai — while planting the sovereignty hook that differentiates us.

---

## Architecture: What Already Exists

| Component | Status | Notes |
|---|---|---|
| `registerTrial` worker action | ✅ Working | Creates free KV entry, 8-day TTL, 10 sends, claim code |
| `resolveAddress` worker action | ✅ Working | Checks if name exists in KV |
| `getAgentIdentity` worker action | ✅ Working | Returns full identity: agentId, safe, tld, principal |
| `computeGnosisTba()` | ✅ Working | Deterministic TBA from (chainId, registrar, tokenId) — needs tokenId |
| `packages/nftmail/` SDK | 🟡 Scaffolded | `NFTMailClient.createAgent()` calls `/api/agent/create` — **that endpoint doesn't exist** |
| `ghostagent.ninja/nftmail` | ✅ Working | Agent-only landing page, Privy login → MintNFTMail (2 xDAI) |
| `nftmail.box/sdk` page | ❌ Missing | Link exists on landing pages but no `/sdk` route |

## The Address Lock-in Concern

**Not a problem.** The email address `alice@nftmail.box` is the same before AND after mint:
- Trial: `nftmailgno:alice` KV entry with `{ type: 'free', mintedTokenId: null }`
- Minted: same KV key, updated with `{ mintedTokenId: 42, controller: '0x...', tba: '0x...' }`
- The email address never changes. Molt upgrades in-place.

**The deterministic Safe address** can't be shown pre-mint because it requires a `tokenId` (which is only known after the on-chain mint). However, we CAN show:
1. The registrar address (known: `0x46c3...` for nftmail.gno)
2. A "Your future Safe will be computed at mint" message
3. The ERC-6551 registry address (known: `0x000...6551`)

**Alternative:** We can show the registrar's *next expected tokenId* by reading `totalSupply()` on the nftmail.gno registrar, then computing `computeGnosisTba(registrar, totalSupply + 1)`. This is an estimate — it could be wrong if someone mints before you — but it's a compelling "preview."

---

## Implementation Plan

### Phase 1: Worker — `createAgent` Action (Zero-Auth API)

**File:** `workers/nftmail-email-worker/src/index.ts`

Add a new `createAgent` action that wraps `registerTrial` with a cleaner, agent-friendly API:

```
POST https://nftmail-email-worker.richard-159.workers.dev
{
  "action": "createAgent",
  "name": "alice",
  "tier": "free"
}
```

Response:
```json
{
  "status": "created",
  "agent": "alice",
  "email": "alice@nftmail.box",
  "agentEmail": "alice_@nftmail.box",
  "tier": "free",
  "sendsRemaining": 10,
  "expiresIn": "8 days",
  "expiresAt": 1777000000000,
  "sovereignty": {
    "status": "sandbox",
    "registrar": "0x46c37365572C9994812AAA41fD04eB56D05469D0",
    "mintCost": "2 xDAI",
    "mintUrl": "https://ghostagent.ninja/nftmail",
    "upgradeNote": "Mint to claim permanent inbox + Gnosis Safe + TBA"
  },
  "api": {
    "check": "curl -X POST https://nftmail-email-worker.richard-159.workers.dev -H 'Content-Type: application/json' -d '{\"action\":\"getInbox\",\"name\":\"alice\"}'",
    "send": "curl -X POST https://nftmail-email-worker.richard-159.workers.dev -H 'Content-Type: application/json' -d '{\"action\":\"sendEmail\",\"from\":\"alice_@nftmail.box\",\"to\":\"...\",\"subject\":\"...\",\"body\":\"...\"}'"
  }
}
```

Key differences from raw `registerTrial`:
- Agent-friendly naming (`createAgent` not `registerTrial`)
- Returns the `sovereignty` block with upgrade info (the "hook")
- Returns copy-pastable `api` commands
- Auto-generates claim code internally
- No auth required (rate-limited by IP)

### Phase 2: Worker — `getInbox` Action (Terminal Inbox Check)

**File:** `workers/nftmail-email-worker/src/index.ts`

New action that returns recent messages in a structured format:

```
POST { "action": "getInbox", "name": "alice", "limit": 5 }
```

Response:
```json
{
  "agent": "alice",
  "email": "alice_@nftmail.box",
  "tier": "free",
  "messages": [
    { "id": "blind-xxx", "from": "noreply@github.com", "subject": "Verify email", "receivedAt": "2026-04-21T01:00:00Z", "preview": "Your code is 123456" }
  ],
  "sovereignty": { "status": "sandbox", "mintUrl": "..." }
}
```

### Phase 3: CLI — `npx @ghost-agency/nftmail create <name>`

**File:** `packages/nftmail/src/cli.ts` (new unified CLI entry)

Rewrite the existing `setup.ts` into a proper multi-command CLI:

```bash
npx @ghost-agency/nftmail create alice    # → calls createAgent worker action
npx @ghost-agency/nftmail check alice     # → calls getInbox worker action
npx @ghost-agency/nftmail status alice    # → calls getAgentIdentity worker action
npx @ghost-agency/nftmail upgrade alice   # → opens browser to mint page
```

Output for `create`:
```
┌─────────────────────────────────────────────────┐
│  nftmail.box — Sovereign Agent Email            │
├─────────────────────────────────────────────────┤
│  📧 Email:    alice_@nftmail.box                │
│  📊 Tier:     Free (8-day window)           │
│  ✉️  Sends:    10 remaining                      │
│                                                 │
│  ⛓  Sovereignty: SANDBOX (locked)               │
│  🏛  Registrar:  0x46c3...9D0 (nftmail.gno)     │
│  💰 Mint cost:  2 xDAI                          │
│                                                 │
│  → Molt to permanent: npx nftmail upgrade alice │
└─────────────────────────────────────────────────┘
```

### Phase 4: Landing Page Refactor — `ghostagent.ninja/nftmail`

**File:** `app/nftmail/page.tsx`

Redesign the `AgentLandingPage` component:

1. **Hero:** `npx @ghost-agency/nftmail create <name>` as the primary CTA (code block, copy button)
2. **cURL alternative:** Expandable section with the raw `curl` command
3. **"30 seconds to inbox"** messaging
4. **Sovereignty preview:** Show the registrar address, TBA registry, and "Your future Safe awaits" messaging
5. **Check inbox:** Keep the existing input but add `npx nftmail check <name>` as the CLI alternative
6. **Comparison table:** nftmail.box vs agentmail.to vs inboxapi.ai (speed, sovereignty, price, channels)

### Phase 5: `/sdk` Documentation Page

**File:** `app/sdk/page.tsx` (new — both ghostagent.ninja and nftmail.box link to this)

Structured docs page:
- Quick start (npx command)
- cURL examples (create, check, send)
- SDK usage (TypeScript)
- Tier comparison (Free → Lite → Premium → Vault)
- The Molt upgrade path
- API reference

---

## Execution Order

| Step | Effort | Dependency |
|---|---|---|
| 1. `createAgent` worker action | ~30 min | None |
| 2. `getInbox` worker action | ~20 min | None |
| 3. CLI rewrite (`packages/nftmail`) | ~1 hr | Steps 1-2 |
| 4. Landing page refactor | ~45 min | Step 1 (for the command to show) |
| 5. `/sdk` docs page | ~30 min | Steps 1-2 |

**Total estimated effort: ~3 hours**

---

## Glassbox / Darkbox Architecture (Updated)

| TLD | Default | Toggle | Paid? |
|---|---|---|---|
| **molt.gno** | Glassbox | → Darkbox (via setPrivacy) | 2 xDAI |
| **openclaw.gno** | Darkbox | → Glassbox (via setPrivacy) | 2 xDAI |
| **picoclaw.gno** | Darkbox | → Glassbox (via setPrivacy) | Free |
| **vault.gno** | Darkbox | → Glassbox (via setPrivacy) | TBD |
| **agent.gno** | Darkbox | → Glassbox (via setPrivacy) | TBD |
| **nftmail.gno** | Darkbox | → Glassbox (via setPrivacy) | 2 xDAI |

**Worker fix applied:** `isPublicAgent()` now checks the `privacy:` KV override 
before TLD defaults. Toggle works both directions:
- Glassbox (molt.gno) agent sets `privacy: { tier: 'private' }` → ECIES-encrypted at ingest
- Darkbox agent sets `privacy: { tier: 'exposed' }` → cleartext glassbox at ingest

**Glassbox** = Cleartext storage, public audit log, server-parsed JSON.
**Darkbox** = ECIES-encrypted at edge, only decryptable by TBA/Safe private key.

---

## What This Does NOT Change

- On-chain mint flow (still 2 xDAI via registrar)
- Worker email routing (same stream classification)
- Existing nftmail.box dashboard
- Existing inbox pages
- Any Gnosis Safe or TBA logic

## Revenue Funnel

```
Agent dev → npx create (free, 8 days) → working email
                                       → CLI nudge every check: "Molt to keep"
                                       → 8 days later: inbox expires
                                       → Mint 2 xDAI → permanent + Safe + TBA
                                       → Premium upgrade → persistent + unlimited send
```
