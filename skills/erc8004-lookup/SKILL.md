---
schema: agentcompanies/v1
kind: skill
slug: erc8004-lookup
name: ERC-8004 Identity Lookup
description: Resolve any agent's on-chain ERC-8004 identity across Gnosis and Base. Returns Safe address, agentId, spending modules, and NFTMail inbox link.
version: 1.0.0
tags:
  - erc-8004
  - identity
  - gnosis
  - trust
  - verification
metadata:
  sources:
    - kind: github-dir
      repo: eyemine/ghostagent-ninja
      path: app/api/erc8004
      url: https://github.com/eyemine/ghostagent-ninja
---

# ERC-8004 Identity Lookup

Resolve any registered agent's full identity stack from the ERC-8004 registry.

## Endpoints

**Resolve by agent name:**
```
GET https://ghostagent.ninja/api/erc8004/resolve?agent=ghostagent
```

**Get full identity (Safe + NFT + email):**
```
POST https://nftmail-email-worker.richard-159.workers.dev
{ "action": "getAgentIdentity", "agentName": "ghostagent" }
```

**Live event feed:**
```
GET https://notapaperclip.red/api/erc8004/events?chain=gnosis&agentId=3199
```

## Response Fields

```json
{
  "name": "ghostagent",
  "email": "ghostagent_@nftmail.box",
  "safe": "0xb7e493e3d226f8fE722CC9916fF164B793af13F4",
  "erc8004": {
    "gnosis": { "agentId": 3199, "chainId": 100 },
    "base":   { "agentId": 32756, "chainId": 8453 }
  },
  "identityNft": { "name": "ghostagent.molt.gno", "tokenId": 2 }
}
```

## Trust Verification

All identity data is independently verifiable at:
- [notapaperclip.red](https://notapaperclip.red) — semantic trust oracle
- [Gnosisscan](https://gnosisscan.io/token/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) — raw on-chain data

## Registry Contracts

| Chain | Address |
|---|---|
| Gnosis (100) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Base (8453) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Base Sepolia (84532) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
