// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {DOGE} from "./DOGE.sol";

interface ILiquidityManagerSeed {
    function seedLiquidity() external returns (uint256);
}

/// @title Miner — multi-position mining with per-position Harvest Mode
/// @notice
///   Each `commit()` call opens a NEW position with its own chosen Harvest Mode
///   and its own unlock timer. Users can run many positions in parallel — e.g.
///   one Instant for liquidity, one Long-Term for maximum boost.
///
///   Emission per position accrual =
///     phaseRate × commitmentBoost × harvestModeBoost × global × adaptive
///   clamped to [minEffective, maxEffective].
///
///   Commitment boost is evaluated per-position (by that position's size).
///   Harvest Mode is chosen per-position and is immutable for that position.
///
///   Per-wallet cap applies to the SUM of all OPEN positions' totalDeposited.
///   Miner score accrues continuously across all open positions.
contract Miner is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant SECONDS_PER_DAY = 86_400;

    IERC20 public immutable pathUSD;
    DOGE   public immutable doge;
    uint256 public immutable pathUSDUnit;

    // ---- destination sinks ----
    address public liquidityManager;
    address public treasury;
    uint256 public liquidityBps = 9_500;
    uint256 public treasuryBps  =   500;

    // ---- core tunables ----
    uint256 public globalMultiplier  = 10_000;
    uint256 public flowRateBpsPerDay = 200;
    uint256 public perWalletCap;
    uint256 public postCapRatePerPathUSD = 0.2 ether;
    uint256 public maxPositionsPerWallet = 10;   // gas bound on loops

    // ---- effective multiplier band ----
    uint256 public minEffectiveMultBps =    2_500;
    uint256 public maxEffectiveMultBps =  100_000;

    // ---- adaptive ----
    bool    public adaptiveEnabled;
    uint256 public referenceTdogePrice;
    uint256 public targetValueBps = 10_000;
    uint256 public adaptiveMinBps =  8_000;
    uint256 public adaptiveMaxBps = 11_000;

    uint256 public totalFlowed;

    struct Phase {
        uint256 supplyThreshold;
        uint256 ratePerPathUSD;
    }
    Phase[] public phases;

    struct CommitmentTier {
        uint256 minDeposit;
        uint256 multiplierBps;
    }
    CommitmentTier[] public commitmentTiers;

    struct HarvestMode {
        uint32  lockSeconds;
        uint256 multiplierBps;
    }
    HarvestMode[] public harvestModes;

    /// @notice A single mining position owned by one user.
    struct Position {
        uint256 remaining;        // pathUSD still to flow
        uint256 totalDeposited;   // original commitment
        uint64  lastUpdate;
        uint64  unlockAt;         // earliest timestamp harvest allowed
        uint8   mode;             // index into harvestModes
        bool    open;             // false once fully closed
        uint256 pendingDoge;      // TDOGE accrued but not yet claimed
    }

    /// @dev `_positions[user]` is append-only; closed positions remain with
    ///      `open = false`. Frontends filter by `open` for active lists.
    mapping(address => Position[]) private _positions;

    mapping(address => uint256) public minerScore;

    uint256 public pendingLiquidity;
    uint256 public pendingTreasury;

    // ---- auto-flush (replaces the off-chain keeper) ----
    /// @notice When true, user-facing writes (commit/harvest) auto-trigger a
    ///         flush + seedLiquidity once thresholds are met.
    bool    public autoFlushEnabled = true;
    /// @notice Minimum pendingLiquidity (in pathUSD-wei) that triggers an auto-flush.
    uint256 public autoFlushThreshold;
    /// @notice Time (seconds) since the last auto-flush after which any non-zero
    ///         pendingLiquidity will trigger a flush even if below threshold.
    uint256 public autoFlushIntervalSec = 1 hours;
    uint64  public lastAutoFlushAt;

    event Committed(address indexed user, uint256 indexed positionId, uint256 amount, uint8 mode, uint64 unlockAt);
    event Accrued(address indexed user, uint256 indexed positionId, uint256 flowed, uint256 dogeAdded, uint256 scoreDelta);
    event Harvested(address indexed user, uint256 indexed positionId, uint256 dogeMinted);
    event PositionClosed(address indexed user, uint256 indexed positionId);
    event EmissionMultiplier(
        address indexed user, uint256 indexed positionId,
        uint256 commitmentBps, uint256 modeBps, uint256 globalBps, uint256 adaptiveBps, uint256 effectiveBps
    );
    event Flushed(uint256 toLiquidity, uint256 toTreasury);
    event AutoFlushSeedFailed(bytes reason);
    event ParamUpdated(bytes32 indexed key, uint256 value);
    event SinkUpdated(bytes32 indexed key, address value);
    event PhasesReplaced();
    event CommitmentTiersReplaced();
    event HarvestModesReplaced();

    error CapReached();
    error TooManyPositions();
    error ZeroAmount();
    error BadConfig();
    error BadMode();
    error NotOpen();
    error RewardsLocked(uint256 unlockAt);
    error NothingToHarvest();
    error BadPosition();

    constructor(
        address admin,
        address _pathUSD,
        address _doge,
        address _treasury,
        uint8   _pathUSDDecimals
    ) Ownable(admin) {
        pathUSD  = IERC20(_pathUSD);
        doge     = DOGE(_doge);
        treasury = _treasury;
        liquidityManager = _treasury;

        require(_pathUSDDecimals <= 30, "bad decimals");
        pathUSDUnit = 10 ** _pathUSDDecimals;

        perWalletCap = 10_000 * pathUSDUnit;
        autoFlushThreshold = 100 * pathUSDUnit; // 100 pathUSD default

        phases.push(Phase({supplyThreshold:  10_000_000 ether, ratePerPathUSD: 200 ether}));
        phases.push(Phase({supplyThreshold:  70_000_000 ether, ratePerPathUSD: 100 ether}));
        phases.push(Phase({supplyThreshold: 150_000_000 ether, ratePerPathUSD:  40 ether}));
        phases.push(Phase({supplyThreshold: 210_000_000 ether, ratePerPathUSD:  10 ether}));

        commitmentTiers.push(CommitmentTier({minDeposit:      0,                 multiplierBps: 10_000}));
        commitmentTiers.push(CommitmentTier({minDeposit:   100 * pathUSDUnit,    multiplierBps: 11_000}));
        commitmentTiers.push(CommitmentTier({minDeposit:  1_000 * pathUSDUnit,   multiplierBps: 12_500}));
        commitmentTiers.push(CommitmentTier({minDeposit:  5_000 * pathUSDUnit,   multiplierBps: 15_000}));

        harvestModes.push(HarvestMode({lockSeconds:        0, multiplierBps: 10_000})); // INSTANT
        harvestModes.push(HarvestMode({lockSeconds:  30 days, multiplierBps: 12_000})); // MONTHLY
        harvestModes.push(HarvestMode({lockSeconds: 180 days, multiplierBps: 15_000})); // LONG_TERM
    }

    // ============================================================
    //                        USER ACTIONS
    // ============================================================

    /// @notice Open a new mining position with the chosen Harvest Mode.
    /// @return positionId Index of the created position in the user's list.
    function commit(uint256 amount, uint8 mode)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 positionId)
    {
        if (amount == 0) revert ZeroAmount();
        if (mode >= harvestModes.length) revert BadMode();

        // Accrue every open position first (keeps their state current).
        Position[] storage arr = _positions[msg.sender];
        uint256 openCount;
        uint256 sumOpen;
        for (uint256 i = 0; i < arr.length; i++) {
            if (!arr[i].open) continue;
            _accruePosition(msg.sender, i);
            if (arr[i].open) { // may have closed during accrue? no, accrue doesn't close.
                openCount++;
                sumOpen += arr[i].totalDeposited;
            }
        }
        if (openCount >= maxPositionsPerWallet) revert TooManyPositions();
        if (sumOpen + amount > perWalletCap) revert CapReached();

        pathUSD.safeTransferFrom(msg.sender, address(this), amount);

        uint64 unlockAt = uint64(block.timestamp) + harvestModes[mode].lockSeconds;
        arr.push(Position({
            remaining: amount,
            totalDeposited: amount,
            lastUpdate: uint64(block.timestamp),
            unlockAt: unlockAt,
            mode: mode,
            open: true,
            pendingDoge: 0
        }));
        positionId = arr.length - 1;

        emit Committed(msg.sender, positionId, amount, mode, unlockAt);
        _maybeAutoFlush();
    }

    /// @notice Alias for tools expecting `deposit(amount)`. Defaults to INSTANT mode.
    function deposit(uint256 amount) external returns (uint256) {
        return _commitInternal(msg.sender, amount, 0);
    }

    function _commitInternal(address user, uint256 amount, uint8 mode) internal returns (uint256) {
        // Re-enter `commit` via self-call would need nonReentrant bypass, so
        // just inline a minimal version. Public callers use `commit`.
        if (amount == 0) revert ZeroAmount();
        if (mode >= harvestModes.length) revert BadMode();

        Position[] storage arr = _positions[user];
        uint256 openCount;
        uint256 sumOpen;
        for (uint256 i = 0; i < arr.length; i++) {
            if (!arr[i].open) continue;
            _accruePosition(user, i);
            openCount++;
            sumOpen += arr[i].totalDeposited;
        }
        if (openCount >= maxPositionsPerWallet) revert TooManyPositions();
        if (sumOpen + amount > perWalletCap) revert CapReached();

        pathUSD.safeTransferFrom(user, address(this), amount);

        uint64 unlockAt = uint64(block.timestamp) + harvestModes[mode].lockSeconds;
        arr.push(Position({
            remaining: amount,
            totalDeposited: amount,
            lastUpdate: uint64(block.timestamp),
            unlockAt: unlockAt,
            mode: mode,
            open: true,
            pendingDoge: 0
        }));
        uint256 positionId = arr.length - 1;
        emit Committed(user, positionId, amount, mode, unlockAt);
        _maybeAutoFlush();
        return positionId;
    }

    /// @notice Claim a single position's rewards. Closes it if fully converted.
    function harvest(uint256 positionId) public nonReentrant whenNotPaused {
        Position[] storage arr = _positions[msg.sender];
        if (positionId >= arr.length) revert BadPosition();
        Position storage p = arr[positionId];
        if (!p.open) revert NotOpen();

        _accruePosition(msg.sender, positionId);
        if (block.timestamp < p.unlockAt) revert RewardsLocked(p.unlockAt);

        uint256 amt = p.pendingDoge;
        if (amt == 0) revert NothingToHarvest();
        p.pendingDoge = 0;
        doge.mint(msg.sender, amt);
        emit Harvested(msg.sender, positionId, amt);

        if (p.remaining == 0) {
            p.open = false;
            emit PositionClosed(msg.sender, positionId);
        }
        _maybeAutoFlush();
    }

    /// @notice Claim every unlocked position's rewards in one tx.
    function harvestAll() external nonReentrant whenNotPaused {
        Position[] storage arr = _positions[msg.sender];
        uint256 total;
        for (uint256 i = 0; i < arr.length; i++) {
            Position storage p = arr[i];
            if (!p.open) continue;
            _accruePosition(msg.sender, i);
            if (block.timestamp < p.unlockAt) continue; // skip still-locked
            uint256 amt = p.pendingDoge;
            if (amt == 0) {
                // auto-close if fully converted and nothing to claim (rare)
                if (p.remaining == 0) { p.open = false; emit PositionClosed(msg.sender, i); }
                continue;
            }
            p.pendingDoge = 0;
            total += amt;
            emit Harvested(msg.sender, i, amt);
            if (p.remaining == 0) { p.open = false; emit PositionClosed(msg.sender, i); }
        }
        if (total == 0) revert NothingToHarvest();
        doge.mint(msg.sender, total);
        _maybeAutoFlush();
    }

    // ============================================================
    //                         ACCRUAL
    // ============================================================

    function _accruePosition(address user, uint256 positionId) internal {
        Position storage p = _positions[user][positionId];
        if (!p.open) return;

        uint256 elapsed = block.timestamp - p.lastUpdate;
        if (elapsed == 0) return;

        uint256 scoreDelta = (p.totalDeposited * elapsed) / SECONDS_PER_DAY;
        if (scoreDelta > 0) minerScore[user] += scoreDelta;

        if (p.remaining == 0) {
            p.lastUpdate = uint64(block.timestamp);
            return;
        }

        uint256 flowed = (p.totalDeposited * flowRateBpsPerDay * elapsed) / (BPS * SECONDS_PER_DAY);
        if (flowed > p.remaining) flowed = p.remaining;

        p.remaining -= flowed;
        p.lastUpdate = uint64(block.timestamp);

        if (flowed == 0) {
            if (scoreDelta > 0) emit Accrued(user, positionId, 0, 0, scoreDelta);
            return;
        }

        uint256 toLiq  = (flowed * liquidityBps) / BPS;
        uint256 toTrez = flowed - toLiq;
        pendingLiquidity += toLiq;
        pendingTreasury  += toTrez;
        totalFlowed      += flowed;

        (uint256 dogeOut, uint256 effBps, uint256 commBps, uint256 modeBps, uint256 adaBps)
            = _computeEmission(flowed, p.totalDeposited, p.mode);

        if (dogeOut > 0) p.pendingDoge += dogeOut;

        emit EmissionMultiplier(user, positionId, commBps, modeBps, globalMultiplier, adaBps, effBps);
        emit Accrued(user, positionId, flowed, dogeOut, scoreDelta);
    }

    function _computeEmission(uint256 flowed, uint256 depositSize, uint8 mode)
        internal view
        returns (uint256 dogeOut, uint256 effectiveBps, uint256 commBps, uint256 modeBps, uint256 adaptiveBps)
    {
        uint256 supply = doge.totalSupply();
        uint256 remainingFlow = flowed;

        commBps     = _commitmentMultiplierFor(depositSize);
        modeBps     = mode < harvestModes.length ? harvestModes[mode].multiplierBps : BPS;
        adaptiveBps = _adaptiveMultiplier();

        uint256 multBps = (commBps * globalMultiplier) / BPS;
        multBps = (multBps * modeBps) / BPS;
        multBps = (multBps * adaptiveBps) / BPS;
        if (multBps < minEffectiveMultBps) multBps = minEffectiveMultBps;
        if (multBps > maxEffectiveMultBps) multBps = maxEffectiveMultBps;
        effectiveBps = multBps;

        uint256 len = phases.length;
        for (uint256 i = 0; i < len && remainingFlow > 0; i++) {
            Phase memory ph = phases[i];
            if (supply >= ph.supplyThreshold) continue;
            uint256 baseDoge  = (remainingFlow * ph.ratePerPathUSD) / pathUSDUnit;
            uint256 phaseDoge = (baseDoge * multBps) / BPS;
            uint256 headroom  = ph.supplyThreshold - supply;
            if (phaseDoge <= headroom) {
                dogeOut += phaseDoge;
                supply  += phaseDoge;
                remainingFlow = 0;
            } else {
                dogeOut += headroom;
                uint256 flowUsed = (headroom * pathUSDUnit * BPS) / (ph.ratePerPathUSD * multBps);
                if (flowUsed > remainingFlow) flowUsed = remainingFlow;
                remainingFlow -= flowUsed;
                supply = ph.supplyThreshold;
            }
        }
        if (remainingFlow > 0 && postCapRatePerPathUSD > 0) {
            uint256 cap = doge.currentCap();
            if (supply < cap) {
                uint256 baseDoge  = (remainingFlow * postCapRatePerPathUSD) / pathUSDUnit;
                uint256 phaseDoge = (baseDoge * multBps) / BPS;
                uint256 headroom  = cap - supply;
                if (phaseDoge > headroom) phaseDoge = headroom;
                dogeOut += phaseDoge;
            }
        }
    }

    function _commitmentMultiplierFor(uint256 size) internal view returns (uint256 bps) {
        bps = 10_000;
        uint256 len = commitmentTiers.length;
        for (uint256 i = 0; i < len; i++) {
            if (size >= commitmentTiers[i].minDeposit) bps = commitmentTiers[i].multiplierBps;
            else break;
        }
    }

    function _adaptiveMultiplier() internal view returns (uint256) {
        if (!adaptiveEnabled || referenceTdogePrice == 0) return BPS;
        uint256 rate = _currentPhaseRate();
        if (rate == 0) return BPS;
        uint256 valueOut = (rate * referenceTdogePrice) / 1e18;
        if (valueOut == 0) return adaptiveMaxBps;
        uint256 mult = (targetValueBps * 1e18) / valueOut;
        if (mult < adaptiveMinBps) return adaptiveMinBps;
        if (mult > adaptiveMaxBps) return adaptiveMaxBps;
        return mult;
    }

    function _currentPhaseRate() internal view returns (uint256) {
        uint256 supply = doge.totalSupply();
        uint256 len = phases.length;
        for (uint256 i = 0; i < len; i++) {
            if (supply < phases[i].supplyThreshold) return phases[i].ratePerPathUSD;
        }
        return postCapRatePerPathUSD;
    }

    // ============================================================
    //                           VIEWS
    // ============================================================

    function getPositions(address user) external view returns (Position[] memory) {
        return _positions[user];
    }

    function positionCount(address user) external view returns (uint256) {
        return _positions[user].length;
    }

    function getPosition(address user, uint256 positionId) external view returns (Position memory) {
        if (positionId >= _positions[user].length) revert BadPosition();
        return _positions[user][positionId];
    }

    /// @notice Per-position preview: flow-since-lastUpdate, total pending DOGE
    ///         (already-accrued + just-accrued preview), and seconds-until-unlock.
    function pending(address user, uint256 positionId)
        external view
        returns (uint256 flowPreview, uint256 dogePreview, uint256 secondsUntilUnlock)
    {
        Position memory p = _positions[user][positionId];
        dogePreview = p.pendingDoge;
        if (p.open && p.remaining > 0 && p.lastUpdate != 0) {
            uint256 elapsed = block.timestamp - p.lastUpdate;
            uint256 flowed = (p.totalDeposited * flowRateBpsPerDay * elapsed) / (BPS * SECONDS_PER_DAY);
            if (flowed > p.remaining) flowed = p.remaining;
            flowPreview = flowed;
            (uint256 add, , , , ) = _computeEmission(flowed, p.totalDeposited, p.mode);
            dogePreview += add;
        }
        if (p.unlockAt > block.timestamp) secondsUntilUnlock = p.unlockAt - block.timestamp;
    }

    /// @notice Aggregate preview across all open positions.
    function pendingAll(address user)
        external view
        returns (uint256 openCount, uint256 totalCommitted, uint256 totalPending)
    {
        Position[] storage arr = _positions[user];
        for (uint256 i = 0; i < arr.length; i++) {
            Position storage p = arr[i];
            if (!p.open) continue;
            openCount++;
            totalCommitted += p.totalDeposited;
            totalPending += p.pendingDoge;
            if (p.remaining > 0 && p.lastUpdate != 0) {
                uint256 elapsed = block.timestamp - p.lastUpdate;
                uint256 flowed = (p.totalDeposited * flowRateBpsPerDay * elapsed) / (BPS * SECONDS_PER_DAY);
                if (flowed > p.remaining) flowed = p.remaining;
                (uint256 add, , , , ) = _computeEmission(flowed, p.totalDeposited, p.mode);
                totalPending += add;
            }
        }
    }

    function currentPhase() external view returns (uint256 index, uint256 ratePerPathUSD) {
        uint256 supply = doge.totalSupply();
        uint256 len = phases.length;
        for (uint256 i = 0; i < len; i++) {
            if (supply < phases[i].supplyThreshold) return (i, phases[i].ratePerPathUSD);
        }
        return (len, 0);
    }

    function effectiveMultiplierBps(address user, uint256 positionId)
        external view
        returns (uint256 commitment, uint256 mode, uint256 global, uint256 adaptive, uint256 effective)
    {
        Position memory p = _positions[user][positionId];
        commitment = _commitmentMultiplierFor(p.totalDeposited);
        mode = p.mode < harvestModes.length ? harvestModes[p.mode].multiplierBps : BPS;
        global = globalMultiplier;
        adaptive = _adaptiveMultiplier();
        effective = (commitment * global) / BPS;
        effective = (effective * mode) / BPS;
        effective = (effective * adaptive) / BPS;
        if (effective < minEffectiveMultBps) effective = minEffectiveMultBps;
        if (effective > maxEffectiveMultBps) effective = maxEffectiveMultBps;
    }

    function phasesLength()          external view returns (uint256) { return phases.length; }
    function commitmentTiersLength() external view returns (uint256) { return commitmentTiers.length; }
    function harvestModesLength()    external view returns (uint256) { return harvestModes.length; }

    // ============================================================
    //                           FLUSH
    // ============================================================

    function flush() external nonReentrant {
        uint256 lq = pendingLiquidity;
        uint256 tz = pendingTreasury;
        uint256 sentLq;
        uint256 sentTz;
        if (lq > 0 && liquidityManager != address(0)) {
            pendingLiquidity = 0;
            pathUSD.safeTransfer(liquidityManager, lq);
            sentLq = lq;
        }
        if (tz > 0 && treasury != address(0)) {
            pendingTreasury = 0;
            pathUSD.safeTransfer(treasury, tz);
            sentTz = tz;
        }
        emit Flushed(sentLq, sentTz);
    }

    /// @dev Internal auto-flush triggered at the end of user-facing writes.
    ///      Wrapped so a `seedLiquidity` failure (e.g. budget exhausted) never
    ///      bricks a user's mine/harvest. Skips silently if the conditions
    ///      aren't met or auto-flush is paused.
    function _maybeAutoFlush() internal {
        if (!autoFlushEnabled) return;
        uint256 lq = pendingLiquidity;
        if (lq == 0) return;

        bool meetsThreshold  = lq >= autoFlushThreshold;
        bool intervalElapsed = block.timestamp >= uint256(lastAutoFlushAt) + autoFlushIntervalSec;
        if (!meetsThreshold && !intervalElapsed) return;

        address lm = liquidityManager;
        address tz = treasury;
        uint256 sentLq;
        uint256 sentTz;

        if (lm != address(0)) {
            pendingLiquidity = 0;
            pathUSD.safeTransfer(lm, lq);
            sentLq = lq;
        }
        uint256 t = pendingTreasury;
        if (t > 0 && tz != address(0)) {
            pendingTreasury = 0;
            pathUSD.safeTransfer(tz, t);
            sentTz = t;
        }
        lastAutoFlushAt = uint64(block.timestamp);
        emit Flushed(sentLq, sentTz);

        if (sentLq > 0 && lm != address(0)) {
            try ILiquidityManagerSeed(lm).seedLiquidity() returns (uint256) {
                // success — pool grew
            } catch (bytes memory reason) {
                // Don't revert the user's tx; surface for off-chain alerting.
                emit AutoFlushSeedFailed(reason);
            }
        }
    }

    // ============================================================
    //                           ADMIN
    // ============================================================

    function setAutoFlushEnabled(bool v) external onlyOwner {
        autoFlushEnabled = v;
        emit ParamUpdated("autoFlushEnabled", v ? 1 : 0);
    }
    function setAutoFlushThreshold(uint256 v) external onlyOwner {
        autoFlushThreshold = v;
        emit ParamUpdated("autoFlushThreshold", v);
    }
    function setAutoFlushIntervalSec(uint256 v) external onlyOwner {
        autoFlushIntervalSec = v;
        emit ParamUpdated("autoFlushIntervalSec", v);
    }

    function setGlobalMultiplier(uint256 v) external onlyOwner { globalMultiplier = v; emit ParamUpdated("globalMultiplier", v); }
    function setPostCapRate(uint256 v)      external onlyOwner { postCapRatePerPathUSD = v; emit ParamUpdated("postCapRatePerPathUSD", v); }
    function setFlowRateBpsPerDay(uint256 v) external onlyOwner { flowRateBpsPerDay = v; emit ParamUpdated("flowRateBpsPerDay", v); }
    function setPerWalletCap(uint256 v)     external onlyOwner { perWalletCap = v; emit ParamUpdated("perWalletCap", v); }
    function setMaxPositionsPerWallet(uint256 v) external onlyOwner {
        if (v == 0) revert BadConfig();
        maxPositionsPerWallet = v;
        emit ParamUpdated("maxPositionsPerWallet", v);
    }

    function setEffectiveMultBand(uint256 minBps, uint256 maxBps) external onlyOwner {
        if (minBps == 0 || minBps > maxBps) revert BadConfig();
        minEffectiveMultBps = minBps;
        maxEffectiveMultBps = maxBps;
        emit ParamUpdated("minEffectiveMultBps", minBps);
        emit ParamUpdated("maxEffectiveMultBps", maxBps);
    }

    function setAdaptiveEnabled(bool v) external onlyOwner {
        adaptiveEnabled = v;
        emit ParamUpdated("adaptiveEnabled", v ? 1 : 0);
    }
    function setReferenceTdogePrice(uint256 v) external onlyOwner {
        referenceTdogePrice = v;
        emit ParamUpdated("referenceTdogePrice", v);
    }
    function setAdaptiveBounds(uint256 targetBps, uint256 minBps, uint256 maxBps) external onlyOwner {
        if (minBps == 0 || minBps > maxBps || targetBps == 0) revert BadConfig();
        targetValueBps = targetBps;
        adaptiveMinBps = minBps;
        adaptiveMaxBps = maxBps;
        emit ParamUpdated("targetValueBps", targetBps);
        emit ParamUpdated("adaptiveMinBps", minBps);
        emit ParamUpdated("adaptiveMaxBps", maxBps);
    }

    function setSplit(uint256 liqBps, uint256 trezBps) external onlyOwner {
        if (liqBps + trezBps != BPS) revert BadConfig();
        liquidityBps = liqBps;
        treasuryBps  = trezBps;
        emit ParamUpdated("liquidityBps", liqBps);
        emit ParamUpdated("treasuryBps", trezBps);
    }

    function setLiquidityManager(address v) external onlyOwner {
        if (v == address(0)) revert BadConfig();
        liquidityManager = v;
        emit SinkUpdated("liquidityManager", v);
    }
    function setTreasury(address v) external onlyOwner {
        if (v == address(0)) revert BadConfig();
        treasury = v;
        emit SinkUpdated("treasury", v);
    }

    function setPhases(Phase[] calldata ph) external onlyOwner {
        if (ph.length == 0) revert BadConfig();
        delete phases;
        for (uint256 i = 0; i < ph.length; i++) {
            if (ph[i].supplyThreshold > doge.INITIAL_CAP()) revert BadConfig();
            if (i > 0 && ph[i].supplyThreshold <= ph[i-1].supplyThreshold) revert BadConfig();
            phases.push(ph[i]);
        }
        emit PhasesReplaced();
    }

    function setCommitmentTiers(CommitmentTier[] calldata tiers) external onlyOwner {
        if (tiers.length == 0) revert BadConfig();
        delete commitmentTiers;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (i > 0 && tiers[i].minDeposit <= tiers[i-1].minDeposit) revert BadConfig();
            commitmentTiers.push(tiers[i]);
        }
        emit CommitmentTiersReplaced();
    }

    function setHarvestModes(HarvestMode[] calldata modes) external onlyOwner {
        if (modes.length == 0) revert BadConfig();
        delete harvestModes;
        for (uint256 i = 0; i < modes.length; i++) {
            harvestModes.push(modes[i]);
        }
        emit HarvestModesReplaced();
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function adminWithdrawPathUSD(address to, uint256 amount) external onlyOwner {
        pathUSD.safeTransfer(to, amount);
    }
}
