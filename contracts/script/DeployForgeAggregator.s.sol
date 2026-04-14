// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ForgeAggregator} from "../src/ForgeAggregator.sol";

/// Deploy ForgeAggregator — 0.10% platform-fee router wrapping UnitFlow V2.5.
///
/// Env:
///   PRIVATE_KEY             deployer / admin
///   UNITFLOW_ROUTER_ADDRESS  external router to wrap (UnitFlow V2.5 swap router)
///   LM_ADDRESS              LiquidityManager — receives skimmed fees
contract DeployForgeAggregator is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(pk);
        address router = vm.envAddress("UNITFLOW_ROUTER_ADDRESS");
        address lm     = vm.envAddress("LM_ADDRESS");

        vm.startBroadcast(pk);
        ForgeAggregator agg = new ForgeAggregator(admin, router, lm);
        vm.stopBroadcast();

        console2.log("ForgeAggregator :", address(agg));
        console2.log("Router wrapped  :", router);
        console2.log("Fee recipient   :", lm);
        console2.log("Fee bps         :", agg.feeBps());
    }
}
