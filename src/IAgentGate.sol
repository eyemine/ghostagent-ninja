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
    /// @dev Computed as bytes4(keccak256("isActive()spendLimit()executionDelay()INTERFACE_ID()"))
    function INTERFACE_ID() external pure returns (bytes4);
}
