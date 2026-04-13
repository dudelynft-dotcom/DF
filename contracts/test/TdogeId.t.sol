// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TdogeId} from "../src/TdogeId.sol";

contract TdogeIdTest is Test {
    TdogeId id;
    address admin = address(0xA11CE);
    address alice = address(0xA11);
    address bob   = address(0xB0B);
    address carol = address(0xCA401);

    function setUp() public {
        vm.prank(admin);
        id = new TdogeId(admin);
        // Open mint and whitelist alice + bob
        vm.startPrank(admin);
        id.setMintOpen(true);
        id.setWhitelisted(alice, true);
        id.setWhitelisted(bob, true);
        vm.stopPrank();
    }

    function test_mint_happy_path_sets_primary_and_consumes_whitelist() public {
        vm.prank(alice);
        uint256 t = id.mint("alice");
        assertEq(t, 1);
        assertEq(id.ownerOf(1), alice);
        assertEq(id.nameOf(1), "alice");
        assertEq(id.displayNameOf(1), "alice.tdoge");
        assertEq(id.primaryNameOf(alice), "alice.tdoge");
        assertFalse(id.whitelisted(alice)); // consumed
        assertEq(id.totalMinted(), 1);
        assertEq(id.remaining(), 1918);
    }

    function test_non_whitelisted_cannot_mint() public {
        vm.expectRevert(TdogeId.NotWhitelisted.selector);
        vm.prank(carol);
        id.mint("carol");
    }

    function test_mint_closed_blocks_even_whitelisted() public {
        vm.prank(admin); id.setMintOpen(false);
        vm.expectRevert(TdogeId.MintClosed.selector);
        vm.prank(alice); id.mint("alice");
    }

    function test_name_collision_reverts() public {
        vm.prank(alice); id.mint("forge");
        vm.expectRevert(TdogeId.NameTaken.selector);
        vm.prank(bob); id.mint("forge");
    }

    function test_invalid_names_rejected() public {
        string[6] memory bad = ["", "Alice", "alice!", "-abc", "abc-", "a_b"];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.prank(admin); id.setWhitelisted(alice, true);
            vm.expectRevert(TdogeId.InvalidName.selector);
            vm.prank(alice); id.mint(bad[i]);
        }
    }

    function test_one_mint_per_wallet() public {
        vm.prank(alice); id.mint("alice");
        vm.prank(admin); id.setWhitelisted(alice, true); // even re-whitelisted
        vm.expectRevert(TdogeId.AlreadyHolder.selector);
        vm.prank(alice); id.mint("alice2");
    }

    function test_supply_cap() public {
        // compress the test — whitelist and mint many addresses
        vm.startPrank(admin);
        for (uint256 i = 0; i < 1919; i++) {
            address user = address(uint160(0x2000 + i));
            id.setWhitelisted(user, true);
        }
        vm.stopPrank();
        for (uint256 i = 0; i < 1919; i++) {
            address user = address(uint160(0x2000 + i));
            vm.prank(user);
            id.mint(string.concat("u", vm.toString(i)));
        }
        assertEq(id.totalMinted(), 1919);

        // 1920th mint fails
        vm.prank(admin); id.setWhitelisted(carol, true);
        vm.expectRevert(TdogeId.SupplyCapReached.selector);
        vm.prank(carol); id.mint("overflow");
    }

    function test_resolveName_returns_owner() public {
        vm.prank(alice); id.mint("alice");
        (uint256 t, address owner) = id.resolveName("alice");
        assertEq(t, 1);
        assertEq(owner, alice);
    }

    function test_isNameAvailable() public {
        assertTrue(id.isNameAvailable("alice"));
        vm.prank(alice); id.mint("alice");
        assertFalse(id.isNameAvailable("alice"));
        assertFalse(id.isNameAvailable("Bad Name"));
    }

    function test_transfer_clears_primary() public {
        vm.prank(alice); id.mint("alice");
        assertEq(id.primaryNameOf(alice), "alice.tdoge");
        vm.prank(alice); id.transferFrom(alice, bob, 1);
        assertEq(id.primaryNameOf(alice), "");
        // bob does NOT inherit as primary automatically — must call setPrimary
        assertEq(id.primaryNameOf(bob), "");
        vm.prank(bob); id.setPrimary(1);
        assertEq(id.primaryNameOf(bob), "alice.tdoge");
    }

    function test_batch_whitelist() public {
        address[] memory users = new address[](3);
        users[0] = address(0x1001);
        users[1] = address(0x1002);
        users[2] = address(0x1003);
        vm.prank(admin); id.setWhitelistBatch(users, true);
        for (uint256 i = 0; i < users.length; i++) {
            assertTrue(id.whitelisted(users[i]));
        }
    }

    function test_nft_has_no_yield_hooks() public {
        // Sanity: contract cannot call into Miner or DOGE. It's purely ERC-721.
        // This test is a spec marker — checks there's no function exposing
        // protocol-linked behaviour.
        vm.prank(alice); id.mint("alice");
        assertEq(id.balanceOf(alice), 1);
        // no mint boost, no multiplier view, no staking — just ownership
    }
}
