// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { XMTPControlModule } from "../src/XMTPControlModule.sol";

/// @notice Deploy XMTPControlModule on Gnosis (chainId 100)
contract DeployXMTPControlModule is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        XMTPControlModule xmtp = new XMTPControlModule();
        console.log("XMTPControlModule:", address(xmtp));

        address safe = 0xb7e493e3d226f8fE722CC9916fF164B793af13F4;
        xmtp.transferOwnership(safe);
        console.log("Ownership transferred to Safe:", safe);

        vm.stopBroadcast();
    }
}
