// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TdogePair — single-pair constant-product AMM for TDOGE / pathUSD
/// @notice Uniswap V2-style mechanics, 0.30% swap fee retained by LPs.
///         token0/token1 are sorted at construction per UniV2 convention.
///         Caller pre-transfers input tokens, then invokes mint/swap/burn.
contract TdogePair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 10 ** 3;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32  private blockTimestampLast;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to, uint256 liquidity);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error InvalidTo();
    error KInvariant();
    error ReserveOverflow();
    error IdenticalTokens();
    error ZeroAddress();

    constructor(address _a, address _b) ERC20("DOGE FORGE LP", "DFLP") {
        if (_a == _b) revert IdenticalTokens();
        if (_a == address(0) || _b == address(0)) revert ZeroAddress();
        (address lo, address hi) = _a < _b ? (_a, _b) : (_b, _a);
        token0 = IERC20(lo);
        token1 = IERC20(hi);
    }

    function getReserves() public view returns (uint112 _r0, uint112 _r1, uint32 _ts) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function _update(uint256 b0, uint256 b1) private {
        if (b0 > type(uint112).max || b1 > type(uint112).max) revert ReserveOverflow();
        reserve0 = uint112(b0);
        reserve1 = uint112(b1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 _r0, uint112 _r1, ) = getReserves();
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));
        uint256 a0 = bal0 - _r0;
        uint256 a1 = bal1 - _r1;

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = _sqrt(a0 * a1);
            if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted();
            liquidity -= MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min((a0 * _totalSupply) / _r0, (a1 * _totalSupply) / _r1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(bal0, bal1);
        emit Mint(msg.sender, a0, a1, to, liquidity);
    }

    function burn(address to) external nonReentrant returns (uint256 a0, uint256 a1) {
        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));
        uint256 liq = balanceOf(address(this));
        uint256 _totalSupply = totalSupply();
        a0 = (liq * bal0) / _totalSupply;
        a1 = (liq * bal1) / _totalSupply;
        if (a0 == 0 || a1 == 0) revert InsufficientLiquidityBurned();
        _burn(address(this), liq);
        token0.safeTransfer(to, a0);
        token1.safeTransfer(to, a1);
        bal0 = token0.balanceOf(address(this));
        bal1 = token1.balanceOf(address(this));
        _update(bal0, bal1);
        emit Burn(msg.sender, a0, a1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 _r0, uint112 _r1, ) = getReserves();
        if (amount0Out >= _r0 || amount1Out >= _r1) revert InsufficientLiquidity();
        if (to == address(token0) || to == address(token1)) revert InvalidTo();

        if (amount0Out > 0) token0.safeTransfer(to, amount0Out);
        if (amount1Out > 0) token1.safeTransfer(to, amount1Out);

        uint256 bal0 = token0.balanceOf(address(this));
        uint256 bal1 = token1.balanceOf(address(this));
        uint256 a0In = bal0 > _r0 - amount0Out ? bal0 - (_r0 - amount0Out) : 0;
        uint256 a1In = bal1 > _r1 - amount1Out ? bal1 - (_r1 - amount1Out) : 0;
        if (a0In == 0 && a1In == 0) revert InsufficientInputAmount();

        // 0.3% LP fee: (bal*1000 - in*3) as the fee-adjusted balance
        uint256 adj0 = bal0 * 1000 - a0In * 3;
        uint256 adj1 = bal1 * 1000 - a1In * 3;
        if (adj0 * adj1 < uint256(_r0) * uint256(_r1) * 1_000_000) revert KInvariant();

        _update(bal0, bal1);
        emit Swap(msg.sender, a0In, a1In, amount0Out, amount1Out, to);
    }

    function skim(address to) external nonReentrant {
        token0.safeTransfer(to, token0.balanceOf(address(this)) - reserve0);
        token1.safeTransfer(to, token1.balanceOf(address(this)) - reserve1);
    }

    function sync() external nonReentrant {
        _update(token0.balanceOf(address(this)), token1.balanceOf(address(this)));
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) { z = 1; }
    }
    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
