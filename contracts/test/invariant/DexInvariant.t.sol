// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {TdogeFactory} from "../../src/TdogeFactory.sol";
import {TdogePair}    from "../../src/TdogePair.sol";
import {ForgeRouter}  from "../../src/ForgeRouter.sol";

/// @dev Mock token for fuzzing. Unlimited mint for the handler.
contract FuzzToken is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Handler — exposes bounded entry points to the fuzzer. Every path
/// mints tokens just-in-time so a single actor can't starve the pool.
contract DexHandler is Test {
    TdogeFactory public factory;
    ForgeRouter  public router;
    FuzzToken    public tokenA;
    FuzzToken    public tokenB;
    address      public pair; // resolved lazily after first addLiquidity

    // Actor rotation to widen the graph beyond msg.sender
    address[3] public actors;
    uint256 public ghostSwapIn;      // cumulative USDC-side input across all swaps
    uint256 public ghostFeeOut;      // cumulative USDC-side fee skimmed to LM
    uint256 public ghostSwapCount;   // bound on rounding slack (feeBps * 1-wei per call)

    address public feeSink;

    constructor(TdogeFactory f, ForgeRouter r, FuzzToken a, FuzzToken b, address fs) {
        factory = f;
        router  = r;
        tokenA  = a;
        tokenB  = b;
        feeSink = fs;
        actors  = [address(0xA11), address(0xB0B), address(0xC0C)];
    }

    function _pickActor(uint8 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function addLiquidity(uint8 actorSeed, uint128 amtA, uint128 amtB) public {
        address actor = _pickActor(actorSeed);
        amtA = uint128(bound(amtA, 1e6, 1_000_000 ether));
        amtB = uint128(bound(amtB, 1e6, 1_000_000 ether));

        tokenA.mint(actor, amtA);
        tokenB.mint(actor, amtB);

        vm.startPrank(actor);
        tokenA.approve(address(router), amtA);
        tokenB.approve(address(router), amtB);
        try router.addLiquidity(
            address(tokenA), address(tokenB),
            amtA, amtB, 0, 0, actor, block.timestamp + 300
        ) {} catch {}
        vm.stopPrank();

        if (pair == address(0)) pair = factory.getPair(address(tokenA), address(tokenB));
    }

    function swapAtoB(uint8 actorSeed, uint96 amountIn) public {
        if (pair == address(0)) return;
        (uint112 r0, uint112 r1, ) = TdogePair(pair).getReserves();
        if (r0 == 0 || r1 == 0) return;

        address actor = _pickActor(actorSeed);
        amountIn = uint96(bound(amountIn, 1e6, 100_000 ether));
        tokenA.mint(actor, amountIn);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(actor);
        tokenA.approve(address(router), amountIn);
        uint256 preSink = tokenA.balanceOf(feeSink);
        try router.swapExactTokensForTokens(amountIn, 0, path, actor, block.timestamp + 300) {
            ghostSwapIn += amountIn;
            ghostFeeOut += tokenA.balanceOf(feeSink) - preSink;
            ghostSwapCount++;
        } catch {}
        vm.stopPrank();
    }

    function swapBtoA(uint8 actorSeed, uint96 amountIn) public {
        if (pair == address(0)) return;
        (uint112 r0, uint112 r1, ) = TdogePair(pair).getReserves();
        if (r0 == 0 || r1 == 0) return;

        address actor = _pickActor(actorSeed);
        amountIn = uint96(bound(amountIn, 1e6, 100_000 ether));
        tokenB.mint(actor, amountIn);

        address[] memory path = new address[](2);
        path[0] = address(tokenB);
        path[1] = address(tokenA);

        vm.startPrank(actor);
        tokenB.approve(address(router), amountIn);
        try router.swapExactTokensForTokens(amountIn, 0, path, actor, block.timestamp + 300) {} catch {}
        vm.stopPrank();
    }

    function removeLiquidity(uint8 actorSeed, uint16 bps) public {
        if (pair == address(0)) return;
        address actor = _pickActor(actorSeed);
        uint256 lp = IERC20(pair).balanceOf(actor);
        if (lp == 0) return;
        bps = uint16(bound(bps, 1, 10_000));
        uint256 amt = (lp * bps) / 10_000;

        vm.startPrank(actor);
        IERC20(pair).approve(address(router), amt);
        try router.removeLiquidity(
            address(tokenA), address(tokenB),
            amt, 0, 0, actor, block.timestamp + 300
        ) {} catch {}
        vm.stopPrank();
    }
}

contract DexInvariantTest is Test {
    TdogeFactory factory;
    ForgeRouter  router;
    FuzzToken    tokenA;
    FuzzToken    tokenB;
    DexHandler   handler;
    address      admin   = address(0xA11CE);
    address      feeSink = address(0xF11FE);

    function setUp() public {
        vm.startPrank(admin);
        factory = new TdogeFactory(admin);
        router  = new ForgeRouter(admin, address(factory), feeSink);
        vm.stopPrank();

        tokenA  = new FuzzToken("A", "A", 18);
        tokenB  = new FuzzToken("B", "B", 6);
        handler = new DexHandler(factory, router, tokenA, tokenB, feeSink);

        // Only the handler can drive the fuzzer's sequence generation.
        targetContract(address(handler));

        // Whitelist the public entry points (keeps the fuzzer from poking
        // helpers that would revert trivially and waste call budget).
        bytes4[] memory sel = new bytes4[](4);
        sel[0] = DexHandler.addLiquidity.selector;
        sel[1] = DexHandler.swapAtoB.selector;
        sel[2] = DexHandler.swapBtoA.selector;
        sel[3] = DexHandler.removeLiquidity.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: sel }));
    }

    /// @notice k = reserve0 * reserve1 must be monotonically non-decreasing
    /// through any sequence of valid swaps and LP actions, subject to the
    /// standard invariant that LP burns move reserves proportionally and
    /// a donation-less swap raises k by the fee share.
    ///
    /// The weaker form "k never crashes to near-zero" is what we check —
    /// strict monotonicity breaks under legitimate burn-all-then-refill
    /// cycles the fuzzer can produce.
    function invariant_pair_k_never_zero_when_seeded() public view {
        address pair = handler.pair();
        if (pair == address(0)) return;
        (uint112 r0, uint112 r1, ) = TdogePair(pair).getReserves();
        uint256 supply = IERC20(pair).totalSupply();
        // If LP supply > 0 then both reserves must be > 0.
        if (supply > 0) {
            assertGt(r0, 0, "reserve0 positive when LP outstanding");
            assertGt(r1, 0, "reserve1 positive when LP outstanding");
        }
    }

    /// @notice Fee skim never exceeds the bulk expected amount, and never
    /// falls more than one wei per swap below it. Per-swap rounding is
    /// always floor, so aggregate skim = sum_i floor(x_i * bps / BPS).
    /// This sum is ≤ floor(sum_i x_i * bps / BPS) and may underbake by
    /// at most (number_of_swaps) wei. Confirms: no overcharging (the
    /// security-relevant direction) and bounded undercharging.
    function invariant_fee_never_exceeds_configured_bps() public view {
        uint256 bulkMax = (handler.ghostSwapIn() * router.platformFeeBps()) / router.BPS();
        assertLe(handler.ghostFeeOut(), bulkMax,
            "fee skim must never exceed bps-of-volume (no overcharge)");
        // Slack bound: at most 1 wei per swap due to per-call floor().
        uint256 minSkim = bulkMax > handler.ghostSwapCount() ? bulkMax - handler.ghostSwapCount() : 0;
        assertGe(handler.ghostFeeOut(), minSkim,
            "fee skim within 1 wei per swap of expected");
    }

    /// @notice Fee recipient balance contains exactly the skimmed fees
    /// (nobody else transfers into it in this test).
    function invariant_fee_sink_holds_skimmed_fees() public view {
        assertEq(IERC20(tokenA).balanceOf(feeSink), handler.ghostFeeOut(),
            "sink holds every satoshi skimmed");
    }

    /// @notice Router holds no user funds in steady state. Between
    /// transactions, its token balance must be zero for both sides.
    function invariant_router_holds_no_funds() public view {
        assertEq(IERC20(tokenA).balanceOf(address(router)), 0, "router tokenA should be 0");
        assertEq(IERC20(tokenB).balanceOf(address(router)), 0, "router tokenB should be 0");
    }

    /// @notice Admin-controlled parameters respect their hard caps.
    function invariant_admin_params_within_caps() public view {
        assertLe(router.platformFeeBps(), router.MAX_PLATFORM_FEE_BPS(),
            "platformFeeBps <= MAX_PLATFORM_FEE_BPS");
    }
}
