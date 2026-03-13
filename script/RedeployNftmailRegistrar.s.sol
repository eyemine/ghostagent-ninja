// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { NamespaceRegistrar } from "../src/NamespaceRegistrar.sol";
import { Namehash } from "../src/utils/Namehash.sol";

/**
 * Redeploys the nftmail.gno NamespaceRegistrar with setBaseURI support.
 * Then remints the 5 existing names to the Safe.
 *
 * Existing names (all owned by Safe 0xb7e493...):
 *   rgbanksy.nftmail.gno
 *   fresh.boy.nftmail.gno
 *   richard.angelo.nftmail.gno
 *   (add others via EXTRA_LABELS env var, comma-separated)
 *
 * The old registrar (0x831ddd71e7c33e16b674099129e6e379da407faf) is abandoned —
 * no burn needed, nftmail.box email routing is KV-based and unaffected.
 *
 * Usage:
 *   PRIVATE_KEY=<pk> MINTER=<treasury> SAFE=<safe_addr> \
 *   forge script script/RedeployNftmailRegistrar.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast
 */
contract RedeployNftmailRegistrar is Script {
    address constant GNS_REGISTRY         = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;
    address constant STORY_IPA_REGISTRY   = 0x5386F58bfdF9d481bB67e15C3211f5182f3BF515;
    address constant ERC6551_REGISTRY     = 0x000000006551c19487814612e58FE06813775758;
    address constant ERC6551_ACCOUNT_IMPL = 0x55266d75d1A14894141022060384218151591515;
    uint256 constant CHAIN_ID             = 100;
    string  constant BASE_URI             = "https://ghostagent.ninja/api/nft-metadata/nftmail/";

    function run() external returns (address registrar) {
        uint256 pk     = vm.envUint("PRIVATE_KEY");
        address minter = vm.envAddress("MINTER");
        address safe   = vm.envAddress("SAFE");

        bytes32 parentNode = Namehash.namehash("nftmail.gno");

        vm.startBroadcast(pk);

        NamespaceRegistrar reg = new NamespaceRegistrar(
            "nftmail.gno Registrar",
            "NFTMAIL",
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
        console.log("nftmail.gno registrar deployed:", registrar);
        console.log("baseURI:", BASE_URI);
        console.log("minter:", minter);
        console.log("NEXT: authorise in GNS via AuthoriseVaultRegistrar.s.sol, then run RemintNftmailNames.s.sol");
    }
}
