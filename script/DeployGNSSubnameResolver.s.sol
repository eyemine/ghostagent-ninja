// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { GNSSubnameResolver } from "../src/GNSSubnameResolver.sol";

/**
 * @title DeployGNSSubnameResolver
 * @notice Deploy the wildcard subname resolver and prepare the setResolver calldata
 *         for each of the 6 SLD nodes.
 *
 * Usage:
 *   forge script script/DeployGNSSubnameResolver.s.sol \
 *     --rpc-url https://gnosis.drpc.org \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $GNOSISSCAN_API_KEY \
 *     -vvvv
 *
 * After deploy, share the resolver address + this script's output with SpaceID/Gnosis
 * so they can call setResolver() on each SLD node in their SidRegistry.
 *
 * If/when you get direct setResolver() access, run SetResolverForSLDs.s.sol below.
 */
contract DeployGNSSubnameResolver is Script {

    // ─── Gnosis mainnet addresses ─────────────────────────────────────────────

    /// Our GNSRegistry — records subnode → owner at mint time
    address constant GNS_REGISTRY = 0x0000000000000000000000000000000000000000; // TODO: fill in deployed address

    /// SpaceID SidRegistry on Gnosis mainnet
    address constant SID_REGISTRY = 0x5dC881dDA4e4a8d312be3544AD13118D1a04Cb17;

    // ─── SLD node hashes (SpaceID TLD root = 0xb610db9c...) ──────────────────
    // Computed as: keccak256(abi.encodePacked(TLD_ROOT, keccak256(bytes(label))))

    bytes32 constant NODE_NFTMAIL  = 0x2cdd713369bd1004e754e235974c4b04aed7052f190b18e233d0e0fa7d57c726;
    bytes32 constant NODE_MOLT     = 0x42860676b186d8baa142befad28d085e5343439a5a2ab1cd61aa28c080f528d3;
    bytes32 constant NODE_OPENCLAW = 0x09539380c94abccbba66ab94163a16b1724230f38d95c69a775cdb3881d870df;
    bytes32 constant NODE_AGENT    = 0xd7e8389ccc776d1e3681f6ec4f5098ebb02a6a622179b3879e7287f29734fd70;
    bytes32 constant NODE_PICOCLAW = 0x99096171ef7e5b0f58353be985057337b7304e24972ba6cc80f5635ba0d2290a;
    bytes32 constant NODE_VAULT    = 0xdb698b969bf6423e8a5177fa586d27fc4d5a593408dc6eda44b2674b4ac68176;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPk);

        GNSSubnameResolver resolver = new GNSSubnameResolver(GNS_REGISTRY);
        console.log("GNSSubnameResolver deployed at:", address(resolver));

        vm.stopBroadcast();

        // ── Print setResolver calldata for each SLD ──────────────────────────
        // Forward these to SpaceID/Gnosis to call on SidRegistry, OR
        // use SetResolverForSLDs.s.sol if you have direct access.

        console.log("\n=== setResolver() calldata for SidRegistry ===");
        console.log("SidRegistry:", SID_REGISTRY);
        console.log("Call setResolver(node, resolver) for each:\n");

        bytes32[6] memory nodes = [
            NODE_NFTMAIL, NODE_MOLT, NODE_OPENCLAW,
            NODE_AGENT, NODE_PICOCLAW, NODE_VAULT
        ];
        string[6] memory labels = [
            "nftmail.gno", "molt.gno", "openclaw.gno",
            "agent.gno", "picoclaw.gno", "vault.gno"
        ];

        for (uint256 i = 0; i < 6; i++) {
            bytes memory cd = abi.encodeWithSignature(
                "setResolver(bytes32,address)",
                nodes[i],
                address(resolver)
            );
            console.log(labels[i]);
            console.log("  node:    ", vm.toString(nodes[i]));
            console.log("  calldata:", vm.toString(cd));
            console.log("");
        }
    }
}

/**
 * @title SetResolverForSLDs
 * @notice Run this ONLY if SpaceID/Gnosis grants your wallet direct setResolver()
 *         access on the SLD nodes. Otherwise they run the equivalent calls themselves.
 *
 * Usage:
 *   forge script script/DeployGNSSubnameResolver.s.sol:SetResolverForSLDs \
 *     --rpc-url https://gnosis.drpc.org \
 *     --broadcast \
 *     -vvvv
 */
contract SetResolverForSLDs is Script {

    address constant SID_REGISTRY = 0x5dC881dDA4e4a8d312be3544AD13118D1a04Cb17;

    bytes32 constant NODE_NFTMAIL  = 0x2cdd713369bd1004e754e235974c4b04aed7052f190b18e233d0e0fa7d57c726;
    bytes32 constant NODE_MOLT     = 0x42860676b186d8baa142befad28d085e5343439a5a2ab1cd61aa28c080f528d3;
    bytes32 constant NODE_OPENCLAW = 0x09539380c94abccbba66ab94163a16b1724230f38d95c69a775cdb3881d870df;
    bytes32 constant NODE_AGENT    = 0xd7e8389ccc776d1e3681f6ec4f5098ebb02a6a622179b3879e7287f29734fd70;
    bytes32 constant NODE_PICOCLAW = 0x99096171ef7e5b0f58353be985057337b7304e24972ba6cc80f5635ba0d2290a;
    bytes32 constant NODE_VAULT    = 0xdb698b969bf6423e8a5177fa586d27fc4d5a593408dc6eda44b2674b4ac68176;

    function run() external {
        address resolver = vm.envAddress("RESOLVER_ADDRESS");
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPk);

        ISidRegistry reg = ISidRegistry(SID_REGISTRY);

        bytes32[6] memory nodes = [
            NODE_NFTMAIL, NODE_MOLT, NODE_OPENCLAW,
            NODE_AGENT, NODE_PICOCLAW, NODE_VAULT
        ];
        string[6] memory labels = [
            "nftmail.gno", "molt.gno", "openclaw.gno",
            "agent.gno", "picoclaw.gno", "vault.gno"
        ];

        for (uint256 i = 0; i < 6; i++) {
            reg.setResolver(nodes[i], resolver);
            console.log("setResolver done:", labels[i]);
        }

        vm.stopBroadcast();
        console.log("All 6 SLD resolvers set to:", resolver);
    }
}

interface ISidRegistry {
    function setResolver(bytes32 node, address resolver) external;
    function owner(bytes32 node) external view returns (address);
    function resolver(bytes32 node) external view returns (address);
}
