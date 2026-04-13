// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TdogeId} from "../src/TdogeId.sol";

/// @notice Deploy just the TdogeId NFT contract, leaving the existing Miner /
///         DOGE / Pair / LM / Router deployments untouched. The NFT is a pure
///         identity layer with no contract-level ties to the mining protocol.
///
/// Env: PRIVATE_KEY (admin = deployer EOA).
contract DeployTdogeId is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(pk);

        vm.startBroadcast(pk);
        TdogeId nft = new TdogeId(admin);
        vm.stopBroadcast();

        console2.log("TdogeId :", address(nft));
        console2.log("Admin   :", admin);
    }
}
