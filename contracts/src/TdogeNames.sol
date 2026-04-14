// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMinerPositionCheck {
    function positionCount(address user) external view returns (uint256);
}

/// @title TdogeNames — on-chain .fdoge identity registry
/// @notice A flat registry (not an NFT). Any user who has ever committed
///         USDC to Miner is eligible to claim a unique `<name>.fdoge`
///         identity for a small USDC fee. 100% of the fee is routed
///         directly to the LiquidityManager to deepen fDOGE liquidity.
///
///         This contract has no hooks into Miner emission or multipliers.
///         It is identity and status only. Future phases (PFP collection,
///         priority access) can read `nameOf(address)` off this registry.
contract TdogeNames is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 5000;
    uint8   public constant NAME_MIN_LEN = 1;
    uint8   public constant NAME_MAX_LEN = 20;
    string  public constant NAME_SUFFIX = ".fdoge";

    IERC20  public immutable pathUSD;
    IMinerPositionCheck public immutable miner;

    /// @notice Destination for claim fees. Typically the LiquidityManager.
    address public liquiditySink;

    uint256 public totalClaimed;
    uint256 public claimCost;   // in pathUSD wei
    bool    public claimOpen;

    mapping(bytes32 => address) public ownerOfName; // keccak(name) -> owner
    mapping(address => string)  private _nameOf;    // owner -> bare name (no suffix)

    event Claimed(address indexed user, string name, uint256 cost);
    event ParamUpdated(bytes32 indexed key, uint256 value);
    event SinkUpdated(address sink);
    event ClaimOpenChanged(bool open);

    error NotEligible();
    error ClaimClosed();
    error AlreadyHolder();
    error SupplyCapReached();
    error NameTaken();
    error InvalidName();
    error ZeroAddress();

    constructor(
        address admin,
        address _pathUSD,
        address _miner,
        address _liquiditySink,
        uint256 _claimCost
    ) Ownable(admin) {
        if (_pathUSD == address(0) || _miner == address(0) || _liquiditySink == address(0)) revert ZeroAddress();
        pathUSD = IERC20(_pathUSD);
        miner = IMinerPositionCheck(_miner);
        liquiditySink = _liquiditySink;
        claimCost = _claimCost;
    }

    // ---------- claim ----------

    function claim(string calldata name) external nonReentrant {
        if (!claimOpen)                        revert ClaimClosed();
        if (bytes(_nameOf[msg.sender]).length > 0) revert AlreadyHolder();
        if (totalClaimed >= MAX_SUPPLY)        revert SupplyCapReached();
        if (miner.positionCount(msg.sender) == 0) revert NotEligible();
        if (!_validName(name))                 revert InvalidName();

        bytes32 key = keccak256(bytes(name));
        if (ownerOfName[key] != address(0)) revert NameTaken();

        // Route the fee directly to liquidity. Caller must have approved `claimCost`.
        if (claimCost > 0) {
            pathUSD.safeTransferFrom(msg.sender, liquiditySink, claimCost);
        }

        unchecked { totalClaimed += 1; }
        ownerOfName[key] = msg.sender;
        _nameOf[msg.sender] = name;

        emit Claimed(msg.sender, name, claimCost);
    }

    // ---------- views ----------

    function nameOf(address user) external view returns (string memory) {
        return _nameOf[user];
    }

    function displayNameOf(address user) external view returns (string memory) {
        bytes memory b = bytes(_nameOf[user]);
        if (b.length == 0) return "";
        return string.concat(_nameOf[user], NAME_SUFFIX);
    }

    function resolveName(string calldata name) external view returns (address owner) {
        owner = ownerOfName[keccak256(bytes(name))];
    }

    function isNameAvailable(string calldata name) external view returns (bool) {
        return _validName(name) && ownerOfName[keccak256(bytes(name))] == address(0);
    }

    function isEligible(address user) external view returns (bool) {
        return miner.positionCount(user) > 0;
    }

    function remaining() external view returns (uint256) {
        return MAX_SUPPLY - totalClaimed;
    }

    // ---------- admin ----------

    function setLiquiditySink(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        liquiditySink = s;
        emit SinkUpdated(s);
    }

    function setClaimCost(uint256 c) external onlyOwner {
        claimCost = c;
        emit ParamUpdated("claimCost", c);
    }

    function setClaimOpen(bool v) external onlyOwner {
        claimOpen = v;
        emit ClaimOpenChanged(v);
    }

    // ---------- internal ----------

    function _validName(string memory name) internal pure returns (bool) {
        bytes memory b = bytes(name);
        if (b.length < NAME_MIN_LEN || b.length > NAME_MAX_LEN) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool lo  = (c >= 0x61 && c <= 0x7a); // a-z
            bool dig = (c >= 0x30 && c <= 0x39); // 0-9
            bool hyp = (c == 0x2d);              // -
            if (!(lo || dig || hyp)) return false;
            if (hyp && (i == 0 || i == b.length - 1)) return false;
        }
        return true;
    }
}
