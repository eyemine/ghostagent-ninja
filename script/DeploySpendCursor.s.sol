// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/GhostAgentSpendCursor.sol";

/**
 * @notice Deploy GhostAgentSpendCursor (hardened) to Gnosis Chiado (10200).
 *
 * After deploy:
 *   1. Update CURSOR_CONTRACT in app/services/erc8048-publisher.ts
 *   2. Re-run chiado-register-fakenormies.mjs to re-register all 6 leaves
 *   3. Redeploy Cloudflare worker if CURSOR_CONTRACT is referenced there
 *
 * Usage:
 *   forge script script/DeploySpendCursor.s.sol \
 *     --rpc-url https://rpc.chiado.gnosis.gateway.fm \
 *     --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY
 */
contract DeploySpendCursor is Script {
    function run() external {
        vm.startBroadcast();
        GhostAgentSpendCursor cursor = new GhostAgentSpendCursor();
        vm.stopBroadcast();
        console.log("GhostAgentSpendCursor deployed at:", address(cursor));
    }
}
