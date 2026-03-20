# GhostAgent Ninja — Agent Instructions

AI coding agents (Cascade, Codex, Copilot, etc.) working in this repo should follow these instructions.

## Project Overview

**ghostagent.ninja** is a Next.js 14 app + Cloudflare Worker + Solidity contracts implementing the ERC-8004 trustless agent protocol on Gnosis Chain and Base.

- **Framework:** Next.js 14 (App Router), TypeScript, TailwindCSS
- **Smart contracts:** Foundry (Solidity), deployed on Gnosis mainnet + Base
- **Worker:** Cloudflare Workers (KV store for agent profiles, beacons, handshakes)
- **IPFS:** Lighthouse.storage for genome metadata, agent cards, attestations
- **Auth:** Privy (wallet connect), Gnosis Safe (multi-sig treasury)
- **Deploy:** Netlify (main app), Cloudflare Workers (worker)

## Architecture

```
app/
  api/           — Next.js API routes (agent-card, handshake, beacon, erc8004/*)
  services/      — Business logic (erc8004-registration, beacon-metadata, molt-path-tracker)
  dashboard/     — Owner UI (agent profile editor, handshake manager)
  agent/[name]/  — Public agent profile pages
workers/
  nftmail-email-worker/  — Cloudflare Worker: KV store, listAgents, setBeacon, setAgentProfile
src/             — Solidity contracts (GhostRegistry, BrainModule, ERC6551Account)
script/          — Foundry deploy scripts
```

## Key Agents

| Agent | SLD | Gnosis agentId | Safe |
|---|---|---|---|
| ghostagent | molt.gno | 3199 | 0xb7e493e3d226f8fE722CC9916fF164B793af13F4 |
| eyemine | nftmail.gno | 3205 | 0xb7e493e3d226f8fE722CC9916fF164B793af13F4 |
| victor | openclaw.gno | 3206 | 0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70 |

## Key Contracts (Gnosis mainnet, chain 100)

- **Identity Registry (ERC-8004):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- **molt.gno Registrar:** `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50`
- **openclaw.gno Registrar:** `0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe`
- **HumanInTheLoopModule:** `0x012A0571d0DFd7eF85d0706875FEc39555e99A96`
- **DailyBudgetModule:** `0xdd80e384cAc42b4e17e0edf0609573E4A16C6d4e`

## Worker (Cloudflare)

URL: `https://nftmail-email-worker.richard-159.workers.dev`

Key actions (POST with JSON body):
- `listAgents` — list agents by safeAddress
- `getAgentProfile` / `setAgentProfile` — off-chain ERC-8004 metadata
- `getAgentIdentity` — full identity including on-chain registrations
- `setBeacon` / `getBeacon` — IPFS beacon CID storage
- `setTld` / `setErc8004AgentId` — KV updates

KV key patterns: `erc8004:gnosis:{name}`, `tld:{name}`, `profile:{name}`, `beacon:{name}`

## Coding Rules

1. **TypeScript strict** — no `any` unless casting through `unknown` first
2. **Non-fatal Lighthouse pins** — always wrap Lighthouse API calls in try/catch, return `null` on failure, never throw. User actions must succeed even if IPFS is unavailable.
3. **No hardcoded agent lists** — use `listAgents` worker action keyed by wallet address
4. **Cache-Control: no-store** on all agent-card API routes — Netlify edge caching must not vary by stale query params
5. **SLD-keyed data** — agent capabilities and MCP servers are defined per SLD (`molt`, `nftmail`, `openclaw`, `picoclaw`, `vault`, `agent`) in `app/services/erc8004-registration.ts`
6. **Commit style** — `feat:`, `fix:`, `chore:` prefixes. Push to `main` (auto-deploys to Netlify)

## Environment Variables

See `env.example` for all required vars. Key ones:
- `LIGHTHOUSE_API_KEY` — Lighthouse.storage upload key
- `WEBHOOK_SECRET` — shared secret for worker KV mutations
- `NEXT_PUBLIC_WORKER_URL` — Cloudflare worker URL
- `NEXT_PUBLIC_PRIVY_APP_ID` — Privy auth app ID

## Current Pending Work

See `CODE_HEALTH.md` for known issues and tech debt.

High-priority tasks:
- Molt `ghostagent.molt.gno → vault.gno`
- Add victor TBA `0x56e71aa4bddfdfae7805de8f0a1f68c34748efbb` as signer on victor Safe
- Auth guard on `setAgentProfile` worker action (verify Safe ownership)
- Swarm demo data for Swarm Verifier
