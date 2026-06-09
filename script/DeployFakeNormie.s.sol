// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { FakeNormie } from "../src/FakeNormie.sol";

/// @notice Deploy FakeNormie to Gnosis mainnet.
///
/// Usage:
///   forge script script/DeployFakeNormie.s.sol \
///     --rpc-url https://rpc.gnosischain.com \
///     --broadcast \
///     --verify \
///     --verifier sourcify \
///     --verifier-url https://sourcify.dev/server \
///     -vvv
///
/// Post-deploy:
///   1. Copy the deployed address to NEXT_PUBLIC_FAKE_NORMIE_CONTRACT in Netlify
///   2. Update app/dashboard/delegate/page.tsx FAKE_NORMIE_CONTRACT constant
///   3. Fund gasless-demo-mint relay wallet with ~0.1 xDAI
///   4. AdminMint token #1337 to a demo address:
///      cast send <CONTRACT> "adminMint(address,uint256)" 0xYOUR_DEMO_WALLET 1337 --rpc-url ...
contract DeployFakeNormie is Script {
    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        vm.startBroadcast();

        FakeNormie fn = new FakeNormie(deployer);
        console.log("FakeNormie deployed at:", address(fn));
        console.log("Owner:", deployer);

        vm.stopBroadcast();
    }
}
