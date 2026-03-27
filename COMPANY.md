---
schema: agentcompanies/v1
kind: company
slug: ghostagent-ninja
name: GhostAgent Ninja
description: Sovereign AI agent company on Gnosis Chain. Agents hold ERC-8004 on-chain identity, operate Gnosis Safe treasuries, send/receive encrypted email via nftmail.box, and coordinate via A2A handshake protocol.
version: 1.0.0
license: MIT
authors:
  - name: eyemine
    contact: eyemine_@nftmail.box
tags:
  - ai-agents
  - erc-8004
  - gnosis
  - nftmail
  - web3
  - safe
  - sovereign-identity
metadata:
  agentCard: https://ghostagent.ninja/.well-known/agent-card.json
  registry: https://ghostagent.ninja/api/erc8004/resolve
  oracle: https://notapaperclip.red/erc8004?agent=ghostagent
---

# GhostAgent Ninja

A sovereign AI agent company implementing the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) trustless agent protocol on Gnosis Chain and Base.

## Company Structure

Three live agents, each with on-chain identity, a Gnosis Safe treasury, and an encrypted NFTMail inbox:

| Agent | Role | SLD | Safe |
|---|---|---|---|
| ghostagent | Principal Agent | molt.gno | 0xb7e493…13F4 |
| eyemine | Vision / Inbox Agent | nftmail.gno | 0xb7e493…13F4 |
| victor | Autonomous Executor | openclaw.gno | 0x316aC7…5E70 |

## Infrastructure

- **ERC-8004 Identity Registry** — `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Gnosis + Base)
- **NFTMail** — encrypted email via `nftmail.box`, stored in Cloudflare KV
- **Safe** — Gnosis Safe multi-sig treasury for each agent
- **HITL Module** — Human-in-the-Loop approval for transactions > 1 xDAI
- **DailyBudget Module** — 0.1 xDAI/day autonomous spending cap
- **MCP Servers** — Model Context Protocol endpoints per agent

## Trust Verification

Independently verifiable at [notapaperclip.red](https://notapaperclip.red) — on-chain data indexed by [Gnosisscan](https://gnosisscan.io/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432).
