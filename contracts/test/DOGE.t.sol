// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DOGE} from "../src/DOGE.sol";

contract DOGETest is Test {
    DOGE doge;
    address admin = address(0xA11CE);
    address treasury = address(0xBEEF);
    address alice = address(0xA11);
    address bob   = address(0xB0B);
    address pair  = address(0xDEADBEEF); // simulated LP pair

    function setUp() public {
        vm.startPrank(admin);
        doge = new DOGE(admin, treasury);
        doge.setMinter(admin, true);
        doge.mint(alice, 1_000 ether);
        vm.stopPrank();
    }

    function test_transfer_takes_0_1_percent_fee() public {
        vm.prank(alice);
        doge.transfer(bob, 1_000 ether);
        // 0.1% of 1000 = 1
        assertEq(doge.balanceOf(bob),      999 ether);
        assertEq(doge.balanceOf(treasury),   1 ether);
        assertEq(doge.balanceOf(alice),      0);
    }

    function test_mint_is_fee_exempt() public {
        vm.prank(admin);
        doge.mint(bob, 500 ether);
        assertEq(doge.balanceOf(bob), 500 ether); // no fee on mint
    }

    function test_treasury_receipt_is_exempt() public {
        // treasury is exempt at construction, so sending TO treasury pays no fee
        vm.prank(alice);
        doge.transfer(treasury, 100 ether);
        assertEq(doge.balanceOf(treasury), 100 ether);
    }

    function test_dex_pair_pays_fee_on_trade() public {
        // pair NOT exempt: simulate buy (pair → trader) and sell (trader → pair)
        vm.prank(admin);
        doge.setMinter(admin, true);
        vm.prank(admin);
        doge.mint(pair, 1_000 ether);

        vm.prank(pair);
        doge.transfer(bob, 500 ether); // buy
        assertEq(doge.balanceOf(bob), 499_500_000_000_000_000_000); // 499.5
        assertEq(doge.balanceOf(treasury), 0.5 ether);
    }

    function test_fee_cap_enforced() public {
        vm.prank(admin);
        vm.expectRevert(DOGE.FeeTooHigh.selector);
        doge.setFeeBps(21);
    }

    function test_fee_adjustable_within_cap() public {
        vm.prank(admin);
        doge.setFeeBps(20); // 0.2%
        vm.prank(alice);
        doge.transfer(bob, 1_000 ether);
        assertEq(doge.balanceOf(bob), 998 ether);
        assertEq(doge.balanceOf(treasury), 2 ether);
    }

    function test_cap_enforced() public {
        vm.prank(admin);
        vm.expectRevert(DOGE.CapExceeded.selector);
        doge.mint(bob, 210_000_001 ether);
    }
}
