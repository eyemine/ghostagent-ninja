# GhostAgent.ninja — ERC-8004 Trustless Agent Identity on Gnosis Chain

> Synthesis Hackathon 2026 · [Demo Video](https://youtu.be/4vDR0ULbjy0) · [Live](https://ghostagent.ninja) · [Trust Oracle](https://notapaperclip.red)

**Without this system, 10,000+ Gnosis Safes remain anonymous hex strings. With it, they are identities.**

GhostAgent.ninja implements [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — a trustless agent identity protocol where each AI agent's canonical identity is a `.gno` subname (e.g. `ghostagent.molt.gno`) that resolves to a Gnosis Safe. Agents get human-readable names, sovereign inboxes, and on-chain spending guardrails — so humans can trust agents with money, reputation, and deals.

---

## The Problem

When an AI agent controls a Gnosis Safe, that Safe has an address like `0xb7e493e3d226f8fE722CC9916fF164B793af13F4`. There is no human-readable name. No ENS name resolves to it. No reverse lookup works.

This breaks A2A (agent-to-agent) trust. When `ghostagent` instructs `victor` to execute a transaction, `victor` cannot verify the instruction came from the canonical `ghostagent.molt.gno` controller — it can only see a raw address.

**Human-in-the-loop requires human-readable names.** If a human operator is reviewing a pending transaction from `ghostagent.molt.gno → victor.openclaw.gno`, they can make an informed decision. If they see `0xb7e4...13F4 → 0x316a...5E70`, they cannot. ENS resolution for agent Safes is not a UX nicety — it is a safety primitive.

---

## What We Built

Three live agents, a trust oracle, and a sovereign email system — all wired together on-chain.

### Identity Layer (ERC-8004)

Each agent has a `.gno` subname → Gnosis Safe → ERC-6551 TBA stack:

| Agent | .gno Name | Safe | Inbox |
|---|---|---|---|
| ghostagent | `ghostagent.molt.gno` | `0xb7e4...13F4` | `ghostagent_@nftmail.box` |
| eyemine | `eyemine.nftmail.gno` | `0xb7e4...13F4` | `eyemine_@nftmail.box` |
| victor | `victor.openclaw.gno` | `0x316a...5E70` | `victor_@nftmail.box` |

**Ping the live agent card:**
```bash
curl https://ghostagent.ninja/.well-known/agent.json
```

**Resolve an agent's ERC-8004 identity on-chain:**
```bash
curl "https://notapaperclip.red/api/erc8004/resolve?agent=ghostagent"
```

### NFTmail.box — Sovereign Agent Inboxes

Agents receive instructions at `name_@nftmail.box` — minted as NFTs on Gnosis Chain, ECIES-encrypted, ownership verified on-chain.

**Verify the inbox ownership chain:**
```bash
curl "https://notapaperclip.red/api/erc8004/resolve?agent=ghostagent"
# → returns Safe address + agentId + nftmail inbox + spending modules
```

**Check any inbox live:**
- `https://nftmail.box/inbox/ghostagent_` — GhostAgent's agent inbox
- `https://nftmail.box/inbox/eyemine_` — Eyemine's Glass Box inbox (public)

### Spending Guardrails (Safe Modules)

| Module | Address | Purpose |
|---|---|---|
| HumanInTheLoopModule | `0x012A0571d0DFd7eF85d0706875FEc39555e99A96` | Blocks txns > 1 xDAI pending human approval |
| DailyBudgetModule | `0xdd80e384cAc42b4e17e0edf0609573E4A16C6d4e` | Hard daily spend cap: 0.1 xDAI |
| HITLModuleFactory | `0xB2Ad4C8368c8C02976124a5f75F951Fd24C5631D` | Self-service deploy — any Safe can add HITL in one tx |

### Trust Oracle — notapaperclip.red

An independent, read-only compliance oracle. Cannot forge or alter the data it displays.

```bash
# Swarm trust evaluation
curl "https://notapaperclip.red/api/verify/swarm?swarmId=ghostagent"

# A2A card validator
curl "https://notapaperclip.red/api/a2a/validate?url=https://ghostagent.ninja"

# Cross-chain agent lookup
curl "https://notapaperclip.red/api/agent-lookup?q=ghostagent"
```

---

## Live Contracts (Gnosis Mainnet, chain 100)

| Contract | Address |
|---|---|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Molt Registrar | `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50` |
| OpenClaw Registrar | `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe` |
| HumanInTheLoopModule | `0x012A0571d0DFd7eF85d0706875FEc39555e99A96` |
| DailyBudgetModule | `0xdd80e384cAc42b4e17e0edf0609573E4A16C6d4e` |
| HITLModuleFactory | `0xB2Ad4C8368c8C02976124a5f75F951Fd24C5631D` |

---

## Repository Structure

```
app/
  api/           — Next.js API routes (agent-card, handshake, beacon, erc8004/*)
  agents/        — Public agent directory with ENS reservation check
  dashboard/     — Owner UI (agent profile editor, HITL deploy, handshake manager)
  agent/[name]/  — Public agent profile pages
  services/      — ERC-8004 registration, beacon metadata, molt-path tracker
  utils/ensCheck.tsx — Shared ENS/GNS name reservation hook (used across apps)
workers/
  nftmail-email-worker/  — Cloudflare Worker: KV store, agent profiles, beacons
src/             — Solidity contracts (GhostRegistry, BrainModule, ERC6551Account)
script/          — Foundry deploy scripts
apps/nftmailbox/ — NFTmail.box frontend (deploys to nftmail.box)
```

---

## ENS Prize Track

We are specifically requesting ENS DAO support for:

1. **`.gno.eth` CCIP-Read resolver** — so `ghostagent.molt.gno` resolves via standard ENS lookups using EIP-3668
2. **Reverse resolution for Gnosis Safes** — so `0xb7e4...13F4` reverse-resolves to `ghostagent.molt.gno` in ENS tooling
3. **Safe-aware ENS profile standard** — agent's `.gno` subname as its ENS name, not the owner's `.eth` name

See [ENS-PRIZE.md](./ENS-PRIZE.md) for the full submission.

---

## Development

```bash
cp env.example .env.local
npm install
npm run dev
```

Key env vars: `LIGHTHOUSE_API_KEY`, `WEBHOOK_SECRET`, `NEXT_PUBLIC_WORKER_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`

See `env.example` for the full list.

---

## License

MIT
