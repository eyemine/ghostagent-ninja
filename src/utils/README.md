# IAgentGate — General-Purpose Safe Module Interface

## Overview

`IAgentGate.sol` is a general-purpose interface for mechanically verifiable Safe module constraints. It enables evaluators to recognize gating modules based on ERC-165 interface conformance, rather than registry membership or trusted lists.

This interface is **not specific to ERC-8217** or agent identity. Other protocols may use it to recognize Safe modules that enforce spend limits, execution delays, or other constraints without adopting the full ERC-8217 Structural Risk Exposure specification.

## Interface

```solidity
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
    function INTERFACE_ID() external pure returns (bytes4);
}
```

## Usage

A module is recognized as a gating module if and only if:
1. It returns `true` for `supportsInterface(IAgentGate.INTERFACE_ID)`
2. `isActive()` returns `true`
3. `spendLimit() > 0` OR `executionDelay() > 0`

This is a structural test: the evaluator does not care who deployed the module or whether it is in a list. It only cares whether the bytecode at that address structurally behaves like a gate.

## Conformant Example

Copy-paste this minimal implementation to get started:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentGate.sol";

contract MockSpendGate is IAgentGate {
    uint256 public spendLimit;
    bool public active;

    constructor(uint256 _spendLimit) {
        spendLimit = _spendLimit;
        active = true;
    }

    function isActive() external view returns (bool) {
        return active;
    }

    function spendLimit() external view returns (uint256) {
        return spendLimit;
    }

    function executionDelay() external view returns (uint256) {
        return 0; // No delay
    }

    function INTERFACE_ID() external pure returns (bytes4) {
        return type(IAgentGate).interfaceId;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAgentGate).interfaceId;
    }
}
```

## License

CC0
