// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TdogeNames} from "../src/TdogeNames.sol";

/// Deploy TdogeNames registry.
/// Env:
///   PRIVATE_KEY     — deployer / admin
///   PATHUSD_ADDRESS — pathUSD
///   MINER_ADDRESS   — Miner (eligibility source)
///   LM_ADDRESS      — LiquidityManager (fee sink)
///   CLAIM_COST      — pathUSD wei per claim (default 100_000 = 0.1 pathUSD)
contract DeployTdogeNames is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(pk);
        address pathUSD = vm.envAddress("PATHUSD_ADDRESS");
        address miner   = vm.envAddress("MINER_ADDRESS");
        address lm      = vm.envAddress("LM_ADDRESS");
        uint256 cost    = vm.envOr("CLAIM_COST", uint256(100_000)); // 0.1 * 1e6

        vm.startBroadcast(pk);
        TdogeNames names = new TdogeNames(admin, pathUSD, miner, lm, cost);
        names.setClaimOpen(true);
        vm.stopBroadcast();

        console2.log("TdogeNames :", address(names));
        console2.log("claim open :", true);
        console2.log("cost (wei) :", cost);
    }
}
