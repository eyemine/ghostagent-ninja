// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { NFTmailBeacon } from "../src/NFTmailBeacon.sol";

/// @notice Deploy NFTmailBeacon to Base mainnet (chainId 8453)
/// @dev Required env vars:
///   DEPLOYER_PRIVATE_KEY   — deployer wallet
///   TREASURY_ADDRESS       — gets MINTER_ROLE (treasury EOA that calls mintPro/mintPremium)
///   ADMIN_ADDRESS          — gets DEFAULT_ADMIN_ROLE (multisig recommended)
///
/// Usage:
///   forge script script/DeployNFTmailBeacon.s.sol \
///     --rpc-url base \
///     --broadcast \
///     --verify \
///     --etherscan-api-key $BASESCAN_API_KEY
contract DeployNFTmailBeacon is Script {
    function run() external returns (address beacon) {
        // Support both DEPLOYER_PRIVATE_KEY and PRIVATE_KEY for flexibility
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (deployerKey == 0) {
            deployerKey = vm.envUint("PRIVATE_KEY");
        }
        address treasury    = vm.envAddress("TREASURY_ADDRESS");
        address admin       = vm.envAddress("ADMIN_ADDRESS");

        require(block.chainid == 8453, "Must deploy on Base (chainId 8453)");

        vm.startBroadcast(deployerKey);

        NFTmailBeacon b = new NFTmailBeacon(admin, treasury);
        beacon = address(b);

        vm.stopBroadcast();

        console.log("NFTmailBeacon deployed:", beacon);
        console.log("  Admin:    ", admin);
        console.log("  Minter:   ", treasury);
        console.log("  Chain:    ", block.chainid);
    }
}
