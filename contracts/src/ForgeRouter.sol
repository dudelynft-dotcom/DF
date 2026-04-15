// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {TdogePair} from "./TdogePair.sol";
import {TdogeFactory} from "./TdogeFactory.sol";

/// @title ForgeRouter — multi-pair router for the DOGE FORGE DEX
/// @notice Wraps Uniswap V2-style factory + pairs with:
///           • addLiquidity / removeLiquidity
///           • path-based swapExactTokensForTokens
///           • 0.10% platform fee on swap input → LiquidityManager
/// @dev Replaces the earlier single-pair TdogeRouter and the ForgeAggregator
///      (which proxied to an external DEX). DOGE FORGE now owns the full
///      liquidity + trading layer; there is no third-party dependency.
contract ForgeRouter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_PLATFORM_FEE_BPS = 50;   // 0.50% hard ceiling
    uint16 public constant BPS                  = 10_000;
    uint16 public constant LP_FEE_MILLI         = 3;    // 0.30% LP fee, matches pair invariant

    TdogeFactory public immutable factory;
    address      public feeRecipient;
    uint16       public platformFeeBps = 10; // 0.10% default, 0 to disable
    bool         public feeEnabled     = true;

    /// @notice Optional pair whitelist. When `whitelistOnly = true`, only
    ///         pairs flagged in `pairApproved` can be used for swaps / LP
    ///         (useful for incident response or a cautious mainnet launch).
    ///         Default: whitelist off — any pair registered in the factory
    ///         is tradable.
    bool public whitelistOnly;
    mapping(address => bool) public pairApproved;

    event Swap(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event LiquidityAdded(
        address indexed user,
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed user,
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    event FeeUpdated(uint16 bps);
    event FeeEnabledSet(bool enabled);
    event FeeRecipientUpdated(address who);
    event WhitelistOnlySet(bool enabled);
    event PairApprovalSet(address indexed pair, bool approved);

    error ExpiredDeadline();
    error BadPath();
    error ZeroAmount();
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error InsufficientAAmount();
    error InsufficientBAmount();
    error PairMissing();
    error PairNotWhitelisted();
    error FeeTooHigh();
    error ZeroAddress();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        _;
    }

    constructor(address admin, address _factory, address _feeRecipient) Ownable(admin) {
        if (_factory == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        factory = TdogeFactory(_factory);
        feeRecipient = _feeRecipient;
    }

    // ============================================================
    //                         LIQUIDITY
    // ============================================================

    /// @notice Provide liquidity to (tokenA, tokenB). Creates the pair if
    ///         missing. Amounts are matched against current reserves; any
    ///         excess on one side is refunded via `amountAMin`/`amountBMin`.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        // Create pair lazily.
        if (factory.getPair(tokenA, tokenB) == address(0)) {
            factory.createPair(tokenA, tokenB);
        }
        address pair = factory.getPair(tokenA, tokenB);
        _requireWhitelisted(pair);

        (amountA, amountB) = _quoteAddLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);

        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = TdogePair(pair).mint(to);

        emit LiquidityAdded(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        // Intentionally NOT whenNotPaused / whitelist-gated: users must always
        // be able to withdraw their liquidity in an incident.
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairMissing();

        // Pull LP tokens into the pair then burn.
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 a0, uint256 a1) = TdogePair(pair).burn(to);

        (address token0, ) = _sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (a0, a1) : (a1, a0);
        if (amountA < amountAMin) revert InsufficientAAmount();
        if (amountB < amountBMin) revert InsufficientBAmount();

        emit LiquidityRemoved(msg.sender, tokenA, tokenB, amountA, amountB, liquidity);
    }

    function _quoteAddLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal view returns (uint256 amountA, uint256 amountB) {
        address pair = factory.getPair(tokenA, tokenB);
        (uint256 rA, uint256 rB) = _reservesSorted(pair, tokenA, tokenB);
        if (rA == 0 && rB == 0) {
            return (amountADesired, amountBDesired);
        }
        uint256 bOpt = (amountADesired * rB) / rA;
        if (bOpt <= amountBDesired) {
            if (bOpt < amountBMin) revert InsufficientBAmount();
            return (amountADesired, bOpt);
        }
        uint256 aOpt = (amountBDesired * rA) / rB;
        if (aOpt > amountADesired) revert InsufficientAAmount();
        if (aOpt < amountAMin) revert InsufficientAAmount();
        return (aOpt, amountBDesired);
    }

    // ============================================================
    //                            SWAP
    // ============================================================

    /// @notice Swap an exact amount of `path[0]` for as much of `path[last]`
    ///         as possible. Takes `platformFeeBps` from the input on entry;
    ///         the rest flows through the pair chain with standard V2 math.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        nonReentrant
        whenNotPaused
        returns (uint256[] memory amounts)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (path.length < 2) revert BadPath();
        // Validate every hop exists (and is whitelisted when the gate is on).
        for (uint256 i = 0; i < path.length - 1; i++) {
            address p = factory.getPair(path[i], path[i + 1]);
            if (p == address(0)) revert PairMissing();
            _requireWhitelisted(p);
        }

        // Pull full amount into the router, skim the platform fee.
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 fee = feeEnabled ? (amountIn * platformFeeBps) / BPS : 0;
        uint256 net = amountIn - fee;
        if (fee > 0) {
            IERC20(path[0]).safeTransfer(feeRecipient, fee);
        }

        amounts = getAmountsOut(net, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();

        // Send the net input into the first pair, then walk the chain.
        address firstPair = factory.getPair(path[0], path[1]);
        IERC20(path[0]).safeTransfer(firstPair, amounts[0]);
        _swapChain(amounts, path, to);

        emit Swap(msg.sender, path[0], path[path.length - 1], amountIn, amounts[amounts.length - 1], fee);
    }

    /// @notice Internal: walk the `path` sending amounts hop-by-hop.
    function _swapChain(uint256[] memory amounts, address[] calldata path, address to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address input  = path[i];
            address output = path[i + 1];
            (address token0, ) = _sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address recipient = i < path.length - 2
                ? factory.getPair(output, path[i + 2])
                : to;
            address pair = factory.getPair(input, output);
            if (pair == address(0)) revert PairMissing();
            TdogePair(pair).swap(amount0Out, amount1Out, recipient);
        }
    }

    // ============================================================
    //                      QUOTE HELPERS
    // ============================================================

    /// @notice Standard V2 fee-adjusted output formula.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInWithFee = amountIn * (1000 - LP_FEE_MILLI);
        uint256 numerator       = amountInWithFee * reserveOut;
        uint256 denominator     = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    /// @notice Chained getAmountsOut over a path; does not deduct the
    ///         platform fee. Callers that want the post-platform-fee output
    ///         should pass `amountIn * (BPS - platformFeeBps) / BPS` here.
    function getAmountsOut(uint256 amountIn, address[] memory path)
        public view returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert BadPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = factory.getPair(path[i], path[i + 1]);
            if (pair == address(0)) revert PairMissing();
            (uint256 rIn, uint256 rOut) = _reservesSorted(pair, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], rIn, rOut);
        }
    }

    /// @notice Post-fee quote: quotes what the user actually receives after
    ///         the router's platform-fee skim. The UI uses this to display
    ///         the honest number.
    function getAmountsOutAfterFee(uint256 amountIn, address[] memory path)
        external view returns (uint256[] memory amounts)
    {
        uint256 fee = feeEnabled ? (amountIn * platformFeeBps) / BPS : 0;
        return getAmountsOut(amountIn - fee, path);
    }

    // ============================================================
    //                        INTERNAL UTIL
    // ============================================================

    function _sortTokens(address a, address b) internal pure returns (address token0, address token1) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function _reservesSorted(address pair, address a, address b)
        internal view returns (uint256 rA, uint256 rB)
    {
        if (pair == address(0)) return (0, 0);
        (uint112 r0, uint112 r1, ) = TdogePair(pair).getReserves();
        (address token0, ) = _sortTokens(a, b);
        (rA, rB) = a == token0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _requireWhitelisted(address pair) internal view {
        if (whitelistOnly && !pairApproved[pair]) revert PairNotWhitelisted();
    }

    // ============================================================
    //                           ADMIN
    // ============================================================

    function setPlatformFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_PLATFORM_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = bps;
        emit FeeUpdated(bps);
    }

    function setFeeEnabled(bool enabled) external onlyOwner {
        feeEnabled = enabled;
        emit FeeEnabledSet(enabled);
    }

    function setFeeRecipient(address who) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        feeRecipient = who;
        emit FeeRecipientUpdated(who);
    }

    // ---- Pause ----
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ---- Whitelist ----
    function setWhitelistOnly(bool enabled) external onlyOwner {
        whitelistOnly = enabled;
        emit WhitelistOnlySet(enabled);
    }

    function setPairApproved(address pair, bool approved) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        pairApproved[pair] = approved;
        emit PairApprovalSet(pair, approved);
    }

    /// @notice Batch helper so the admin can tag a few pairs in one tx.
    function setPairsApproved(address[] calldata pairs, bool approved) external onlyOwner {
        for (uint256 i = 0; i < pairs.length; i++) {
            address p = pairs[i];
            if (p == address(0)) revert ZeroAddress();
            pairApproved[p] = approved;
            emit PairApprovalSet(p, approved);
        }
    }

    /// @notice Rescue tokens accidentally sent to this contract or left over
    ///         from a reverted swap. In normal operation no funds sit here.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
