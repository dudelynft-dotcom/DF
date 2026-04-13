// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {DOGE} from "./DOGE.sol";
import {TdogePair} from "./TdogePair.sol";

/// @title LiquidityManager — auto-seeds TDOGE/pathUSD liquidity from Miner flush
/// @notice Receives the 95% share of flowed pathUSD from Miner, mints matching
///         TDOGE from a reserve budget, and deposits both into TdogePair to
///         grow liquidity automatically. Mint budget is capped and counts
///         toward DOGE.INITIAL_CAP (enforced by DOGE itself).
///
///         `seedLiquidity()` is permissionless so anyone can pay gas to process
///         the backlog. Analytics: `totalReceived` / `totalDeployed` / `dogeMinted`.
contract LiquidityManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20    public immutable pathUSD;
    DOGE      public immutable doge;
    TdogePair public immutable pair;

    uint256 public immutable pathUSDUnit;

    /// TDOGE per 1 whole pathUSD (18-decimal scaled). Used only on first seed
    /// when the pool is empty. Default 100 TDOGE per pathUSD.
    uint256 public initialDogePerPathUSD = 100 ether;

    /// TDOGE budget this contract may mint. Counts toward DOGE.INITIAL_CAP.
    uint256 public dogeMintBudget;
    uint256 public dogeMinted;

    uint256 public totalReceived;     // cumulative pathUSD in
    uint256 public totalDeployed;     // cumulative pathUSD deployed to pair

    event LiquidityAdded(uint256 pathUSDIn, uint256 dogeIn, uint256 lp);
    event ParamUpdated(bytes32 indexed key, uint256 value);

    error BudgetExceeded();
    error NoPathUSD();

    constructor(
        address admin,
        address _pathUSD,
        address _doge,
        address _pair,
        uint8   _pathUSDDecimals,
        uint256 _dogeMintBudget
    ) Ownable(admin) {
        pathUSD = IERC20(_pathUSD);
        doge    = DOGE(_doge);
        pair    = TdogePair(_pair);
        require(_pathUSDDecimals <= 30, "bad decimals");
        pathUSDUnit = 10 ** _pathUSDDecimals;
        dogeMintBudget = _dogeMintBudget;
    }

    /// @notice Deposit all held pathUSD into the pair (minting matching TDOGE).
    ///         Tracks totalReceived / totalDeployed for operator visibility.
    function seedLiquidity() external nonReentrant returns (uint256 lp) {
        uint256 balU = pathUSD.balanceOf(address(this));
        if (balU == 0) revert NoPathUSD();

        // Miner tracks what it sent us; we count it on arrival here via balance snapshot.
        totalReceived += balU;

        uint256 dogeNeeded = _quoteDoge(balU);
        if (dogeMinted + dogeNeeded > dogeMintBudget) revert BudgetExceeded();
        dogeMinted += dogeNeeded;
        doge.mint(address(this), dogeNeeded);

        // Transfer both tokens into the pair, then call mint(to=this).
        pathUSD.safeTransfer(address(pair), balU);
        IERC20(address(doge)).safeTransfer(address(pair), dogeNeeded);
        lp = pair.mint(address(this));

        totalDeployed += balU;
        emit LiquidityAdded(balU, dogeNeeded, lp);
    }

    /// @dev TDOGE amount needed to pair against `pathUSDAmount` (both in native wei).
    function _quoteDoge(uint256 pathUSDAmount) internal view returns (uint256) {
        (uint112 r0, uint112 r1, ) = pair.getReserves();
        address t0 = address(pair.token0());
        (uint256 rU, uint256 rD) = t0 == address(pathUSD)
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));
        if (rU == 0 || rD == 0) {
            // initial seed at admin-set price: dogeAmount = pathUSDAmount * (TDOGE/pathUSD) / pathUSDUnit
            return (pathUSDAmount * initialDogePerPathUSD) / pathUSDUnit;
        }
        return (pathUSDAmount * rD) / rU;
    }

    // --------- admin ---------

    function setInitialPrice(uint256 v) external onlyOwner {
        initialDogePerPathUSD = v;
        emit ParamUpdated("initialDogePerPathUSD", v);
    }

    function setDogeMintBudget(uint256 v) external onlyOwner {
        dogeMintBudget = v;
        emit ParamUpdated("dogeMintBudget", v);
    }

    /// @notice Rescue any ERC20 (non-LP) stuck at this address.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
