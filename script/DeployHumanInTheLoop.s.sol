// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/HumanInTheLoopModule.sol";

contract DeployHumanInTheLoop is Script {
    function run() external {
        address safe          = vm.envAddress("SAFE_ADDRESS");
        uint256 threshold     = vm.envOr("HITL_THRESHOLD_WEI", uint256(1 ether)); // 1 xDAI default
        uint256 approvalTtl   = vm.envOr("HITL_APPROVAL_TTL_SECONDS", uint256(86400)); // 24h default

        vm.startBroadcast();
        HumanInTheLoopModule module = new HumanInTheLoopModule(safe, threshold, approvalTtl);
        vm.stopBroadcast();

        console.log("HumanInTheLoopModule deployed at:", address(module));
        console.log("Safe:                            ", safe);
        console.log("Approval threshold (wei):        ", threshold);
        console.log("Approval TTL (seconds):          ", approvalTtl);
        console.log("");
        console.log("Next: enable module on Safe at https://app.safe.global");
        console.log("Settings -> Modules -> Add Module ->", address(module));
    }
}
