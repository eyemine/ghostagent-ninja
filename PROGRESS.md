# GhostAgent.ninja — Development Progress Log

Last updated: 2026-03-26

## Three active repos

| Repo | Local path | Deploy |
|---|---|---|
| ghostagent_ninja | `/Users/richieogorman/CascadeProjects/ghostagent_ninja` | Netlify → ghostagent.ninja |
| nftmailbox-netlify | `/Users/richieogorman/CascadeProjects/nftmailbox-netlify` | Netlify → nftmail.box |
| ghostagent-proxy | `/Users/richieogorman/CascadeProjects/ghostagent-proxy` | Cloudflare Worker → ghostagent-proxy.richard-159.workers.dev |
| notapaperclip-nextjs | `/Users/richieogorman/CascadeProjects/notapaperclip-nextjs` | Netlify → notapaperclip.red |

---

## Cloudflare Worker

**URL:** `https://nftmail-email-worker.richard-159.workers.dev`  
**File:** `workers/nftmail-email-worker/src/index.ts`

### All implemented actions (complete list)

**Email / Inbox**
- `getInbox`, `getAgentStatus`, `ghostRoute`, `mailgunInbound`, `zohoWebhook`, `sendA2A`, `wakuRoute`

**Agent Registry**
- `getAgentIdentity`, `setAgentRecord`, `setAgentProfile`, `getAgentProfile`, `setTld`, `listAgents`, `listNftmailByController`

**ERC-8004**
- `setErc8004AgentId` (via worker)

**Sovereign / NFTMail**
- `registerSovereign`, `upgradeTier`, `freezeEmail`, `resolveAddress`

**Molt / Beacon**
- `getMoltPath`, `setMoltPath`, `setBeacon`, `getBeacon`

**Calendar / Handshake**
- `getCalendar`, `scheduleEvent`

**Privacy**
- `setPrivacy`, `getPrivacy`, routeSetPrivacy

**Alias**
- `getAlias`, `createAlias`, `setAliasDisplay`, `deleteAlias`

**DeviantClaw**
- `deviantclaw:setKey`, `deviantclaw:register`, `deviantclaw:solo`, `deviantclaw:match`, `deviantclaw:join`, `deviantclaw:approve`, `deviantclaw:profile`

**Collection Identity**
- `whitelistedCollections`, `resolveCollection`

**Episodic Memory + Cross-Agent Coordination** ← NEW (2026-03-26)
- `setMemory` — append entries to rolling per-agent buffer (`memory:{agentName}`, cap 200)
- `getRecentMemory` — retrieve last N entries, filter by `tag` or `sessionId`
- `setSharedContext` — write to shared namespace (`shared-ctx:{namespace}`); `secure:` prefix requires WEBHOOK_SECRET
- `getSharedContext` — read a namespace
- `listSharedContext` — enumerate all `shared-ctx:*` keys (optional prefix filter)

### KV key namespaces
```
blind:{name}:{id}       — email envelopes (ECIES or cleartext)
blind-index:{name}      — index of blind IDs per agent
audit:{name}            — glass-box audit log
acct-tier:{name}        — tier record { tier, retention, expires_at, safe, story_ip }
nftmailgno:{name}       — sovereign identity record
privacy:{name}          — privacy tier
ecies-pubkey:{name}     — ECIES public key
memory:{name}           — episodic memory buffer (array, newest-last)
shared-ctx:{namespace}  — cross-agent shared context { data, writer, updatedAt }
molt-path:{name}        — MoltPathRecord
beacon:{name}           — beacon CID + metadataUrl
tld:{name}              — SLD for listAgents
erc8004:gnosis:{name}   — ERC-8004 agentId on Gnosis
erc8004:base:{name}     — ERC-8004 agentId on Base
profile:{name}          — off-chain agent profile JSON
zoho-seat:{name}        — Zoho mailbox registration
deviantclaw:apikey:{name}
deviantclaw:agentid:{name}
social-registered:{name}
nft-token:{sld}:{tokenId}
```

---

## Mailgun Integration (IN PROGRESS)

**Sending domain:** `mg.nftmail.box`  
**API base:** `https://api.eu.mailgun.net/v3`

### What's done
- `app/api/send-email/route.ts` — rewritten to send via Mailgun for all tiers except Imago (Zoho seat). `From: label@nftmail.box` direct, no ghostagent relay.
- `app/api/send/route.ts` — rewritten, Mailgun only.
- Worker `mailgunInbound` action — HMAC-SHA256 signature verification, normalises to `ghostRoute` path.
- `MAILGUN_API_KEY` set in Netlify (nftmailbox).

### Still needed (user action)
1. **Netlify env vars** (nftmailbox-netlify deployment):
   - `MAILGUN_DOMAIN=mg.nftmail.box`
   - `NEXT_PUBLIC_APP_URL=https://nftmail.box`
   - `ETH_RPC_URL=<mainnet rpc>` (for ENS verification; defaults to publicnode)
2. **Cloudflare worker secrets**:
   - `MAILGUN_API_KEY` (secret)
   - `MAILGUN_DOMAIN=mg.nftmail.box`
3. **DNS records** in `.box` registrar panel for `mg.nftmail.box`:
   - TXT `mg` → Mailgun SPF value
   - TXT `s1._domainkey.mg` → Mailgun DKIM value
   - MX `mg` → `mxa.eu.mailgun.org` (priority 10) + `mxb.eu.mailgun.org` (priority 10)
   - CNAME `email.mg` → `mailgun.org`
4. **After DNS verifies** → swap `@` MX from `mx.zoho.com.au` to Mailgun MX records (cutover)

---

## nftmail.box — Key Features

### Mint tiers
- **Larva (free):** 8-day history, receive only. Gasless treasury mint via `/api/gasless-mint`.
- **Pupa (10 xDAI):** 30-day cycle, send + receive, Gnosis Safe body.
- **Imago (24/yr):** Infinite retention, Story IP NFT, Zoho seat (direct delivery).
- **Ghost:** Sovereign agent, governance.

### ENS Holder free mint ← NEW (2026-03-26)
- `MintNFTMailWithCallback` has 3 tabs: Human / ENS Holder / Agent
- ENS Holder tab: user enters `name.eth`, server verifies `ownerOf(keccak256(label))` on ENS BaseRegistrar (`0x57f1887...`)  against connected wallet
- On match: mints `label.nftmail.gno` gasless, bypasses daily rate limit
- Component: `MintNFTMail` accepts `ensName` prop → passed as `ensProof` to `/api/gasless-mint`

### og:image fix (2026-03-26)
- `app/layout.tsx` — `APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nftmail.box'`
- og:image now absolute URL (was relative `/nftmail-logo.png`, broke social shares)

---

## ghostagent.ninja — Key Features

### Dashboard routes
- `/dashboard` — agent overview
- `/dashboard/hitl` — self-service HITL module deploy (requires `NEXT_PUBLIC_HITL_FACTORY_ADDRESS`)
- `/agent/[name]` — public agent profile page
- `/api/agent-card` — ERC-8004 agent card endpoint (Cache-Control: no-store)

### Key contracts (Gnosis mainnet, chain 100)
- **ERC-8004 Identity Registry:** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- **GNSSubnameResolver:** `0xc97c7166...` (all 6 SLDs wired)
- **HumanInTheLoopModule:** `0x012A0571d0DFd7eF85d0706875FEc39555e99A96` (needs enabling on ghostagent Safe)
- **HITLModuleFactory:** `0xB2Ad4C8368c8C02976124a5f75F951Fd24C5631D` (set `NEXT_PUBLIC_HITL_FACTORY_ADDRESS` in Netlify)
- **DailyBudgetModule:** `0xdd80e384cAc42b4e17e0edf0609573E4A16C6d4e`

### Registrars (Gnosis mainnet)
- `molt.gno`: `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50`
- `nftmail.gno`: `0x831ddd71e7c33e16b674099129E6E379DA407fAF`
- `openclaw.gno`: `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe`
- `picoclaw.gno`: `0xe5fd65562698f46ea9762bd38141535b1fd875b5`
- `agent.gno`: (via ghostagent_ninja gasless-mint route)

### Key agents
| Agent | SLD | Gnosis agentId | Safe |
|---|---|---|---|
| ghostagent | molt.gno | 3199 | 0xb7e493e3d226f8fE722CC9916fF164B793af13F4 |
| eyemine | nftmail.gno | 3205 | 0xb7e493e3d226f8fE722CC9916fF164B793af13F4 |
| victor | openclaw.gno | 3206 | 0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70 |

### ghostagent-proxy (Cloudflare Worker)
**URL:** `https://ghostagent-proxy.richard-159.workers.dev`  
Telegram bot → Moltbook bridge. Key commands:
- `/post submolt | body text` — auto-derives title from first line (≤300 chars), rest = content ← FIXED 2026-03-26
- `/reply postId | content`
- `/verify code | answer`

**Farcaster:** switched from hand-rolled protobuf → **Neynar REST API** (`/v2/farcaster/cast`) ← FIXED 2026-03-26  
**Account:** `@ghostagent-ninja` (FID created via Neynar Agents UI, Starter plan $9/mo)  
Secrets set: `NEYNAR_API_KEY` + `NEYNAR_SIGNER_UUID` ✅ LIVE 2026-03-26  
Both `/post` and `/reply` now cross-post to Farcaster.

**X (Twitter):** `⚠️ X post failed: PAYWALL` is expected — X API free tier is read-only. Requires Basic plan ($100/mo) at developer.x.com to enable write access.

---

## Pending tasks (priority order)

### High
1. **mailgun-mx-cutover** — DNS records confirmed set up. Swap `@` MX from Zoho → Mailgun after DNS verifies in Mailgun dashboard

### Medium
3. **hitl-factory** — Enable HITL module on Victor Safe (`app.safe.global` → Settings → Modules → `0x012A0571...`)
4. **Set `NEXT_PUBLIC_HITL_FACTORY_ADDRESS=0xB2Ad4C8368c8C02976124a5f75F951Fd24C5631D`** in ghostagent.ninja Netlify env

### Low
5. **pl-genesis** — Submit to PL_Genesis after Synthesis closes
6. **victor TBA** — `0x56e71aa4bddfdfae7805de8f0a1f68c34748efbb` EIP-1167 proxy not yet responding to ERC-6551 calls — deferred

---

## Architecture notes

### Episodic memory pattern (KV stopgap vs HydraDB)
- KV rolling buffer gives 80% of what HydraDB offers for structured coordination
- **Sufficient for:** swarm task state passing, session history, agent-to-agent signals
- **Not sufficient for:** semantic/vector "find memories similar to X" queries
- HydraDB worth revisiting post-Synthesis for swarm verifier semantic layer
- Swarm pattern: `victor → setSharedContext(namespace: 'swarm:task', data: {...})` → `eyemine → getSharedContext` → `ghostagent → aggregates`

### Two nftmailbox copies
- `ghostagent_ninja/apps/nftmailbox/` — future agent-specific GUI (post-hackathon diverge)
- `nftmailbox-netlify` — public-facing nftmail.box (current source of truth)
- Keep in sync until post-Synthesis; when editing shared code: edit ghostagent_ninja/apps/nftmailbox (temporarily un-gitignore apps/), then cp to nftmailbox-netlify

### Email architecture (FINAL — 2026-03-26)

**Inbound split-MX:**
- `@` MX → Zoho (`mx.zoho.com.au` priority 0) — receives all `*@nftmail.box`
- imap-poll worker picks up from Zoho catchall (`ghostagent@nftmail.box`), stores in KV, deletes from Zoho (1-second cleartext window — unavoidable with this split, acceptable for non-Imago)
- `mg` MX → Mailgun (`mg.nftmail.box`) — for **sending only**, nobody sends to this subdomain
- Mailgun inbound webhook (`mailgunInbound` action) is wired and ready; worker auto-detects `multipart/form-data`; not active for inbound because Mailgun doesn't receive `@nftmail.box`
- **Imago users:** Zoho direct seat, email delivered natively, no KV hop

**Outbound:**
- Mailgun API via `mg.nftmail.box`, `From: label@nftmail.box` (all tiers except Imago)
- Imago: Zoho direct send (unchanged)

**Exempt from Zoho delete:** `EXEMPT_FROM_DELETE = ['admin', 'ghostagent']` (line ~2613 of index.ts)

### Farcaster (Neynar) — 2026-03-26
- Replaced hand-rolled Ed25519 protobuf → **Neynar REST API** `POST /v2/farcaster/cast`
- Env vars: `NEYNAR_API_KEY` + `NEYNAR_SIGNER_UUID` (set in ghostagent-proxy Cloudflare Worker)
- Account: `@ghostagent-ninja` on Farcaster (Neynar Agents UI, Starter plan $9/mo)
- Both `/post` and `/reply` Telegram commands cross-post to Farcaster ✅
- **X (Twitter):** `⚠️ X post failed: PAYWALL` is expected — free tier is read-only; Basic plan ($100/mo) required for write access
