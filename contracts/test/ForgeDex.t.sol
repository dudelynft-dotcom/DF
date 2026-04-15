// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {TdogeFactory} from "../src/TdogeFactory.sol";
import {TdogePair}    from "../src/TdogePair.sol";
import {ForgeRouter}  from "../src/ForgeRouter.sol";

/// @dev Plain ERC-20 with mintable faucet for test-setup only.
contract MockToken is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ForgeDexTest is Test {
    address admin     = address(0xA11CE);
    address feeSink   = address(0xF11FE); // mock LiquidityManager target
    address alice     = address(0xA11);
    address bob       = address(0xB0B);

    TdogeFactory factory;
    ForgeRouter  router;
    MockToken    tokenA;   // pretend: fDOGE (18d)
    MockToken    tokenB;   // pretend: USDC  (6d)

    function setUp() public {
        vm.startPrank(admin);
        factory = new TdogeFactory(admin);
        router  = new ForgeRouter(admin, address(factory), feeSink);
        vm.stopPrank();

        tokenA = new MockToken("A", "A", 18);
        tokenB = new MockToken("B", "B", 6);

        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 * 1e6);
        tokenA.mint(bob,   1_000_000 ether);
        tokenB.mint(bob,   1_000_000 * 1e6);
    }

    // ============================================================
    //                         FACTORY
    // ============================================================

    function test_createPair_permissionless_and_deterministic() public {
        vm.prank(bob);
        address pair1 = factory.createPair(address(tokenA), address(tokenB));
        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair1);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair1);
        assertEq(factory.allPairsLength(), 1);
    }

    function test_createPair_reverts_on_duplicate() public {
        vm.prank(bob);
        factory.createPair(address(tokenA), address(tokenB));
        vm.expectRevert(TdogeFactory.PairExists.selector);
        vm.prank(bob);
        factory.createPair(address(tokenA), address(tokenB));
    }

    function test_createPair_reverts_on_identical_tokens() public {
        vm.expectRevert(TdogeFactory.IdenticalAddresses.selector);
        factory.createPair(address(tokenA), address(tokenA));
    }

    function test_registerPair_admin_only() public {
        // Non-admin can't register.
        address fakePair = address(new TdogePair(address(tokenA), address(tokenB)));
        vm.prank(bob);
        vm.expectRevert();
        factory.registerPair(address(tokenA), address(tokenB), fakePair);
    }

    function test_registerPair_validates_token_binding() public {
        // Pair says (tokenA, tokenB) but we try to bind (tokenA, tokenC) → revert.
        MockToken tokenC = new MockToken("C", "C", 18);
        address realPair = address(new TdogePair(address(tokenA), address(tokenB)));

        vm.prank(admin);
        vm.expectRevert(TdogeFactory.NotAPair.selector);
        factory.registerPair(address(tokenA), address(tokenC), realPair);
    }

    function test_registerPair_happy_path() public {
        address existing = address(new TdogePair(address(tokenA), address(tokenB)));
        vm.prank(admin);
        factory.registerPair(address(tokenA), address(tokenB), existing);
        assertEq(factory.getPair(address(tokenA), address(tokenB)), existing);
    }

    // ============================================================
    //                         LIQUIDITY
    // ============================================================

    function test_addLiquidity_creates_pair_lazily() public {
        uint256 aAmt = 1000 ether;
        uint256 bAmt = 1000 * 1e6;

        vm.startPrank(alice);
        tokenA.approve(address(router), aAmt);
        tokenB.approve(address(router), bAmt);
        router.addLiquidity(
            address(tokenA), address(tokenB),
            aAmt, bAmt, 0, 0, alice, block.timestamp + 300
        );
        vm.stopPrank();

        address pair = factory.getPair(address(tokenA), address(tokenB));
        assertTrue(pair != address(0));
        (uint112 r0, uint112 r1, ) = TdogePair(pair).getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);
        assertGt(IERC20(pair).balanceOf(alice), 0, "alice got LP");
    }

    function test_removeLiquidity_returns_funds_even_when_paused() public {
        _seed(1_000 ether, 1_000 * 1e6);

        address pair = factory.getPair(address(tokenA), address(tokenB));
        uint256 lp   = IERC20(pair).balanceOf(alice);

        vm.prank(admin);
        router.pause();

        // removeLiquidity must still work when router is paused
        vm.startPrank(alice);
        IERC20(pair).approve(address(router), lp);
        router.removeLiquidity(
            address(tokenA), address(tokenB),
            lp, 0, 0, alice, block.timestamp + 300
        );
        vm.stopPrank();
    }

    // ============================================================
    //                            SWAP
    // ============================================================

    function test_swap_takes_platform_fee_to_recipient() public {
        _seed(10_000 ether, 10_000 * 1e6);

        uint256 sinkBefore = tokenA.balanceOf(feeSink);

        uint256 amountIn = 100 ether; // tokenA
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), amountIn);
        router.swapExactTokensForTokens(amountIn, 0, path, bob, block.timestamp + 300);
        vm.stopPrank();

        // Default 0.10% = 10 bps of 100 ether = 0.1 ether
        uint256 fee = tokenA.balanceOf(feeSink) - sinkBefore;
        assertEq(fee, (amountIn * 10) / 10_000, "platform fee = 0.10% of input");
    }

    function test_swap_respects_minOut() public {
        _seed(10_000 ether, 10_000 * 1e6);
        uint256 amountIn = 100 ether;
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256[] memory quote = router.getAmountsOutAfterFee(amountIn, path);
        // Set minOut higher than the quote: swap must revert.
        uint256 minOut = quote[1] + 1;

        vm.startPrank(bob);
        tokenA.approve(address(router), amountIn);
        vm.expectRevert(ForgeRouter.InsufficientOutputAmount.selector);
        router.swapExactTokensForTokens(amountIn, minOut, path, bob, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_swap_blocked_when_paused() public {
        _seed(10_000 ether, 10_000 * 1e6);
        vm.prank(admin);
        router.pause();

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), 1 ether);
        vm.expectRevert();
        router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_whitelist_only_blocks_unapproved_pair() public {
        _seed(10_000 ether, 10_000 * 1e6);
        address pair = factory.getPair(address(tokenA), address(tokenB));

        vm.prank(admin);
        router.setWhitelistOnly(true);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), 1 ether);
        vm.expectRevert(ForgeRouter.PairNotWhitelisted.selector);
        router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 300);
        vm.stopPrank();

        // Approve and retry
        vm.prank(admin);
        router.setPairApproved(pair, true);

        vm.startPrank(bob);
        router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_fee_disabled_skips_skim() public {
        _seed(10_000 ether, 10_000 * 1e6);

        vm.prank(admin);
        router.setFeeEnabled(false);

        uint256 sinkBefore = tokenA.balanceOf(feeSink);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), 1 ether);
        router.swapExactTokensForTokens(1 ether, 0, path, bob, block.timestamp + 300);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(feeSink), sinkBefore, "no fee should be skimmed");
    }

    function test_fee_cannot_exceed_hard_cap() public {
        vm.prank(admin);
        vm.expectRevert(ForgeRouter.FeeTooHigh.selector);
        router.setPlatformFeeBps(51); // cap is 50
    }

    // ============================================================
    //                     INVARIANT-ish
    // ============================================================

    /// @notice After a swap, pair's k must not decrease below pre-swap k.
    function test_invariant_k_non_decreasing_over_many_swaps(uint64 rawIn) public {
        uint256 amountIn = uint256(rawIn) % (1_000 ether) + 1;
        _seed(100_000 ether, 100_000 * 1e6);

        address pair = factory.getPair(address(tokenA), address(tokenB));
        (uint112 r0Before, uint112 r1Before, ) = TdogePair(pair).getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), amountIn);
        try router.swapExactTokensForTokens(amountIn, 0, path, bob, block.timestamp + 300) {} catch {}
        vm.stopPrank();

        (uint112 r0After, uint112 r1After, ) = TdogePair(pair).getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        assertGe(kAfter, kBefore, "k must never decrease");
    }

    // ============================================================
    //                        TEST HELPERS
    // ============================================================

    function _seed(uint256 aAmt, uint256 bAmt) internal {
        vm.startPrank(alice);
        tokenA.approve(address(router), aAmt);
        tokenB.approve(address(router), bAmt);
        router.addLiquidity(
            address(tokenA), address(tokenB),
            aAmt, bAmt, 0, 0, alice, block.timestamp + 300
        );
        vm.stopPrank();
    }
}
