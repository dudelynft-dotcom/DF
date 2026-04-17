// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CDOGE} from "../src/CDOGE.sol";
import {TdogeFactory} from "../src/TdogeFactory.sol";
import {ForgeRouter} from "../src/ForgeRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deploy cDOGE, create pairs on the factory, and seed initial
/// liquidity so the token is immediately tradeable.
///
/// Env:
///   PRIVATE_KEY        admin (receives 100M cDOGE on deploy)
///   FACTORY_ADDRESS    TdogeFactory
///   ROUTER_ADDRESS     ForgeRouter
///   USDC_ADDRESS       Arc USDC  (default 0x3600…)
///   EURC_ADDRESS       EURC      (default Arc predeploy)
///
/// After deploy: add the printed cDOGE address to the frontend
/// env vars and the community indexer (if volume tracking is
/// desired for a cDOGE community task).
contract DeployCDoge is Script {
    function run() external {
        uint256 pk     = vm.envUint("PRIVATE_KEY");
        address admin  = vm.addr(pk);
        address factory = vm.envAddress("FACTORY_ADDRESS");
        address router  = vm.envAddress("ROUTER_ADDRESS");
        address usdc   = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc   = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));

        // Seed amounts — adjust to taste. 10M cDOGE + $10k USDC sets
        // an opening price of ~$0.001 per cDOGE. Low so the community
        // can accumulate cheaply.
        uint256 cdogeSeedUsdc = 10_000_000 ether;    // 10M cDOGE
        uint256 usdcSeed      = 10_000 * 1e6;        // $10k USDC (6 dec)
        uint256 cdogeSeedEurc = 5_000_000 ether;     // 5M cDOGE
        uint256 eurcSeed      = 5_000 * 1e6;         // $5k EURC (6 dec)

        vm.startBroadcast(pk);

        CDOGE cdoge = new CDOGE(admin);
        console2.log("cDOGE          :", address(cdoge));

        // Create pairs.
        address pairUsdc = TdogeFactory(factory).createPair(address(cdoge), usdc);
        address pairEurc = TdogeFactory(factory).createPair(address(cdoge), eurc);
        console2.log("cDOGE/USDC pair:", pairUsdc);
        console2.log("cDOGE/EURC pair:", pairEurc);

        // Approve router for the seed amounts.
        cdoge.approve(router, type(uint256).max);
        IERC20(usdc).approve(router, type(uint256).max);
        IERC20(eurc).approve(router, type(uint256).max);

        // Seed cDOGE/USDC.
        ForgeRouter(router).addLiquidity(
            address(cdoge), usdc,
            cdogeSeedUsdc, usdcSeed,
            0, 0, admin, block.timestamp + 300
        );
        console2.log("Seeded cDOGE/USDC");

        // Seed cDOGE/EURC.
        ForgeRouter(router).addLiquidity(
            address(cdoge), eurc,
            cdogeSeedEurc, eurcSeed,
            0, 0, admin, block.timestamp + 300
        );
        console2.log("Seeded cDOGE/EURC");

        vm.stopBroadcast();

        console2.log("Admin          :", admin);
        console2.log("cDOGE balance  :", cdoge.balanceOf(admin));
    }
}
