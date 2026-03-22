// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

// ── HITLModuleFactory source (inline — copy to src/HITLModuleFactory.sol) ────
//
// interface ISafe {
//     function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool);
//     function isOwner(address owner) external view returns (bool);
// }
//
// contract HumanInTheLoopModule { ... } // already in src/HumanInTheLoopModule.sol
//
// contract HITLModuleFactory {
//     event ModuleDeployed(address indexed safe, address indexed module, uint256 threshold, uint256 approvalTtl, address deployedBy);
//     mapping(address => address) public safeModule;
//     address[] public allModules;
//     function createModule(address safeAddress, uint256 thresholdWei, uint256 approvalTtlSecs) external returns (address module) {
//         require(safeAddress != address(0), "Factory: zero safe");
//         uint256 ttl = approvalTtlSecs == 0 ? 86400   : approvalTtlSecs;
//         uint256 thr = thresholdWei    == 0 ? 1 ether : thresholdWei;
//         module = address(new HumanInTheLoopModule(safeAddress, thr, ttl));
//         safeModule[safeAddress] = module;
//         allModules.push(module);
//         emit ModuleDeployed(safeAddress, module, thr, ttl, msg.sender);
//     }
//     function getModule(address safeAddress) external view returns (address) { return safeModule[safeAddress]; }
//     function totalModules() external view returns (uint256) { return allModules.length; }
// }
//
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: Uncomment this import once HITLModuleFactory.sol exists in src/
// import "../src/HITLModuleFactory.sol";

/**
 * DeployHITLFactory
 *
 * Deploys the permissionless HITLModuleFactory to Gnosis mainnet (once).
 * After deployment, set NEXT_PUBLIC_HITL_FACTORY_ADDRESS env var.
 *
 * Usage:
 *   forge script script/DeployHITLFactory.s.sol \
 *     --rpc-url https://rpc.gnosischain.com \
 *     --broadcast --verify --verifier sourcify \
 *     --private-key $DEPLOYER_PK
 *
 * Then:
 *   1. Copy returned address into NEXT_PUBLIC_HITL_FACTORY_ADDRESS in .env
 *   2. Netlify / Hostinger: add the env var to the deployment config
 *   3. Agent owners can now self-serve deploy their own HITL module from
 *      ghostagent.ninja/dashboard/hitl
 */
contract DeployHITLFactory is Script {
    function run() external {
        vm.startBroadcast();
        // HITLModuleFactory factory = new HITLModuleFactory();
        // console.log("HITLModuleFactory deployed at:", address(factory));
        // console.log("Set env: NEXT_PUBLIC_HITL_FACTORY_ADDRESS=", address(factory));
        vm.stopBroadcast();
    }
}
