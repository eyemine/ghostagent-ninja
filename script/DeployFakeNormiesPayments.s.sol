// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FakeNormiesPayments.sol";

/// @notice Deploy FakeNormiesPayments to Base mainnet (chain 8453).
///
/// Usage:
///   forge script script/DeployFakeNormiesPayments.s.sol \
///     --rpc-url base \
///     --broadcast \
///     --verify \
///     --etherscan-api-key $BASESCAN_API_KEY \
///     -vvvv
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  — deployer EOA (needs a little ETH on Base for gas)
///   BASESCAN_API_KEY      — Basescan verification key

contract DeployFakeNormiesPayments is Script {

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deploying FakeNormiesPayments from:", deployer);
        console.log("Chain ID:", block.chainid);
        require(block.chainid == 8453, "Must deploy on Base mainnet (8453)");

        vm.startBroadcast(deployerKey);

        FakeNormiesPayments fp = new FakeNormiesPayments();

        vm.stopBroadcast();

        console.log("FakeNormiesPayments deployed at:", address(fp));
        console.log("PRO_PRICE  (USDC units):", fp.PRO_PRICE());
        console.log("PREMIUM_PRICE (USDC units):", fp.PREMIUM_PRICE());
        console.log("");
        console.log("Next: set NEXT_PUBLIC_FAKE_NORMIE_PAYMENTS_BASE=", address(fp));
        console.log("Relay watches TierPayment events on Base, calls setTier() on Gnosis.");
    }
}
