// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TdogeFactory} from "../src/TdogeFactory.sol";
import {ForgeRouter} from "../src/ForgeRouter.sol";
import {DOGE} from "../src/DOGE.sol";

/// Deploy the DOGE FORGE owned DEX stack:
///   1. TdogeFactory
///   2. ForgeRouter (fee → LiquidityManager)
///   3. Register the existing fDOGE/USDC pair into the factory
///   4. Create empty EURC/USDC, WUSDC/USDC, USYC/USDC pairs so the frontend
///      sees them immediately (liquidity seeded separately)
///
/// Env:
///   PRIVATE_KEY       admin
///   LM_ADDRESS        LiquidityManager — receives platform fees
///   DOGE_ADDRESS      fDOGE
///   USDC_ADDRESS      Arc USDC  (default 0x3600…)
///   PAIR_ADDRESS      existing fDOGE/USDC pair to register
///   EURC_ADDRESS      (optional, default Arc predeploy)
///   USYC_ADDRESS      (optional, default Arc predeploy)
///   WUSDC_ADDRESS     (optional, default UnitFlow WUSDC)
contract DeployForgeDex is Script {
    function run() external {
        uint256 pk   = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(pk);
        address lm    = vm.envAddress("LM_ADDRESS");
        address doge  = vm.envAddress("DOGE_ADDRESS");
        address usdc  = vm.envOr("USDC_ADDRESS",  address(0x3600000000000000000000000000000000000000));
        address dogePair = vm.envAddress("PAIR_ADDRESS");

        address eurc  = vm.envOr("EURC_ADDRESS",  address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address usyc  = vm.envOr("USYC_ADDRESS",  address(0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C));
        address wusdc = vm.envOr("WUSDC_ADDRESS", address(0x911b4000D3422F482F4062a913885f7b035382Df));

        vm.startBroadcast(pk);

        TdogeFactory factory = new TdogeFactory(admin);
        ForgeRouter  router  = new ForgeRouter(admin, address(factory), lm);

        // Absorb the pre-existing fDOGE/USDC pair so the Miner / LM flow
        // keeps working without churn.
        factory.registerPair(doge, usdc, dogePair);

        // Pre-create stablecoin pairs. LP seeding happens in a separate tx
        // (seed script). `createPair` is permissionless so any caller could
        // front-run us; doing it here guarantees deterministic addresses
        // before anyone else touches the factory.
        address eurcPair  = factory.createPair(eurc,  usdc);
        address usycPair  = factory.createPair(usyc,  usdc);
        address wusdcPair = factory.createPair(wusdc, usdc);

        // fDOGE charges a 0.1% transfer fee. Any router that pulls fDOGE in
        // and forwards it to a pair must be fee-exempt, otherwise the router
        // ends up short on the second hop and swapExactTokensForTokens reverts
        // on sell-fDOGE. Requires the deployer to be the DOGE owner.
        DOGE(doge).setFeeExempt(address(router), true);

        vm.stopBroadcast();

        console2.log("TdogeFactory  :", address(factory));
        console2.log("ForgeRouter   :", address(router));
        console2.log("fDOGE pair    :", dogePair);
        console2.log("EURC/USDC     :", eurcPair);
        console2.log("USYC/USDC     :", usycPair);
        console2.log("WUSDC/USDC    :", wusdcPair);
        console2.log("Admin         :", admin);
    }
}
