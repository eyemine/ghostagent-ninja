// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { NamespaceRegistrar } from "../src/NamespaceRegistrar.sol";
import { Namehash } from "../src/utils/Namehash.sol";

/**
 * Deploys the vault.gno NamespaceRegistrar (updated BaseRegistrar with setBaseURI).
 * After deployment:
 *   1. Calls setBaseURI → https://ghostagent.ninja/api/nft-metadata/vault/
 *   2. Authorises MINTER_ADDRESS to call mintSubname
 *
 * Usage:
 *   PRIVATE_KEY=<pk> MINTER=<treasury or Safe addr> \
 *   forge script script/DeployVaultRegistrar.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast --verify
 */
contract DeployVaultRegistrar is Script {
    // ── Gnosis mainnet infrastructure (from existing deployments) ─────────────
    address constant GNS_REGISTRY         = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;
    address constant STORY_IPA_REGISTRY   = 0x5386F58bfdF9d481bB67e15C3211f5182f3BF515;
    address constant ERC6551_REGISTRY     = 0x000000006551c19487814612e58FE06813775758;
    address constant ERC6551_ACCOUNT_IMPL = 0x55266d75d1A14894141022060384218151591515;
    uint256 constant CHAIN_ID             = 100;

    string constant BASE_URI = "https://ghostagent.ninja/api/nft-metadata/vault/";

    function run() external returns (address registrar) {
        uint256 pk     = vm.envUint("PRIVATE_KEY");
        address minter = vm.envAddress("MINTER");

        bytes32 parentNode = Namehash.namehash("vault.gno");

        vm.startBroadcast(pk);

        NamespaceRegistrar reg = new NamespaceRegistrar(
            "vault.gno Registrar",
            "VAULT",
            parentNode,
            GNS_REGISTRY,
            STORY_IPA_REGISTRY,
            ERC6551_REGISTRY,
            ERC6551_ACCOUNT_IMPL,
            CHAIN_ID
        );

        reg.setBaseURI(BASE_URI);
        reg.authoriseMinter(minter, true);

        vm.stopBroadcast();

        registrar = address(reg);

        console.log("vault.gno registrar deployed:", registrar);
        console.log("baseURI set:", BASE_URI);
        console.log("minter authorised:", minter);
    }
}
