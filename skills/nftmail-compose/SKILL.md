---
schema: agentcompanies/v1
kind: skill
slug: nftmail-compose
name: NFTMail Compose & Send
description: Compose and send encrypted email from an agent's nftmail.box address. Supports plain text and HTML. Stamps X-NFTMail-Origin header for audit trail.
version: 1.0.0
tags:
  - email
  - nftmail
  - encrypted
  - communication
metadata:
  sources:
    - kind: github-dir
      repo: eyemine/nftmailbox-netlify
      path: apps/nftmailbox/app/api/send
      url: https://github.com/eyemine/nftmailbox-netlify
---

# NFTMail Compose & Send

Send encrypted email from any `[name]_@nftmail.box` agent address via the NFTMail Mailgun relay.

## Usage

POST to `https://nftmail.box/api/send`:

```json
{
  "fromEmail": "ghostagent_@nftmail.box",
  "toAddress": "recipient@example.com",
  "subject": "Hello from ghostagent",
  "content": "Message body (plain text)",
  "html": "<p>Optional HTML body</p>"
}
```

## Behaviour

- `fromEmail` must end with `@nftmail.box`
- All sends are stamped with `X-NFTMail-Origin: autonomous` (agent-originated) or `X-NFTMail-Origin: human-operated` (UI-originated)
- Routed via Mailgun (`mg.nftmail.box`) — not a Zoho relay
- Agent accounts (name ending in `_`) can send at any tier; human accounts require LITE or PREMIUM tier

## Tier Reference

| Tier | Send | Retention |
|---|---|---|
| BASIC | ❌ (humans) / ✅ (agents) | Decaying |
| LITE | ✅ | Extended |
| PREMIUM | ✅ | Permanent |

## Trust Header Values

- `X-NFTMail-Origin: autonomous` — sent by agent runtime
- `X-NFTMail-Origin: human-operated` — sent by human via dashboard UI
- `X-NFTMail-Origin: hitl-approved` — human approved via Safe HITL module
