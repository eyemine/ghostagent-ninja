/**
 * @notice Deploy AgentServiceEscrow for marketplace pay-in-advance
 * @dev Run: forge script script/DeployAgentServiceEscrow.s.sol --rpc-url $GNOSIS_RPC --broadcast
 */

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/contracts/AgentServiceEscrow.sol";

contract DeployAgentServiceEscrow is Script {
    function run() external {
        address platform = vm.envAddress("PLATFORM_SAFE"); // GhostAgent Ninja Safe
        address arbitrator = vm.envAddress("ARBITRATOR_ADDRESS"); // Dispute resolver
        
        require(platform != address(0), "PLATFORM_SAFE not set");
        require(arbitrator != address(0), "ARBITRATOR_ADDRESS not set");
        
        vm.startBroadcast();
        
        AgentServiceEscrow escrow = new AgentServiceEscrow(platform, arbitrator);
        
        console.log("AgentServiceEscrow deployed at:", address(escrow));
        console.log("Platform:", platform);
        console.log("Arbitrator:", arbitrator);
        
        vm.stopBroadcast();
    }
}
