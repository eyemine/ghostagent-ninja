// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import { NamespaceRegistrar } from "../src/NamespaceRegistrar.sol";
import { Namehash } from "../src/utils/Namehash.sol";

/**
 * Redeploys molt.gno, openclaw.gno, and picoclaw.gno NamespaceRegistrars.
 * Safe to run — no active NFTs on these contracts.
 * Each gets setBaseURI + minter authorisation.
 *
 * Usage:
 *   PRIVATE_KEY=<pk> MINTER=<treasury_or_safe> \
 *   forge script script/RedeploySLDRegistrars.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast
 */
contract RedeploySLDRegistrars is Script {
    address constant GNS_REGISTRY         = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;
    address constant STORY_IPA_REGISTRY   = 0x5386F58bfdF9d481bB67e15C3211f5182f3BF515;
    address constant ERC6551_REGISTRY     = 0x000000006551c19487814612e58FE06813775758;
    address constant ERC6551_ACCOUNT_IMPL = 0x55266d75d1A14894141022060384218151591515;
    uint256 constant CHAIN_ID             = 100;
    string  constant APP_BASE             = "https://ghostagent.ninja/api/nft-metadata/";

    struct SLD {
        string parentName;
        string name;
        string symbol;
    }

    function run() external {
        uint256 pk     = vm.envUint("PRIVATE_KEY");
        address minter = vm.envAddress("MINTER");

        SLD[3] memory slds = [
            SLD("molt.gno",     "molt.gno Registrar",     "MOLT"),
            SLD("openclaw.gno", "openclaw.gno Registrar", "OCLAW"),
            SLD("picoclaw.gno", "picoclaw.gno Registrar", "PCLAW")
        ];

        vm.startBroadcast(pk);

        for (uint i = 0; i < slds.length; i++) {
            bytes32 parentNode = Namehash.namehash(slds[i].parentName);

            // Extract SLD slug (e.g. "molt.gno" → "molt")
            string memory slug = _sldSlug(slds[i].parentName);

            NamespaceRegistrar reg = new NamespaceRegistrar(
                slds[i].name,
                slds[i].symbol,
                parentNode,
                GNS_REGISTRY,
                STORY_IPA_REGISTRY,
                ERC6551_REGISTRY,
                ERC6551_ACCOUNT_IMPL,
                CHAIN_ID
            );

            string memory baseUri = string.concat(APP_BASE, slug, "/");
            reg.setBaseURI(baseUri);
            reg.authoriseMinter(minter, true);

            console.log(slds[i].parentName, "registrar:", address(reg));
            console.log("  baseURI:", baseUri);
        }

        vm.stopBroadcast();
    }

    function _sldSlug(string memory parentName) internal pure returns (string memory) {
        bytes memory b = bytes(parentName);
        for (uint i = 0; i < b.length; i++) {
            if (b[i] == '.') {
                bytes memory slug = new bytes(i);
                for (uint j = 0; j < i; j++) slug[j] = b[j];
                return string(slug);
            }
        }
        return parentName;
    }
}
