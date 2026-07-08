# ERC-8217: Structural Risk Exposure (SRE) Protocol

## Abstract

ERC-8217 defines a deterministic, recomputable classification system for agent identity trust. It separates **structural risk exposure** (on-chain controller graph, module behavior) from **attestations** (oracle assertions). Classification derives from bytecode and graph structure, not from permissioned lists or trusted signers.

## Motivation

Current agent identity systems conflate three distinct trust layers:
1. **Structural**: what the on-chain controller graph and module bytecode actually do
2. **Attestational**: what oracles claim about an agent
3. **Behavioral**: what the agent has done historically

Conflating these layers creates hidden oracles: a "registry of recognized modules" is just a signed assertion dressed as a list entry. Anyone can register a no-op contract under a plausible name, and the evaluator treats it as GATED because someone said so.

ERC-8217 separates these layers. Structural classification is recomputable from on-chain state. Attestations are optional, but if present, they MUST be disclosed and visually distinct.

## Specification

### 1. Structural Risk Exposure Classification

An agent's SRE classification is derived from its controller graph and module configuration. The evaluator walks the controller graph starting from the agent's ERC-6551 TBA, following `controller` pointers until reaching an EOA or hitting a limit.

#### 1.1 Controller Graph Traversal

The traversal follows these rules:
- Start at the agent's ERC-6551 TBA address
- For each address, query its `controller` (if it's a Safe) or `owner` (if it's an ERC-721/ERC-1155)
- Track visited addresses to detect cycles
- Stop when reaching an EOA, hitting the depth limit, or detecting a cycle

**Depth limit**: 8 hops (configurable by evaluator implementation)

**Cycle detection**: Cycles are detected via a bounded visited-array check before the depth limit is reached. Cycles return `MALFORMED_GRAPH` immediately. Depth limits are a second-layer safety net for linear chains, not the first line of defense.

#### 1.2 Classification Outcomes

| Outcome | Description |
|---------|-------------|
| `EOA_ROOTED` | Traversal ends at an EOA within the depth limit |
| `SAFE_ROOTED` | Traversal ends at a Safe with no recognized gating modules |
| `SAFE_ROOTED_GATED` | Traversal ends at a Safe with at least one enabled gating module (see §2) |
| `UNRESOLVABLE` | Depth limit reached without finding an EOA or Safe |
| `MALFORMED_GRAPH` | Cycle detected in controller graph |

#### 1.3 Module Recognition: IAgentGate Interface

To classify as `SAFE_ROOTED_GATED`, a Safe must have at least one enabled module that implements the `IAgentGate` interface. Classification derives from bytecode/interface conformance, not from registry membership.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IAgentGate is IERC165 {
    /// @notice Returns whether the gate is currently active
    /// @dev A gate that is disabled should not count as a gating module
    function isActive() external view returns (bool);

    /// @notice Returns the spend limit enforced by this gate
    /// @dev Zero means no spend limit; non-zero means a spend limit is enforced
    function spendLimit() external view returns (uint256);

    /// @notice Returns the execution delay enforced by this gate
    /// @dev Zero means no delay; non-zero means a delay is enforced
    function executionDelay() external view returns (uint256);

    /// @notice ERC-165 interface ID for IAgentGate
    /// @dev 0x[computed from interface functions]
    function INTERFACE_ID() external pure returns (bytes4);
}
```

**Classification rule**: A module is recognized as a gating module if and only if:
1. It returns `true` for `supportsInterface(IAgentGate.INTERFACE_ID)`
2. `isActive()` returns `true`
3. `spendLimit() > 0` OR `executionDelay() > 0`

This is a structural test: the evaluator does not care who deployed the module or whether it is in a list. It only cares whether the bytecode at that address structurally behaves like a gate.

### 2. Attestations (Optional)

Attestations are oracle assertions about an agent. They are **not** part of structural classification. A conformant implementation:

- MAY accept attestations from any source
- MUST disclose the attestor identity (EIP-712 signer address or on-chain attester)
- MUST render attestations in a way that is visually distinct from Structural Risk Exposure classification
- MUST NOT blend attestation assertions into the deterministic SRE display

**Example UI rendering**:
- SRE classification: deterministic badge (e.g., "SAFE_ROOTED_GATED" in neutral color)
- Attestations: separate section with attestor identity, timestamp, and distinct visual treatment (e.g., border, background color, or separate panel)

### 3. Extensions Appendix

#### 3.1 UI Rendering Requirements

Conformant UIs MUST:
1. Display SRE classification as the primary trust signal
2. Display attestations in a separate section with:
   - Attestor identity (EIP-712 signer address or on-chain attester address)
   - Timestamp of attestation
   - Visual distinction from SRE classification (different color, border, or panel)
3. Never combine SRE classification and attestations into a single trust badge or score

#### 3.2 Evaluator Implementation Notes

- Depth limit of 8 hops is a RECOMMENDED default; implementations MAY configure this value
- Cycle detection MUST be performed before depth traversal to prevent DoS via shallow-but-long chains
- The `IAgentGate` interface ID is computed as `bytes4(keccak256("isActive()spendLimit()executionDelay()INTERFACE_ID()"))`

## Rationale

### Why IAgentGate instead of a registry?

A permissionless registry is still an oracle: the act of registration is a vouch. Anyone can deploy a no-op contract, register it under a plausible name, and the evaluator treats it as GATED because someone said so.

By deriving classification from ERC-165 interface conformance, we make it recomputable from bytecode. No list is trusted. The evaluator checks what the module actually does, not what someone claimed it does.

### Why cycle detection before depth traversal?

The 8-hop bound was doing double duty: semantic classification and DoS protection. A malicious identity can chain shallow-but-many controller pointers specifically to force evaluators to burn near-max RPC cost before returning UNRESOLVABLE.

Detecting cycles first (O(n²) via visited-array check) makes MALFORMED_GRAPH cheap to return. Depth limits remain as a second-layer safety net for linear deep chains.

### Why MUST disclose attestor identity?

Without strict disclosure and visual distinction requirements, a lazy UI developer in two years will blend oracle assertions back into the structural layer and the separation is undone. The spec must be future-proof against bad UI implementations, not just honest protocol implementations.

## Security Considerations

- **Module spoofing**: A malicious module could implement `IAgentGate` but return false values. The structural layer cannot detect this; it only checks interface conformance. Behavioral analysis (historical execution) is out of scope for ERC-8217.
- **Cycle detection**: Implementations MUST use a bounded visited-array check to prevent unbounded memory usage.
- **Depth limit griefing**: Implementations SHOULD consider rate-limiting or caching to prevent abuse of deep traversals.

## Reference Implementation

See `src/IAgentGate.sol` for the Solidity interface and `src/SREEvaluator.sol` for the traversal and classification logic.

## Copyright

Copyright and related rights waived via CC0.
