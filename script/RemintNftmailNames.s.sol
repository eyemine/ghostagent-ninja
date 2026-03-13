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
}

/**
 * Remints existing nftmail.gno names on the new registrar + mints eyemine.
 * New nftmail registrar: 0x4Da8b049303F101ffdd6ADfAEC048536f796CD4c
 * All minted to Safe: 0xb7e493e3d226f8fE722CC9916fF164B793af13F4
 *
 * Names:
 *   rgbanksy.nftmail.gno
 *   fresh.boy.nftmail.gno
 *   richard.angelo.nftmail.gno
 *   eyemine.nftmail.gno  (new — no prior NFT)
 *
 * Usage:
 *   PRIVATE_KEY=<treasury_pk> \
 *   forge script script/RemintNftmailNames.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast -vvv
 */
contract RemintNftmailNames is Script {
    address constant NFTMAIL_REGISTRAR = 0x46c37365572C9994812AAA41fD04eB56D05469D0;
    address constant SAFE              = 0xb7e493e3d226f8fE722CC9916fF164B793af13F4;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        IRegistrar reg = IRegistrar(NFTMAIL_REGISTRAR);

        string[4] memory labels = ["rgbanksy", "fresh.boy", "richard.angelo", "eyemine"];

        vm.startBroadcast(pk);

        for (uint i = 0; i < labels.length; i++) {
            (uint256 tokenId,,,) = reg.mintSubname(labels[i], SAFE, "", bytes32(0));
            console.log("Minted", labels[i], "tokenId:", tokenId);
        }

        vm.stopBroadcast();

        console.log("All nftmail names minted to Safe:", SAFE);
    }
}
