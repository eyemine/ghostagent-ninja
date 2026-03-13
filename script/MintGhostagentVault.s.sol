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
 * Mints ghostagent.vault.gno to the Gnosis Safe.
 * Run after DeployVaultRegistrar.s.sol.
 *
 * The minter (PRIVATE_KEY) must be the authorised minter set during deployment.
 *
 * Usage:
 *   PRIVATE_KEY=<treasury_pk> VAULT_REGISTRAR=<deployed_addr> \
 *   forge script script/MintGhostagentVault.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast
 */
contract MintGhostagentVault is Script {
    address constant SAFE = 0xb7e493e3d226f8fE722CC9916fF164B793af13F4;

    function run() external {
        uint256 pk              = vm.envUint("PRIVATE_KEY");
        address vaultRegistrar  = vm.envAddress("VAULT_REGISTRAR");

        IRegistrar reg = IRegistrar(vaultRegistrar);

        console.log("Vault registrar:", vaultRegistrar);
        console.log("Next token ID:", reg.nextTokenId());
        console.log("Minting ghostagent.vault.gno -> Safe:", SAFE);

        vm.startBroadcast(pk);

        (uint256 tokenId,,,) = reg.mintSubname("ghostagent", SAFE, "", bytes32(0));

        vm.stopBroadcast();

        console.log("SUCCESS - ghostagent.vault.gno minted");
        console.log("Token ID:", tokenId);
        console.log("tokenURI: https://ghostagent.ninja/api/nft-metadata/vault/", tokenId);
    }
}
