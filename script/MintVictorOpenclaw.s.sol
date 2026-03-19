// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

interface IRegistrar {
    function mintSubname(
        string calldata label,
        address owner,
        bytes calldata storyData,
        bytes32 tbaSalt
    ) external returns (uint256 tokenId, bytes32 subnode, bytes32 ipaId, address tba);
    function nextTokenId() external view returns (uint256);
}

/**
 * Mints victor.openclaw.gno directly from deployer EOA to victor's Safe.
 * The TBA is deterministic — printed to console for use as Safe signer.
 *
 * Usage:
 *   PRIVATE_KEY=<deployer_pk> \
 *   forge script script/MintVictorOpenclaw.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast
 */
contract MintVictorOpenclaw is Script {
    address constant OPENCLAW_REGISTRAR = 0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe;
    // Option A: NFT lives outside the Safe — ghostagent.eth holds the key
    // TBA derived from this NFT becomes the sole signer of victor's Safe
    address constant GHOSTAGENT_ETH     = 0xf251Ca37a80200f7AfefF398DA0338f4C1f01249;
    address constant VICTOR_SAFE        = 0x316aC7032d1a2b00faAB8A72185f5Ef8b4c75E70;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        IRegistrar registrar = IRegistrar(OPENCLAW_REGISTRAR);
        console.log("Next token ID before mint:", registrar.nextTokenId());

        vm.startBroadcast(pk);

        (uint256 tokenId, bytes32 subnode, bytes32 ipaId, address tba) = registrar.mintSubname(
            "victor",
            GHOSTAGENT_ETH,  // NFT owner = ghostagent.eth (outside Safe)
            "",               // no storyData
            bytes32(0)        // default salt
        );

        vm.stopBroadcast();

        console.log("========================================");
        console.log("victor.openclaw.gno minted!");
        console.log("  tokenId:", tokenId);
        console.logBytes32(subnode);
        console.logBytes32(ipaId);
        console.log("  TBA:    ", tba);
        console.log("  owner:   ghostagent.eth =", GHOSTAGENT_ETH);
        console.log("========================================");
        console.log("NEXT STEPS:");
        console.log("  1. Add TBA as signer on victor Safe:", VICTOR_SAFE);
        console.log("     TBA address:", tba);
        console.log("  2. Remove all EOA signers from victor Safe");
        console.log("  3. TBA is now sole signer - controlled by NFT holder (ghostagent.eth)");
    }
}
