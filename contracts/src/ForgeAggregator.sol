// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IUniV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory);
}

/// @title ForgeAggregator — DOGE FORGE platform-fee swap router
/// @notice Thin wrapper around an underlying UniswapV2-style router (UnitFlow
///         V2.5 on Arc at deploy). Takes a fixed `feeBps` (default 10 = 0.10%)
///         of the input token, forwards it to `feeRecipient`, then forwards
///         the remainder into the external router.
///
///         fDOGE swaps DO NOT go through here — they use DOGE FORGE's own
///         TdogeRouter which already collects LP fees for the protocol.
///
/// @dev Fee is always taken in the INPUT token, regardless of pair. If that
///      token isn't USDC, the recipient (LiquidityManager) accumulates mixed
///      balances; admin can sweep them via `LiquidityManager.sweep()` and
///      convert to USDC externally.
contract ForgeAggregator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 50;   // 0.50% hard cap
    uint16 public constant BPS         = 10_000;

    IUniV2Router public immutable router;
    address     public feeRecipient;
    uint16      public feeBps = 10; // 0.10% default

    event Swap(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event FeeBpsUpdated(uint16 bps);
    event FeeRecipientUpdated(address who);

    error FeeTooHigh();
    error BadPath();
    error ZeroAmount();
    error ZeroAddress();

    constructor(address admin, address _router, address _feeRecipient) Ownable(admin) {
        if (_router == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        router = IUniV2Router(_router);
        feeRecipient = _feeRecipient;
    }

    // ============================================================
    //                          USER SWAP
    // ============================================================

    /// @notice Swap `amountIn` of path[0] for as much of path[last] as possible,
    ///         minus the protocol fee. `amountOutMin` is enforced AFTER fee.
    /// @param  path    UniV2-style token path; length >= 2.
    /// @param  to      Recipient of the output token.
    /// @param  deadline Unix seconds; enforced by the underlying router.
    /// @return amountOut Amount of final token delivered to `to`.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (path.length < 2) revert BadPath();

        address tokenIn  = path[0];
        address tokenOut = path[path.length - 1];

        // Pull full amount from the user.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Skim fee.
        uint256 fee = (amountIn * feeBps) / BPS;
        uint256 net = amountIn - fee;
        if (fee > 0) {
            IERC20(tokenIn).safeTransfer(feeRecipient, fee);
        }

        // Approve the external router for exactly `net` (idempotent via
        // forceApprove in case of residual allowance from a prior revert).
        IERC20(tokenIn).forceApprove(address(router), net);

        uint256[] memory outs = router.swapExactTokensForTokens(
            net, amountOutMin, path, to, deadline
        );
        amountOut = outs[outs.length - 1];

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    /// @notice Quote the output for `amountIn` through this aggregator,
    ///         accounting for the platform fee. Used by the UI.
    function getAmountsOutAfterFee(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert BadPath();
        uint256 fee = (amountIn * feeBps) / BPS;
        uint256 net = amountIn - fee;
        amounts = router.getAmountsOut(net, path);
    }

    // ============================================================
    //                            ADMIN
    // ============================================================

    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
        emit FeeBpsUpdated(bps);
    }

    function setFeeRecipient(address who) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        feeRecipient = who;
        emit FeeRecipientUpdated(who);
    }

    /// @notice Rescue tokens accidentally sent to this contract, or dust left
    ///         behind by a reverted swap. No funds should ever sit here in
    ///         normal operation.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
