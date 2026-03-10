// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/DailyBudgetModule.sol";

contract DeployDailyBudget is Script {
    function run() external {
        address safe = vm.envAddress("SAFE_ADDRESS");
        uint256 dailyCap = vm.envOr("DAILY_CAP_WEI", uint256(100000000000000000)); // 0.1 xDAI default
        uint256 alertBps = vm.envOr("ALERT_BPS", uint256(8000)); // 80% default

        vm.startBroadcast();
        DailyBudgetModule module = new DailyBudgetModule(safe, dailyCap, alertBps);
        vm.stopBroadcast();

        console.log("DailyBudgetModule deployed at:", address(module));
        console.log("Safe:", safe);
        console.log("Daily cap (wei):", dailyCap);
        console.log("Alert threshold bps:", alertBps);
        console.log("");
        console.log("Next: enable module on Safe at https://app.safe.global");
        console.log("Settings -> Modules -> Add Module ->", address(module));
    }
}
