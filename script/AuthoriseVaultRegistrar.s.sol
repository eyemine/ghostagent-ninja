// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

interface IGNSRegistry {
    function authoriseCaller(address caller, bool authorised) external;
}

interface ISafe {
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to, uint256 value, bytes calldata data, uint8 operation,
        uint256 safeTxGas, uint256 baseGas, uint256 gasPrice,
        address gasToken, address refundReceiver, uint256 _nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to, uint256 value, bytes calldata data, uint8 operation,
        uint256 safeTxGas, uint256 baseGas, uint256 gasPrice,
        address gasToken, address refundReceiver, bytes memory signatures
    ) external payable returns (bool success);
}

/**
 * Authorises a new registrar in the GNS registry via Safe execTransaction.
 * Required because GNS registry ownership was transferred to the Safe.
 *
 * Usage:
 *   PRIVATE_KEY=<pk> REGISTRAR=<new_registrar_addr> \
 *   forge script script/AuthoriseVaultRegistrar.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast -vvv
 */
contract AuthoriseVaultRegistrar is Script {
    address constant SAFE         = 0xb7e493e3d226f8fE722CC9916fF164B793af13F4;
    address constant GNS_REGISTRY = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;

    function run() external {
        uint256 pk        = vm.envUint("PRIVATE_KEY");
        address registrar = vm.envAddress("REGISTRAR");

        ISafe safe = ISafe(SAFE);

        bytes memory callData = abi.encodeCall(
            IGNSRegistry.authoriseCaller, (registrar, true)
        );

        uint256 safeNonce = safe.nonce();
        console.log("Safe nonce:", safeNonce);
        console.log("Authorising registrar:", registrar);

        bytes32 txHash = safe.getTransactionHash(
            GNS_REGISTRY, 0, callData, 0, 0, 0, 0,
            address(0), address(0), safeNonce
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, txHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.startBroadcast(pk);

        bool success = safe.execTransaction(
            GNS_REGISTRY, 0, callData, 0, 0, 0, 0,
            address(0), address(0), signature
        );

        vm.stopBroadcast();

        require(success, "Safe execTransaction failed");
        console.log("GNS authoriseCaller SUCCESS for:", registrar);
    }
}
