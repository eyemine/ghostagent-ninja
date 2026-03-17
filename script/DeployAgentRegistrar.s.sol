// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { NamespaceRegistrar } from "../src/NamespaceRegistrar.sol";
import { Namehash } from "../src/utils/Namehash.sol";

/**
 * Deploys the agent.gno NamespaceRegistrar (matching the pattern of
 * RedeploySLDRegistrars / DeployVaultRegistrar / RedeployNftmailRegistrar).
 *
 * NFT image: https://gateway.lighthouse.storage/ipfs/bafkreihdpulp5riv3dkhtomi2iurgeypvplhdsi3nnkumzmvx725xc4yly
 * Namespace text overlay: Courier New, colour #9dc4f8, top 25% of image.
 * (Rendered at /api/genome-image?sld=agent&name={label} — no on-chain change needed.)
 *
 * After deployment:
 *   1. Authorise new registrar in GNS registry (AuthoriseMultipleRegistrars or Safe tx)
 *   2. Authorise MINTER to call mintSubname
 *
 * Usage:
 *   PRIVATE_KEY=<pk> MINTER=<treasury_or_safe> \
 *   forge script script/DeployAgentRegistrar.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast
 */
contract DeployAgentRegistrar is Script {
    address constant GNS_REGISTRY         = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;
    address constant STORY_IPA_REGISTRY   = 0x5386F58bfdF9d481bB67e15C3211f5182f3BF515;
    address constant ERC6551_REGISTRY     = 0x000000006551c19487814612e58FE06813775758;
    address constant ERC6551_ACCOUNT_IMPL = 0x55266d75d1A14894141022060384218151591515;
    uint256 constant CHAIN_ID             = 100;
    string  constant BASE_URI             = "https://ghostagent.ninja/api/nft-metadata/agent/";

    function run() external returns (address registrar) {
        uint256 pk     = vm.envUint("PRIVATE_KEY");
        address minter = vm.envAddress("MINTER");

        bytes32 parentNode = Namehash.namehash("agent.gno");

        vm.startBroadcast(pk);

        NamespaceRegistrar reg = new NamespaceRegistrar(
            "agent.gno Registrar",
            "AGENT",
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
        console.log("agent.gno registrar deployed:", registrar);
        console.log("baseURI:", BASE_URI);
        console.log("minter authorised:", minter);
        console.log("NEXT: authorise registrar in GNS registry via Safe or AuthoriseMultipleRegistrars");
    }
}
