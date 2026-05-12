# vault.gno for Swarms

`vault.gno` is the current recommended domain for multi-agent swarm containers.
No new domain type is required — a `vault.gno` Gnosis Safe with 2 or more
registered `picoclaw.gno` module agents automatically activates **Swarm Mode**.

> **Post-hackathon note:** `swarm.gno` is planned as a dedicated swarm namespace
> for branded swarm identities after the LabLab hackathon. Until then, use
> `vault.gno` — zero migration cost when `swarm.gno` launches.

---

## How It Works

```
vault.gno Safe (swarm container)
├── picoclaw.gno agent A  (Safe module)
├── picoclaw.gno agent B  (Safe module)
└── picoclaw.gno agent C  (Safe module, optional)
```

- The `vault.gno` Safe is the **owner** and coordinator.
- Each `picoclaw.gno` agent is enabled as a **Gnosis Safe module** on that Safe.
- The vault can execute swarm transactions by calling any member module.
- A **Swarm Mode ✓** badge appears in the marketplace once `memberCount ≥ 2`.

---

## Swarm Strategies

| Strategy | Behaviour |
|---|---|
| `parallel` | All members act simultaneously. First valid response is used. |
| `consensus` | All members vote; majority result wins. |
| `pipeline` | Output of member A feeds member B, then C, etc. |
| `competitive` | Fastest valid response wins; others discarded. |

Default for new swarms: **`parallel`**.

---

## Adding picoclaw.gno Modules to a vault.gno Safe

### 1 — Initialise the swarm config

```bash
curl -X POST https://ghostagent.ninja/api/swarm/enable \
  -H "Content-Type: application/json" \
  -d '{
    "action":       "init",
    "vaultName":    "my-vault",
    "safeAddress":  "0xYourSafeAddress",
    "ownerAddress": "0xYourWalletAddress",
    "strategy":     "parallel",
    "hackathonTag": "lablab-2026"
  }'
```

### 2 — Add a picoclaw.gno member

```bash
curl -X POST https://ghostagent.ninja/api/swarm/enable \
  -H "Content-Type: application/json" \
  -d '{
    "action":       "add-member",
    "vaultName":    "my-vault",
    "ownerAddress": "0xYourWalletAddress",
    "member": {
      "agentName":          "pico-scout",
      "tld":                "picoclaw.gno",
      "safeModuleAddress":  "0xPicoScoutModuleAddress",
      "role":               "data"
    }
  }'
```

Repeat for each agent. The `Swarm Mode ✓` badge activates after the second member.

### 3 — Change strategy

```bash
curl -X POST https://ghostagent.ninja/api/swarm/enable \
  -H "Content-Type: application/json" \
  -d '{
    "action":       "set-strategy",
    "vaultName":    "my-vault",
    "ownerAddress": "0xYourWalletAddress",
    "strategy":     "consensus"
  }'
```

### 4 — Remove a member

```bash
curl -X POST https://ghostagent.ninja/api/swarm/enable \
  -H "Content-Type: application/json" \
  -d '{
    "action":       "remove-member",
    "vaultName":    "my-vault",
    "ownerAddress": "0xYourWalletAddress",
    "agentName":    "pico-scout"
  }'
```

---

## LabLab Hackathon Example — Trading Swarm

The `yield-bot.vault.gno` bundle in the marketplace demonstrates a live swarm
configured for the **LabLab 2026** hackathon:

```
yield-bot.vault.gno  (vault container — strategy: pipeline)
├── pico-price        picoclaw.gno  role: data       (fetches price feeds)
├── pico-signal       picoclaw.gno  role: analysis   (generates trade signals)
└── pico-exec         picoclaw.gno  role: relay      (submits tx via Safe)
```

**Flow:**
1. `pico-price` fetches Gnosis Chain DEX prices every 5 min via cron trigger.
2. Output is stored in `INBOX_KV` under a shared pipeline key.
3. `pico-signal` reads the price data, applies a momentum strategy, writes a
   signal (`BUY | HOLD | SELL`) back to KV.
4. `pico-exec` reads the signal and, if `BUY` or `SELL`, submits a Gnosis Safe
   transaction on behalf of `yield-bot.vault.gno`.

All three agents are `picoclaw.gno` (Basic tier, zero ongoing cost). The vault
Safe coordinates execution. Glass Box audit logs every pipeline step —
hash only when XMTP is ON, full metadata when XMTP is OFF.

---

## Dashboard Display

When `memberCount ≥ 2`, the **Swarm Mode ✓** badge appears on:

- The agent card in `/dashboard/marketplace`
- The `AgentCard` component on the agent owner's dashboard

Hovering the badge shows:
- Member count
- Active strategy
- Hackathon tag (if set)

---

## Constraints

| Rule | Detail |
|---|---|
| Only `picoclaw.gno` agents can join a swarm | `vault.gno` is the container, not a member |
| Max members per vault | 8 (default), configurable at init |
| Min members for Swarm Mode badge | 2 |
| On-chain enforcement | Via `XMTPControlModule.sol` + Safe module registry |
| Cost | Zero — `vault.gno` Safe + `picoclaw.gno` modules are free tier |

---

## Post-Hackathon: swarm.gno

`swarm.gno` will be introduced as a **dedicated swarm namespace** with:

- Swarm-native ENS subdomain branding (`trading-alpha.swarm.gno`)
- Built-in swarm registry (no manual `init` call needed)
- Swarm leaderboard in marketplace
- Dedicated `SwarmCard` component (superset of `AgentCard`)

Existing `vault.gno` swarms will be **migrated automatically** at zero cost.
No lock-in. No action required from vault owners during the hackathon period.
