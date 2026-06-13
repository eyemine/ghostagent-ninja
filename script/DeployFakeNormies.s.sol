// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FakeNormies.sol";

/// @notice Deploy FakeNormies to Gnosis Chain mainnet (chain 100).
///
/// Usage:
///   forge script script/DeployFakeNormies.s.sol \
///     --rpc-url gnosis \
///     --broadcast \
///     --verify \
///     --verifier blockscout \
///     --verifier-url https://gnosis.blockscout.com/api \
///     -vvvv
///
/// Required env vars (set in .env.local or shell):
///   DEPLOYER_PRIVATE_KEY  — deployer EOA private key (needs a little xDAI for gas)
///
/// After deploy:
///   1. Call setBaseURI("ipfs://<CID>/") once SVGs are uploaded to IPFS
///   2. Add contract address to NEXT_PUBLIC_FAKE_NORMIE_CONTRACT in Netlify

contract DeployFakeNormies is Script {

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deploying FakeNormies from:", deployer);
        console.log("Chain ID:", block.chainid);
        require(block.chainid == 100, "Must deploy on Gnosis Chain (100)");

        vm.startBroadcast(deployerKey);

        FakeNormies fn = new FakeNormies();

        vm.stopBroadcast();

        console.log("FakeNormies deployed at:", address(fn));
        console.log("maxSupply:", fn.maxSupply());
        console.log("HARD_CAP:", fn.HARD_CAP());
        console.log("(Tier payments handled by FakeNormiesPayments.sol on Base)");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Upload SVGs to IPFS");
        console.log("  2. Call setBaseURI(ipfsCID) on the deployed contract");
        console.log("  3. Set NEXT_PUBLIC_FAKE_NORMIE_CONTRACT=", address(fn));
    }
}
