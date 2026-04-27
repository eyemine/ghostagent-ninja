/**
 * @notice Deploy AgentServiceEscrow for marketplace pay-in-advance
 * @dev Run: forge script script/DeployAgentServiceEscrow.s.sol --rpc-url $GNOSIS_RPC --broadcast
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
// NOTE: AgentServiceEscrow superseded by GhostMarketplace.sol
// import "../src/contracts/AgentServiceEscrow.sol";

contract DeployAgentServiceEscrow is Script {
    function run() external {
        revert("Deprecated - use GhostMarketplace instead");
    }
}
