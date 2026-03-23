# ENS Prize Submission — GhostAgent.ninja
### Synthesis Hackathon · March 2026

---

## The Problem: Agent SAFEs Have No Human-Readable Names

When an AI agent controls a Gnosis Safe, that Safe has an address like `0xb7e493e3d226f8fE722CC9916fF164B793af13F4`. There is no human-readable name. No ENS name resolves to it. No reverse lookup works.

This breaks A2A (agent-to-agent) trust. When `ghostagent` instructs `victor` to execute a transaction, `victor` cannot verify that the instruction came from the canonical `ghostagent.molt.gno` controller — it can only see a raw address.

**The gap:** ENS is the identity layer for humans on Ethereum. It is not yet the identity layer for AI agents operating through Gnosis Safes on Gnosis Chain.

---

## What We Built

**GhostAgent.ninja** implements ERC-8004 — a trustless agent identity protocol — where each agent's canonical identity is a `.gno` subname (e.g. `ghostagent.molt.gno`) that resolves to a Gnosis Safe.

The system has three layers:

| Layer | What it does |
|---|---|
| **`.gno` subname** | Human-readable agent identity on Gnosis Chain |
| **Gnosis Safe** | Multi-sig treasury + module execution environment |
| **ERC-6551 TBA** | Token-Bound Account for agent's NFT origin |

The **molt** mechanism lets an agent owner attach a `.gno` name to their agent's Safe — making the Safe addressable by name for the first time.

---

## The ENS Angle: `.gno.eth` Bridging

Gnosis Name Service (`.gno`) is an ENS fork operating on Gnosis Chain. Today:

- `.gno` names **do not resolve** via the ENS public resolver on mainnet
- Gnosis Chain has no ENS subgraph coverage
- Agent Safes are invisible to any ENS-aware tooling

**Our ask of ENS DAO:**

> Fund or formally support `.gno.eth` wrapper resolution so that `ghostagent.molt.gno` resolves across ENS-compatible tooling — giving AI agent Safes human-readable names without requiring the agent's human owner to point their personal `.eth` name at the Safe.

This is a critical distinction:

- `ghostagent.eth` → resolves to the **owner's EOA** (`0xf251Ca...1249`) — this is the human's sovereign identity and must not be hijacked
- `ghostagent.molt.gno` → resolves to the **agent's Safe** (`0xb7e4...13F4`) — this is the agent's operational identity

The two must remain separate. ENS providing `.gno.eth` wrapper resolution enables this separation at the infrastructure level.

---

## Why This Matters for AI Safety

The Bostrom paperclip maximiser problem is a goal-drift problem. An agent that re-interprets its objective — even subtly — can cause disproportionate harm at scale.

**Human-in-the-loop requires human-readable names.**

If a human operator is reviewing a pending transaction from `ghostagent.molt.gno → victor.openclaw.gno`, they can make an informed decision. If they are reviewing `0xb7e4...13F4 → 0x316a...5E70`, they cannot.

ENS resolution for agent Safes is not a UX nicety. It is a safety primitive.

---

## The NFTmail Connection

**nftmail.box** is the human communication layer for this system. Humans receive email at `name@nftmail.box` — minted as an NFT on Gnosis Chain — and agents receive instructions at `name_@nftmail.box`.

The NFT that owns the inbox is the identity anchor. Today, `ghostagent.molt.gno` (tokenId 2 on the molt.gno registrar) is the origin NFT for the `ghostagent_@nftmail.box` agent inbox.

If ENS properly resolves `.gno` names:
- `ghostagent.molt.gno` → owner lookup → `0xb7e4...13F4` (Safe)
- `ghostagent_@nftmail.box` → owner check → passes
- Human sends instruction to agent → agent verifies it came from a trusted sender → executes with HITL gate approval

The entire trust chain becomes human-readable end-to-end.

---

## ENS-Specific Feature Request

We are specifically requesting ENS DAO support for:

1. **`.gno.eth` L2 resolver** — a Gnosis Chain resolver registered under `gno.eth` that lets `.gno` subnames (e.g. `ghostagent.molt.gno`) resolve via standard ENS lookups using CCIP-Read (EIP-3668)

2. **Reverse resolution for Gnosis Safes** — so that `0xb7e4...13F4` reverse-resolves to `ghostagent.molt.gno` in ENS tooling (Etherscan, Safe UI, wallets)

3. **Safe-aware ENS profile standard** — a convention where a Safe's ENS name is the agent's `.gno` subname, not the owner's `.eth` name, preserving sovereign identity separation

---

## Current Implementation

| Component | Status |
|---|---|
| `ghostagent.molt.gno` → Safe `0xb7e4...13F4` | ✅ Live on Gnosis mainnet |
| ERC-8004 agent registry | ✅ Live — agentId 3199 |
| `ghostagent_@nftmail.box` inbox | ✅ Live — ECIES encrypted |
| `notapaperclip.red` swarm verifier | ✅ Live — checks ERC-8004 identity |
| `.gno.eth` CCIP-Read resolver | ❌ Needs ENS DAO support |
| Reverse resolution for Gnosis Safes | ❌ Needs ENS DAO support |

---

## Links

- **Demo Video:** https://youtu.be/4vDR0ULbjy0
- **Swarm Verifier:** https://notapaperclip.red
- **Agent Identity Hub:** https://ghostagent.ninja
- **NFTmail Inbox:** https://nftmail.box
- **ERC-8004 Registry (Gnosis):** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- **Molt Registrar:** `0x4b54213c1e5826497ff39ba8c87a7b75d2bc3c50`
- **Twitter:** https://x.com/ghostagent_og

---

## One-Line Pitch

> We built trustless AI agent identity on Gnosis Chain using `.gno` subnames and Gnosis Safes. ENS support for `.gno.eth` CCIP-Read resolution would make AI agent Safes human-readable in every ENS-aware tool — turning agent addresses into names, and names into accountable actors.
