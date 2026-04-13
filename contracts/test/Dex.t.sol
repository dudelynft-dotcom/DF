// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DOGE} from "../src/DOGE.sol";
import {TdogePair} from "../src/TdogePair.sol";
import {LiquidityManager} from "../src/LiquidityManager.sol";
import {TdogeRouter} from "../src/TdogeRouter.sol";

contract MockUSD6 is ERC20 {
    constructor() ERC20("pathUSD", "pUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract DexTest is Test {
    MockUSD6 pathUSD;
    DOGE     doge;
    TdogePair pair;
    LiquidityManager lm;
    TdogeRouter router;

    address admin    = address(0xA11CE);
    address treasury = address(0xBEEF);
    address alice    = address(0xA11);

    uint256 constant BUDGET = 21_000_000 ether; // 10% of 210M

    function setUp() public {
        vm.startPrank(admin);
        pathUSD = new MockUSD6();
        doge    = new DOGE(admin, treasury);
        pair    = new TdogePair(address(pathUSD), address(doge));
        lm      = new LiquidityManager(admin, address(pathUSD), address(doge), address(pair), 6, BUDGET);
        router  = new TdogeRouter(address(pair));
        doge.setMinter(address(lm), true);
        doge.setFeeExempt(address(lm), true);
        doge.setFeeExempt(address(pair), true); // LP pool doesn't pay fee internally
        doge.setFeeExempt(address(router), true);
        vm.stopPrank();

        pathUSD.mint(alice, 1_000_000 * 1e6);
    }

    // --- initial seed via LM ---

    function test_lm_seed_first_time_uses_initial_price() public {
        // send 100 pathUSD to LM
        pathUSD.mint(address(lm), 100 * 1e6);
        lm.seedLiquidity();

        // initial price 100 TDOGE per pathUSD → 100 pathUSD + 10,000 TDOGE
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 rU, uint256 rD) = address(pair.token0()) == address(pathUSD)
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        assertEq(rU, 100 * 1e6);
        assertEq(rD, 10_000 ether);
        assertEq(lm.totalReceived(), 100 * 1e6);
        assertEq(lm.totalDeployed(), 100 * 1e6);
        assertEq(lm.dogeMinted(), 10_000 ether);
    }

    function test_lm_subsequent_seed_mirrors_pool_ratio() public {
        pathUSD.mint(address(lm), 100 * 1e6);
        lm.seedLiquidity();
        // second seed at existing ratio
        pathUSD.mint(address(lm), 50 * 1e6);
        lm.seedLiquidity();

        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 rU, uint256 rD) = address(pair.token0()) == address(pathUSD)
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        assertEq(rU, 150 * 1e6);
        assertEq(rD, 15_000 ether); // preserved 100:1 ratio
    }

    function test_lm_budget_enforced() public {
        vm.prank(admin); lm.setDogeMintBudget(50 ether); // tiny
        pathUSD.mint(address(lm), 100 * 1e6);
        vm.expectRevert(LiquidityManager.BudgetExceeded.selector);
        lm.seedLiquidity();
    }

    // --- swap via router ---

    function test_swap_exactIn_pathUSD_to_tdoge() public {
        pathUSD.mint(address(lm), 1_000 * 1e6);
        lm.seedLiquidity();

        // alice swaps 10 pathUSD for TDOGE
        vm.prank(alice); pathUSD.approve(address(router), type(uint256).max);
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        (uint256 rU, uint256 rD) = address(pair.token0()) == address(pathUSD)
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 expected = router.getAmountOut(10 * 1e6, rU, rD);

        vm.prank(alice);
        uint256 got = router.swapExactIn(address(pathUSD), 10 * 1e6, 0, alice, block.timestamp + 60);
        assertEq(got, expected);
        assertEq(doge.balanceOf(alice), got);
    }

    function test_swap_respects_slippage() public {
        pathUSD.mint(address(lm), 1_000 * 1e6);
        lm.seedLiquidity();

        vm.prank(alice); pathUSD.approve(address(router), type(uint256).max);
        // unreachable minOut
        vm.prank(alice);
        vm.expectRevert(TdogeRouter.InsufficientOutputAmount.selector);
        router.swapExactIn(address(pathUSD), 10 * 1e6, 1_000_000 ether, alice, block.timestamp + 60);
    }

    function test_swap_deadline_enforced() public {
        pathUSD.mint(address(lm), 1_000 * 1e6);
        lm.seedLiquidity();
        vm.prank(alice); pathUSD.approve(address(router), type(uint256).max);

        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        vm.expectRevert(TdogeRouter.ExpiredDeadline.selector);
        router.swapExactIn(address(pathUSD), 10 * 1e6, 0, alice, block.timestamp - 1);
    }

    // --- direct pair burn for LP holder ---

    function test_lp_burn_returns_underlying() public {
        pathUSD.mint(address(lm), 1_000 * 1e6);
        lm.seedLiquidity();
        uint256 lpBal = pair.balanceOf(address(lm));
        assertGt(lpBal, 0);

        // admin sweeps half the LP then burns it
        vm.prank(admin); lm.sweep(address(pair), admin, lpBal / 2);
        uint256 burnAmt = pair.balanceOf(admin);
        vm.prank(admin); pair.transfer(address(pair), burnAmt);
        (uint256 a0, uint256 a1) = pair.burn(admin);
        assertGt(a0, 0);
        assertGt(a1, 0);
    }

    // --- pair rejects identical tokens ---

    function test_pair_rejects_identical_tokens() public {
        vm.expectRevert(TdogePair.IdenticalTokens.selector);
        new TdogePair(address(pathUSD), address(pathUSD));
    }
}
