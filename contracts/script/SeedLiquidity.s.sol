// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ForgeRouter} from "../src/ForgeRouter.sol";

/// Seeds testnet liquidity for the stablecoin pairs by calling
/// `ForgeRouter.addLiquidity` from the admin wallet. Treats each pair as
/// (token, USDC) @ 1:1 (both six-decimal-equivalent on the human side, so a
/// 10-USDC / 10-EURC deposit yields a 1.00 exchange rate).
///
/// The caller must already hold enough USDC + each token. If a token balance
/// is zero the pair is skipped with a log line.
///
/// Env:
///   PRIVATE_KEY       admin
///   ROUTER_ADDRESS    ForgeRouter
///   USDC_ADDRESS      Arc USDC
///   SEED_USDC_AMOUNT  human units of USDC per side (default 10)
///   EURC_ADDRESS / USYC_ADDRESS / WUSDC_ADDRESS  — optional
contract SeedLiquidity is Script {
    function run() external {
        uint256 pk      = vm.envUint("PRIVATE_KEY");
        address admin   = vm.addr(pk);
        address router  = vm.envAddress("ROUTER_ADDRESS");
        address usdc    = vm.envOr("USDC_ADDRESS",  address(0x3600000000000000000000000000000000000000));
        uint256 usdcHuman = vm.envOr("SEED_USDC_AMOUNT", uint256(10));

        address eurc  = vm.envOr("EURC_ADDRESS",  address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address usyc  = vm.envOr("USYC_ADDRESS",  address(0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C));
        address wusdc = vm.envOr("WUSDC_ADDRESS", address(0x911b4000D3422F482F4062a913885f7b035382Df));

        vm.startBroadcast(pk);

        _seedPair(router, admin, eurc,  6,  usdc, usdcHuman);
        _seedPair(router, admin, usyc,  6,  usdc, usdcHuman);
        _seedPair(router, admin, wusdc, 18, usdc, usdcHuman);

        vm.stopBroadcast();
    }

    /// @dev Seed `pairToken` (N decimals) + USDC (6 dec) at 1:1 human ratio.
    function _seedPair(
        address router,
        address admin,
        address pairToken,
        uint8   pairTokenDecimals,
        address usdc,
        uint256 usdcHuman
    ) internal {
        uint256 usdcAmount = usdcHuman * (10 ** 6);
        uint256 tokenAmount = usdcHuman * (10 ** pairTokenDecimals);

        uint256 tokenBal = IERC20(pairToken).balanceOf(admin);
        uint256 usdcBal  = IERC20(usdc).balanceOf(admin);
        if (tokenBal < tokenAmount) {
            console2.log("  skip seed (insufficient token):", pairToken);
            return;
        }
        if (usdcBal < usdcAmount) {
            console2.log("  skip seed (insufficient USDC):", pairToken);
            return;
        }

        IERC20(pairToken).approve(router, tokenAmount);
        IERC20(usdc).approve(router, usdcAmount);

        (uint256 amtA, uint256 amtB, uint256 lp) = ForgeRouter(router).addLiquidity(
            pairToken,
            usdc,
            tokenAmount,
            usdcAmount,
            0,
            0,
            admin,
            block.timestamp + 600
        );
        console2.log("  seeded token:", pairToken);
        console2.log("   amountA    :", amtA);
        console2.log("   amountB    :", amtB);
        console2.log("   lp         :", lp);
    }
}
