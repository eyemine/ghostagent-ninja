// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { PairNFTFactory } from "../src/PairNFTFactory.sol";
import { GhostRegistry } from "../src/GhostRegistry.sol";

/// @notice Deploy PairNFTFactory and wire it to GhostRegistry on Gnosis mainnet
///
/// Required env vars:
///   PRIVATE_KEY               — deployer private key
///   ERC6551_REGISTRY          — 0x000000006551c19487814612e58FE06813775758 (canonical)
///   ERC6551_ACCOUNT_IMPL      — your MinimalERC6551Account impl address
///   SAFE_PROXY_FACTORY        — 0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2 (Gnosis mainnet)
///   SAFE_SINGLETON            — 0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552 (Safe 1.3.0)
///   GHOST_REGISTRY_V2         — 0x194f200b2C624e27a14865292d1C50cF46211565
///   ERC8004_REGISTRY          — 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///   TREASURY_SAFE             — 0xb7e493e3d226f8fE722CC9916fF164B793af13F4
contract DeployPairNFTFactory is Script {
    function run() external returns (address factory) {
        uint256 pk                = vm.envUint("PRIVATE_KEY");
        address erc6551Registry   = vm.envAddress("ERC6551_REGISTRY");
        address erc6551Impl       = vm.envAddress("ERC6551_ACCOUNT_IMPL");
        address safeProxyFactory  = vm.envAddress("SAFE_PROXY_FACTORY");
        address safeSingleton     = vm.envAddress("SAFE_SINGLETON");
        address ghostRegistry     = vm.envAddress("GHOST_REGISTRY_V2");
        address erc8004Registry   = vm.envAddress("ERC8004_REGISTRY");
        address treasury          = vm.envAddress("TREASURY_SAFE");

        vm.startBroadcast(pk);

        PairNFTFactory f = new PairNFTFactory(
            erc6551Registry,
            erc6551Impl,
            safeProxyFactory,
            safeSingleton,
            ghostRegistry,
            erc8004Registry,
            treasury
        );

        // Authorise factory to call registerByoGovernor on GhostRegistry
        GhostRegistry(ghostRegistry).setAuthorisedFactory(address(f), true);

        vm.stopBroadcast();

        factory = address(f);
        console2.log("PairNFTFactory deployed:", factory);
        console2.log("Authorised on GhostRegistry:", ghostRegistry);
    }
}
