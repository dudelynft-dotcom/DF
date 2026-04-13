// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DOGE} from "../src/DOGE.sol";
import {Miner} from "../src/Miner.sol";

contract MockUSD is ERC20 {
    constructor() ERC20("pathUSD", "pUSD") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockUSD6 is ERC20 {
    constructor() ERC20("pathUSD6", "pUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

uint8 constant MODE_INSTANT  = 0;
uint8 constant MODE_MONTHLY  = 1;
uint8 constant MODE_LONGTERM = 2;

contract MinerTest is Test {
    MockUSD pathUSD;
    DOGE doge;
    Miner miner;

    address admin = address(0xA11CE);
    address treasury = address(0xBEEF);
    address alice = address(0xA11);
    address bob   = address(0xB0B);

    function setUp() public {
        vm.startPrank(admin);
        pathUSD = new MockUSD();
        doge = new DOGE(admin, treasury);
        miner = new Miner(admin, address(pathUSD), address(doge), treasury, 18);
        doge.setMinter(address(miner), true);
        doge.setFeeExempt(address(miner), true);
        vm.stopPrank();

        pathUSD.mint(alice, 100_000 ether);
        pathUSD.mint(bob,   10_000 ether);
        vm.prank(alice); pathUSD.approve(address(miner), type(uint256).max);
        vm.prank(bob);   pathUSD.approve(address(miner), type(uint256).max);
    }

    function test_single_position_instant() public {
        vm.prank(alice);
        uint256 id = miner.commit(1_000 ether, MODE_INSTANT);
        assertEq(id, 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);

        // 20 flowed × 200 × 1.25 tier × 1.0 mode = 5_000 TDOGE
        assertApproxEqAbs(doge.balanceOf(alice), 5_000 ether, 1e12);
    }

    function test_two_parallel_positions_different_modes() public {
        // position 0: instant, 500 (tier 1.10x)
        vm.prank(alice); uint256 id0 = miner.commit(500 ether, MODE_INSTANT);
        // position 1: monthly, 2_000 (tier 1.25x, mode 1.20x)
        vm.prank(alice); uint256 id1 = miner.commit(2_000 ether, MODE_MONTHLY);
        assertEq(id0, 0);
        assertEq(id1, 1);

        vm.warp(block.timestamp + 1 days);

        // Harvest position 0 (instant, unlocked)
        vm.prank(alice); miner.harvest(0);
        // 10 flowed × 200 × 1.10 = 2_200 TDOGE
        uint256 bal0 = doge.balanceOf(alice);
        assertApproxEqAbs(bal0, 2_200 ether, 1e12);

        // Harvest position 1 before 30d unlock: must revert
        vm.expectRevert();
        vm.prank(alice); miner.harvest(1);

        // After 30d: position 1 claimable with its own boost
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice); miner.harvest(1);

        // position 1: flow rate 2%/day × 31 days = 62% of 2000 = 1240 pathUSD flowed
        // 1240 × 200 × 1.25 × 1.20 = 372_000 TDOGE
        uint256 delta = doge.balanceOf(alice) - bal0;
        assertApproxEqAbs(delta, 372_000 ether, 100 ether);
    }

    function test_harvestAll_claims_only_unlocked() public {
        vm.prank(alice); miner.commit(500 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(500 ether, MODE_MONTHLY);
        vm.warp(block.timestamp + 1 days);

        // harvestAll should only claim the instant one
        vm.prank(alice); miner.harvestAll();
        uint256 bal = doge.balanceOf(alice);
        assertGt(bal, 0);

        // Monthly position still has pending rewards locked
        (,, uint256 secs) = miner.pending(alice, 1);
        assertGt(secs, 0);
    }

    function test_per_wallet_cap_sums_open_positions() public {
        // cap = 10_000. Open 3 positions totalling exactly cap
        vm.prank(alice); miner.commit(4_000 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(4_000 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(2_000 ether, MODE_INSTANT);
        // Attempting to exceed cap reverts
        vm.expectRevert(Miner.CapReached.selector);
        vm.prank(alice); miner.commit(1, MODE_INSTANT);
    }

    function test_max_positions_per_wallet() public {
        vm.prank(admin); miner.setMaxPositionsPerWallet(3);
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
        vm.expectRevert(Miner.TooManyPositions.selector);
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
    }

    function test_closed_position_frees_slot() public {
        vm.prank(admin); miner.setMaxPositionsPerWallet(1);
        vm.prank(alice); miner.commit(10 ether, MODE_INSTANT);
        // fully drain + close
        vm.warp(block.timestamp + 60 days);
        vm.prank(alice); miner.harvest(0);
        // slot freed → can open another
        vm.prank(alice); miner.commit(10 ether, MODE_INSTANT);
    }

    function test_flush_default_routes_to_treasury() public {
        vm.prank(alice); miner.commit(1_000 ether, MODE_INSTANT);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);
        miner.flush();
        assertApproxEqAbs(pathUSD.balanceOf(treasury), 20 ether, 1e12);
    }

    function test_pause_blocks_commit() public {
        vm.prank(admin); miner.pause();
        vm.expectRevert();
        vm.prank(alice); miner.commit(100 ether, MODE_INSTANT);
    }

    function test_global_multiplier_scales_emission() public {
        vm.prank(admin); miner.setGlobalMultiplier(5_000); // 0.5x
        vm.prank(alice); miner.commit(1_000 ether, MODE_INSTANT);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);
        // 5_000 × 0.5 = 2_500 DOGE
        assertApproxEqAbs(doge.balanceOf(alice), 2_500 ether, 1e12);
    }

    function test_deposit_alias_uses_instant() public {
        vm.prank(alice); miner.deposit(100 ether);
        Miner.Position memory p = miner.getPosition(alice, 0);
        assertEq(p.mode, MODE_INSTANT);
        assertTrue(p.open);
    }
}

contract Miner6DecTest is Test {
    MockUSD6 pathUSD;
    DOGE doge;
    Miner miner;

    address admin = address(0xA11CE);
    address treasury = address(0xBEEF);
    address alice = address(0xA11);

    function setUp() public {
        vm.startPrank(admin);
        pathUSD = new MockUSD6();
        doge = new DOGE(admin, treasury);
        miner = new Miner(admin, address(pathUSD), address(doge), treasury, 6);
        doge.setMinter(address(miner), true);
        doge.setFeeExempt(address(miner), true);
        vm.stopPrank();

        pathUSD.mint(alice, 10_000 * 1e6);
        vm.prank(alice); pathUSD.approve(address(miner), type(uint256).max);
    }

    function test_6dec_scaling() public {
        assertEq(miner.pathUSDUnit(), 1e6);
        assertEq(miner.perWalletCap(), 10_000 * 1e6);
        vm.prank(alice); miner.commit(1_000 * 1e6, MODE_INSTANT);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);
        // 20 × 200 × 1.25 = 5,000 TDOGE
        assertApproxEqAbs(doge.balanceOf(alice), 5_000 ether, 1e12);
    }
}
