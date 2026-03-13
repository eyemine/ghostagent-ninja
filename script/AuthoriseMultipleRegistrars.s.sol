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
 * Authorises multiple new registrars in the GNS registry via Safe execTransaction.
 * Sends one Safe tx per registrar (nonce increments each time).
 *
 * Registrars authorised:
 *   molt.gno     0x4b54213C1e5826497fF39Ba8C87A7B75D2BC3c50
 *   openclaw.gno 0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe
 *   picoclaw.gno 0xe5FD65562698F46ea9762BD38141535b1Fd875b5
 *
 * Usage:
 *   PRIVATE_KEY=<pk> forge script script/AuthoriseMultipleRegistrars.s.sol \
 *   --rpc-url https://rpc.gnosischain.com --broadcast -vvv
 */
contract AuthoriseMultipleRegistrars is Script {
    address constant SAFE         = 0xb7e493e3d226f8fE722CC9916fF164B793af13F4;
    address constant GNS_REGISTRY = 0xA505e447474bd1774977510e7a7C9459DA79c4b9;

    address[3] public registrars = [
        0x4b54213C1e5826497fF39Ba8C87A7B75D2BC3c50, // molt.gno
        0xbD8285A8455CCEC4bE671D9eE3924Ab1264fcbbe, // openclaw.gno
        0xe5FD65562698F46ea9762BD38141535b1Fd875b5  // picoclaw.gno
    ];

    string[3] public names = ["molt.gno", "openclaw.gno", "picoclaw.gno"];

    function run() external {
        uint256 pk   = vm.envUint("PRIVATE_KEY");
        ISafe safe   = ISafe(SAFE);

        uint256 safeNonce = safe.nonce();

        vm.startBroadcast(pk);

        for (uint i = 0; i < registrars.length; i++) {
            bytes memory callData = abi.encodeCall(
                IGNSRegistry.authoriseCaller, (registrars[i], true)
            );

            bytes32 txHash = safe.getTransactionHash(
                GNS_REGISTRY, 0, callData, 0, 0, 0, 0,
                address(0), address(0), safeNonce + i
            );

            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, txHash);
            bytes memory signature = abi.encodePacked(r, s, v);

            bool success = safe.execTransaction(
                GNS_REGISTRY, 0, callData, 0, 0, 0, 0,
                address(0), address(0), signature
            );

            require(success, "Safe execTransaction failed");
            console.log("Authorised:", registrars[i]);
        }

        vm.stopBroadcast();

        console.log("All registrars authorised in GNS registry");
    }
}
