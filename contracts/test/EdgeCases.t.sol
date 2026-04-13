// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DOGE} from "../src/DOGE.sol";
import {Miner} from "../src/Miner.sol";

uint8 constant MODE_INSTANT  = 0;
uint8 constant MODE_MONTHLY  = 1;
uint8 constant MODE_LONGTERM = 2;

contract MockUSD is ERC20 {
    constructor() ERC20("pathUSD", "pUSD") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract EdgeCasesTest is Test {
    MockUSD pathUSD;
    DOGE    doge;
    Miner   miner;

    address admin    = address(0xA11CE);
    address treasury = address(0xBEEF);
    address alice    = address(0xA11);

    function setUp() public {
        vm.startPrank(admin);
        pathUSD = new MockUSD();
        doge    = new DOGE(admin, treasury);
        miner   = new Miner(admin, address(pathUSD), address(doge), treasury, 18);
        doge.setMinter(address(miner), true);
        doge.setFeeExempt(address(miner), true);
        vm.stopPrank();

        pathUSD.mint(alice, 100_000 ether);
        vm.prank(alice); pathUSD.approve(address(miner), type(uint256).max);
    }

    function test_pause_blocks_commit_and_harvest() public {
        vm.prank(alice); miner.commit(1_000 ether, MODE_INSTANT);
        vm.prank(admin); miner.pause();
        vm.expectRevert();
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
        vm.expectRevert();
        vm.prank(alice); miner.harvest(0);
        vm.prank(admin); miner.unpause();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);
        assertGt(doge.balanceOf(alice), 0);
    }

    function test_post_cap_emission_is_low_and_bounded() public {
        Miner.Phase[] memory ph = new Miner.Phase[](1);
        ph[0] = Miner.Phase({supplyThreshold: 100 ether, ratePerPathUSD: 100 ether});
        vm.prank(admin); miner.setPhases(ph);
        Miner.CommitmentTier[] memory t = new Miner.CommitmentTier[](1);
        t[0] = Miner.CommitmentTier({minDeposit: 0, multiplierBps: 10_000});
        vm.prank(admin); miner.setCommitmentTiers(t);
        vm.prank(admin); miner.setPostCapRate(0);

        // Small commit that drains fully in the accrual window (closes position).
        vm.prank(alice); miner.commit(10 ether, MODE_INSTANT);
        vm.warp(block.timestamp + 60 days); // 120% flow → fully drained
        vm.prank(alice); miner.harvest(0);  // closes position 0

        uint256 supplyBefore = doge.totalSupply();
        // phase 1 capped at 100 DOGE; emission ≤ cap
        assertLe(supplyBefore, 100 ether);

        // Enable post-cap and open a second position
        vm.prank(admin); miner.setPostCapRate(0.2 ether);
        vm.prank(alice); miner.commit(100 ether, MODE_INSTANT);
        vm.warp(block.timestamp + 60 days);
        vm.prank(alice); miner.harvest(1);
        uint256 minted = doge.totalSupply() - supplyBefore;
        assertGt(minted, 0);
        assertLe(minted, 10_000_000 ether);
    }

    function test_inflation_pausable() public {
        vm.prank(admin); doge.setMinter(admin, true);
        vm.prank(admin); doge.mint(alice, 210_000_000 ether);
        uint256 capBefore = doge.currentCap();
        vm.prank(admin); doge.pauseInflation();
        vm.warp(block.timestamp + 365 days);
        assertEq(doge.currentCap(), capBefore);
    }

    function test_yearly_inflation_respects_max() public {
        vm.prank(admin);
        vm.expectRevert(DOGE.InflationTooHigh.selector);
        doge.setYearlyInflation(20_000_000 ether);
    }

    function test_miner_score_accrues_across_positions() public {
        vm.prank(alice); miner.commit(500 ether, MODE_INSTANT);
        vm.prank(alice); miner.commit(500 ether, MODE_MONTHLY);
        vm.warp(block.timestamp + 10 days);
        // Commit a third position to trigger accrual on 0 AND 1.
        vm.prank(alice); miner.commit(1 ether, MODE_INSTANT);
        // score = (500 + 500) × 10 days / 1 day = 10_000 pathUSD-days (18 dec)
        uint256 score = miner.minerScore(alice);
        assertApproxEqAbs(score, 10_000 ether, 100 ether);
    }

    function test_adaptive_reference_price_clamps_emission() public {
        vm.startPrank(admin);
        miner.setAdaptiveEnabled(true);
        miner.setAdaptiveBounds(10_000, 8_000, 11_000);
        miner.setReferenceTdogePrice(0.01 ether);
        miner.setEffectiveMultBand(1, 100_000);
        Miner.CommitmentTier[] memory t = new Miner.CommitmentTier[](1);
        t[0] = Miner.CommitmentTier({minDeposit: 0, multiplierBps: 10_000});
        miner.setCommitmentTiers(t);
        vm.stopPrank();

        vm.prank(alice); miner.commit(1_000 ether, MODE_INSTANT);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); miner.harvest(0);

        // 20 × 200 × 1.0 × 0.8 = 3_200 TDOGE (clamped 0.8)
        assertApproxEqAbs(doge.balanceOf(alice), 3_200 ether, 10 ether);
    }

    function test_many_miners_do_not_overmint() public {
        address[] memory users = new address[](20);
        for (uint256 i = 0; i < 20; i++) {
            users[i] = address(uint160(0x1000 + i));
            pathUSD.mint(users[i], 5_000 ether);
            vm.prank(users[i]); pathUSD.approve(address(miner), type(uint256).max);
            vm.prank(users[i]); miner.commit(5_000 ether, MODE_INSTANT);
        }
        vm.warp(block.timestamp + 365 days);
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(users[i]); miner.harvest(0);
        }
        assertLe(doge.totalSupply(), doge.currentCap());
    }
}
