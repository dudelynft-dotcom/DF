// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TdogeNames} from "../src/TdogeNames.sol";

contract MockUSD6 is ERC20 {
    constructor() ERC20("pathUSD", "pUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// Minimal Miner mock that lets us control per-user position count.
contract MockMiner {
    mapping(address => uint256) public positionCount;
    function setCount(address u, uint256 c) external { positionCount[u] = c; }
}

contract TdogeNamesTest is Test {
    MockUSD6 pathUSD;
    MockMiner miner;
    TdogeNames names;

    address admin = address(0xA11CE);
    address sink  = address(0xD0FEED);  // liquidityManager stand-in
    address alice = address(0xA11);
    address bob   = address(0xB0B);

    uint256 constant COST = 0.1 * 1e6; // 0.1 pathUSD, 6-dec

    function setUp() public {
        vm.startPrank(admin);
        pathUSD = new MockUSD6();
        miner   = new MockMiner();
        names   = new TdogeNames(admin, address(pathUSD), address(miner), sink, COST);
        names.setClaimOpen(true);
        vm.stopPrank();

        pathUSD.mint(alice, 10 * 1e6);
        pathUSD.mint(bob,   10 * 1e6);
        vm.prank(alice); pathUSD.approve(address(names), type(uint256).max);
        vm.prank(bob);   pathUSD.approve(address(names), type(uint256).max);

        // alice is eligible, bob is not
        miner.setCount(alice, 1);
    }

    function test_happy_path_fee_routes_to_liquidity_sink() public {
        uint256 sinkBefore = pathUSD.balanceOf(sink);

        vm.prank(alice);
        names.claim("alice");

        assertEq(names.nameOf(alice), "alice");
        assertEq(names.displayNameOf(alice), "alice.fdoge");
        assertEq(names.resolveName("alice"), alice);
        assertEq(names.totalClaimed(), 1);
        assertEq(names.remaining(), 4999);
        assertEq(pathUSD.balanceOf(sink), sinkBefore + COST);
    }

    function test_ineligible_user_cannot_claim() public {
        vm.expectRevert(TdogeNames.NotEligible.selector);
        vm.prank(bob); names.claim("bob");
    }

    function test_claim_closed_blocks() public {
        vm.prank(admin); names.setClaimOpen(false);
        vm.expectRevert(TdogeNames.ClaimClosed.selector);
        vm.prank(alice); names.claim("alice");
    }

    function test_duplicate_name_reverts() public {
        vm.prank(alice); names.claim("forge");
        miner.setCount(bob, 1);
        vm.expectRevert(TdogeNames.NameTaken.selector);
        vm.prank(bob); names.claim("forge");
    }

    function test_one_id_per_wallet() public {
        vm.prank(alice); names.claim("alice");
        vm.expectRevert(TdogeNames.AlreadyHolder.selector);
        vm.prank(alice); names.claim("alice2");
    }

    function test_invalid_names() public {
        string[6] memory bad = ["", "Alice", "alice!", "-abc", "abc-", "a b"];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.expectRevert(TdogeNames.InvalidName.selector);
            vm.prank(alice); names.claim(bad[i]);
        }
    }

    function test_isNameAvailable_reflects_claims() public {
        assertTrue(names.isNameAvailable("tempo"));
        vm.prank(alice); names.claim("tempo");
        assertFalse(names.isNameAvailable("tempo"));
        assertFalse(names.isNameAvailable("Invalid!"));
    }

    function test_supply_cap() public {
        // fast-fill 5000 names (micro-optimised)
        for (uint256 i = 0; i < 5000; i++) {
            address u = address(uint160(0x1_0000 + i));
            miner.setCount(u, 1);
            pathUSD.mint(u, COST);
            vm.prank(u); pathUSD.approve(address(names), COST);
            vm.prank(u); names.claim(string.concat("u", vm.toString(i)));
        }
        assertEq(names.totalClaimed(), 5000);

        address late = address(0xBEEF);
        miner.setCount(late, 1);
        pathUSD.mint(late, COST);
        vm.prank(late); pathUSD.approve(address(names), COST);
        vm.expectRevert(TdogeNames.SupplyCapReached.selector);
        vm.prank(late); names.claim("overflow");
    }

    function test_admin_can_change_cost_and_sink() public {
        address newSink = address(0xC0FFEE);
        vm.startPrank(admin);
        names.setClaimCost(2 * 1e6); // 2 pathUSD
        names.setLiquiditySink(newSink);
        vm.stopPrank();

        pathUSD.mint(alice, 2 * 1e6);
        vm.prank(alice); names.claim("whale");
        assertEq(pathUSD.balanceOf(newSink), 2 * 1e6);
    }

    function test_zero_cost_still_requires_eligibility() public {
        vm.prank(admin); names.setClaimCost(0);
        vm.expectRevert(TdogeNames.NotEligible.selector);
        vm.prank(bob); names.claim("bob");
    }
}
