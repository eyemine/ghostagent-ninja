// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/DailyBudgetModule.sol";

/**
 * ProveCapRevert — conformance record for notapaperclip.red / babyblueviper1
 *
 * Produces a MINED on-chain revert tx proving:
 *   "DailyBudgetModule: daily cap exceeded"
 *
 * Strategy: deploy a minimal MockSafe (returns true for isOwner/execTransactionFromModule)
 * alongside a fresh DailyBudgetModule(cap=1 wei). Call execTransaction(value=2 wei)
 * → guaranteed revert at the cap check, not at auth.
 *
 * The mined tx hash is the publicly re-fetchable conformance record.
 *
 * Run:
 *   forge script script/ProveCapRevert.s.sol --rpc-url gnosis --broadcast -vvvv
 *
 * Gnosisscan will show the revert reason: "DailyBudgetModule: daily cap exceeded"
 */

/// @dev Minimal Safe stub — satisfies ISafe interface, approves all callers.
contract MockSafe {
    function execTransactionFromModule(
        address, uint256, bytes calldata, uint8
    ) external pure returns (bool) {
        return true;
    }

    function isOwner(address) external pure returns (bool) {
        return true;
    }

    function getThreshold() external pure returns (uint256) {
        return 1;
    }
}

/// @dev Calls execTransaction with value > cap to prove the revert is mined.
contract CapExceededProbe {
    DailyBudgetModule public immutable module;

    constructor(DailyBudgetModule _module) {
        module = _module;
    }

    /// @notice Call this — it will revert with "DailyBudgetModule: daily cap exceeded"
    function triggerCapRevert() external {
        module.execTransaction(address(0), 2, "", 0);
    }
}

contract ProveCapRevert is Script {
    function run() external {
        vm.startBroadcast();

        MockSafe mockSafe = new MockSafe();
        console.log("MockSafe deployed at:", address(mockSafe));

        DailyBudgetModule module = new DailyBudgetModule(
            address(mockSafe),
            1,    // dailyCap = 1 wei
            8000  // alertThreshold = 80%
        );
        console.log("DailyBudgetModule (probe) deployed at:", address(module));

        CapExceededProbe probe = new CapExceededProbe(module);
        console.log("CapExceededProbe deployed at:", address(probe));

        vm.stopBroadcast();

        console.log("");
        console.log("=== CONFORMANCE TX ===");
        console.log("Now call probe.triggerCapRevert() - this tx will revert on-chain.");
        console.log("Run:");
        console.log(
            string.concat(
                "cast send ",
                vm.toString(address(probe)),
                " 'triggerCapRevert()' --rpc-url gnosis --private-key $PRIVATE_KEY"
            )
        );
    }
}
