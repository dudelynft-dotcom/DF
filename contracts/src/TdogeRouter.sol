// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TdogePair} from "./TdogePair.sol";

/// @title TdogeRouter — one-call swap helper for TdogePair
/// @notice The pair itself follows UniV2's "caller pre-transfers" convention.
///         This router bundles the transferFrom + quote + swap into a single
///         user tx so UIs don't have to do any math client-side.
contract TdogeRouter {
    using SafeERC20 for IERC20;

    TdogePair public immutable pair;
    IERC20 public immutable token0;
    IERC20 public immutable token1;

    error ExpiredDeadline();
    error InsufficientOutputAmount();
    error InvalidToken();
    error ExcessiveInputAmount();

    constructor(address _pair) {
        pair = TdogePair(_pair);
        token0 = pair.token0();
        token1 = pair.token1();
    }

    // -------- quote helpers (pure) --------

    /// @notice Uniswap V2 formula: out = in * 997 * rOut / (rIn * 1000 + in * 997).
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    /// @notice Uniswap V2 formula: in = ceil(rIn * out * 1000 / ((rOut - out) * 997)).
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256)
    {
        if (amountOut == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        if (amountOut >= reserveOut) return type(uint256).max;
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        return numerator / denominator + 1;
    }

    function quote(address tokenIn, uint256 amountIn)
        external view returns (uint256 amountOut)
    {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        if (tokenIn == address(token0)) amountOut = getAmountOut(amountIn, r0, r1);
        else if (tokenIn == address(token1)) amountOut = getAmountOut(amountIn, r1, r0);
        else revert InvalidToken();
    }

    // -------- swap --------

    /// @notice Swap an exact amount of tokenIn for as much of the other token as possible.
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        bool inIs0 = tokenIn == address(token0);
        if (!inIs0 && tokenIn != address(token1)) revert InvalidToken();

        (uint256 rIn, uint256 rOut) = inIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        amountOut = getAmountOut(amountIn, rIn, rOut);
        if (amountOut < minAmountOut) revert InsufficientOutputAmount();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(pair), amountIn);
        if (inIs0) pair.swap(0, amountOut, to);
        else       pair.swap(amountOut, 0, to);
    }

    /// @notice Swap up to `maxAmountIn` of tokenIn to receive exactly `amountOut`.
    function swapExactOut(
        address tokenIn,
        uint256 amountOut,
        uint256 maxAmountIn,
        address to,
        uint256 deadline
    ) external returns (uint256 amountIn) {
        if (block.timestamp > deadline) revert ExpiredDeadline();
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        bool inIs0 = tokenIn == address(token0);
        if (!inIs0 && tokenIn != address(token1)) revert InvalidToken();

        (uint256 rIn, uint256 rOut) = inIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        amountIn = getAmountIn(amountOut, rIn, rOut);
        if (amountIn > maxAmountIn) revert ExcessiveInputAmount();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(pair), amountIn);
        if (inIs0) pair.swap(0, amountOut, to);
        else       pair.swap(amountOut, 0, to);
    }
}
