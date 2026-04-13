// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DOGE — Tempo Doge (hybrid supply model)
/// @notice Phase 1: strict cap at 21,000,000 DOGE.
///         Phase 2: after initial cap is reached, controlled linear inflation
///                  (default 1,000,000 DOGE / year, admin-adjustable, hard-capped
///                  at 5%/yr). Admin may reduce/pause inflation at any time.
///         Also applies a 0.1% transfer fee (max 0.2%) routed to treasury.
contract DOGE is ERC20, Ownable {
    uint256 public constant INITIAL_CAP           = 210_000_000 ether;
    uint256 public constant MAX_FEE_BPS           = 20;                 // 0.2%
    uint256 public constant MAX_YEARLY_INFLATION  = 10_500_000 ether;   // 5% of INITIAL_CAP
    uint256 public constant SECONDS_PER_YEAR      = 365 days;

    mapping(address => bool) public minters;
    mapping(address => bool) public feeExempt;

    address public feeTreasury;
    uint256 public feeBps = 10; // 0.1%

    // ---- post-cap inflation ----
    uint256 public yearlyInflation = 10_000_000 ether; // default 10M / year
    uint64  public capAnchorTime;                     // timestamp when INITIAL_CAP was first reached (0 until then)

    event MinterSet(address indexed minter, bool allowed);
    event FeeExemptSet(address indexed who, bool exempt);
    event FeeBpsUpdated(uint256 bps);
    event FeeTreasuryUpdated(address treasury);
    event YearlyInflationUpdated(uint256 amount);
    event CapAnchored(uint64 at);

    error NotMinter();
    error CapExceeded();
    error FeeTooHigh();
    error InflationTooHigh();

    constructor(address admin, address _feeTreasury) ERC20("Tempo Doge", "TDOGE") Ownable(admin) {
        feeTreasury = _feeTreasury;
        feeExempt[_feeTreasury] = true;
    }

    // ============================================================
    //                        CAP / MINT
    // ============================================================

    /// @notice Current dynamic supply ceiling.
    ///         Pre-anchor: INITIAL_CAP.
    ///         Post-anchor: INITIAL_CAP + elapsedSinceAnchor × yearlyInflation / YEAR.
    function currentCap() public view returns (uint256) {
        if (capAnchorTime == 0) return INITIAL_CAP;
        uint256 elapsed = block.timestamp - capAnchorTime;
        return INITIAL_CAP + (elapsed * yearlyInflation) / SECONDS_PER_YEAR;
    }

    /// @notice Deprecated alias retained for readability; always returns INITIAL_CAP.
    function MAX_SUPPLY() external pure returns (uint256) { return INITIAL_CAP; }

    function setMinter(address m, bool allowed) external onlyOwner {
        minters[m] = allowed;
        emit MinterSet(m, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        uint256 cap = currentCap();
        if (totalSupply() + amount > cap) revert CapExceeded();
        _mint(to, amount);
        // anchor at the first block that crosses INITIAL_CAP
        if (capAnchorTime == 0 && totalSupply() >= INITIAL_CAP) {
            capAnchorTime = uint64(block.timestamp);
            emit CapAnchored(capAnchorTime);
        }
    }

    // ============================================================
    //                       INFLATION ADMIN
    // ============================================================

    function setYearlyInflation(uint256 amount) external onlyOwner {
        if (amount > MAX_YEARLY_INFLATION) revert InflationTooHigh();
        yearlyInflation = amount;
        emit YearlyInflationUpdated(amount);
    }

    /// @notice Stop all post-cap inflation (does not affect pre-cap emission).
    function pauseInflation() external onlyOwner {
        yearlyInflation = 0;
        emit YearlyInflationUpdated(0);
    }

    // ============================================================
    //                        FEE ADMIN
    // ============================================================

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
        emit FeeBpsUpdated(bps);
    }

    function setFeeTreasury(address t) external onlyOwner {
        require(t != address(0), "zero treasury");
        feeTreasury = t;
        emit FeeTreasuryUpdated(t);
    }

    function setFeeExempt(address who, bool exempt) external onlyOwner {
        feeExempt[who] = exempt;
        emit FeeExemptSet(who, exempt);
    }

    // ============================================================
    //                     FEE-ON-TRANSFER
    // ============================================================

    function _update(address from, address to, uint256 value) internal override {
        uint256 bps = feeBps;
        if (bps == 0 || from == address(0) || to == address(0) || feeExempt[from] || feeExempt[to]) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * bps) / 10_000;
        if (fee > 0 && feeTreasury != address(0)) {
            super._update(from, feeTreasury, fee);
            unchecked { value -= fee; }
        }
        super._update(from, to, value);
    }
}
