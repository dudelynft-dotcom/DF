// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DOGE} from "../src/DOGE.sol";
import {Miner} from "../src/Miner.sol";
import {TdogePair} from "../src/TdogePair.sol";
import {LiquidityManager} from "../src/LiquidityManager.sol";
import {TdogeRouter} from "../src/TdogeRouter.sol";

/// @notice Deploy DOGE FORGE V1 — full stack with AMM (Path C).
///
/// Env vars:
///   PRIVATE_KEY              deployer EOA (admin)
///   PATHUSD_ADDRESS          pathUSD (testnet: 0x20c0…0000)
///   TREASURY_ADDRESS         treasury EOA/multisig
///   LP_DOGE_BUDGET           (optional) TDOGE the LM may mint for LP. Default 21_000_000e18.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin    = vm.addr(pk);
        address pathUSD  = vm.envAddress("PATHUSD_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint8   pathUSDDecimals = uint8(vm.envOr("PATHUSD_DECIMALS", uint256(6)));
        uint256 lpBudget = vm.envOr("LP_DOGE_BUDGET", uint256(21_000_000 ether)); // 10% of 210M cap

        vm.startBroadcast(pk);

        DOGE  doge  = new DOGE(admin, treasury);
        Miner miner = new Miner(admin, pathUSD, address(doge), treasury, pathUSDDecimals);
        TdogePair pair = new TdogePair(pathUSD, address(doge));
        LiquidityManager lm = new LiquidityManager(admin, pathUSD, address(doge), address(pair), pathUSDDecimals, lpBudget);
        TdogeRouter router = new TdogeRouter(address(pair));

        // Minting roles: Miner mints user rewards, LM mints LP-side reserve.
        doge.setMinter(address(miner), true);
        doge.setMinter(address(lm),    true);

        // Fee-exempt: protocol contracts don't pay the 0.1% transfer fee on internal flows.
        doge.setFeeExempt(address(miner),  true);
        doge.setFeeExempt(address(lm),     true);
        doge.setFeeExempt(address(pair),   true);
        doge.setFeeExempt(address(router), true);

        // Miner routes the 95% share to the LiquidityManager (automatic liquidity growth).
        miner.setLiquidityManager(address(lm));

        vm.stopBroadcast();

        console2.log("DOGE             :", address(doge));
        console2.log("Miner            :", address(miner));
        console2.log("TdogePair        :", address(pair));
        console2.log("LiquidityManager :", address(lm));
        console2.log("TdogeRouter      :", address(router));
        console2.log("Admin            :", admin);
    }
}
