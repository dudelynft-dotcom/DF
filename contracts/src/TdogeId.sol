// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TdogeId — identity NFT for DOGE FORGE
/// @notice 1919 supply. Free mint. Whitelist-only. Each NFT binds a unique
///         lowercase-alphanumeric name displayed as `<name>.tdoge`. One mint
///         per wallet; transfers are allowed but the primary-name pointer
///         is cleared on transfer out.
///
///         This contract is an IDENTITY / BADGE layer only. It has no hooks
///         into Miner, LiquidityManager, or any yield mechanism. Holding an
///         ID does not affect mining rewards, multipliers, or fees.
contract TdogeId is ERC721, Ownable {
    uint256 public constant MAX_SUPPLY = 1919;
    uint8   public constant NAME_MIN_LEN = 1;
    uint8   public constant NAME_MAX_LEN = 20;
    string  public constant NAME_SUFFIX = ".tdoge";

    uint256 public totalMinted;
    bool    public mintOpen;
    string  public baseTokenURI;

    /// @notice Whitelist of addresses eligible to mint. Consumed on first mint.
    mapping(address => bool) public whitelisted;

    /// @dev tokenId -> name (without suffix)
    mapping(uint256 => string) private _names;
    /// @dev keccak256(name) -> tokenId (tokenIds start at 1; 0 means unused)
    mapping(bytes32 => uint256) public nameToTokenId;
    /// @dev owner -> their "primary" tokenId (0 = none). Shown as their display name.
    mapping(address => uint256) public primaryTokenOf;

    event Minted(uint256 indexed tokenId, address indexed to, string name);
    event WhitelistUpdated(address indexed user, bool allowed);
    event WhitelistBatch(uint256 count, bool allowed);
    event MintOpenChanged(bool open);
    event PrimaryNameSet(address indexed owner, uint256 indexed tokenId);
    event BaseURISet(string uri);

    error NotWhitelisted();
    error MintClosed();
    error SupplyCapReached();
    error NameTaken();
    error InvalidName();
    error AlreadyHolder();
    error NotOwner();

    constructor(address admin) ERC721("DOGE FORGE", "DFID") Ownable(admin) {}

    // ---------- user mint ----------

    function mint(string calldata name) external returns (uint256 tokenId) {
        if (!mintOpen)                   revert MintClosed();
        if (!whitelisted[msg.sender])    revert NotWhitelisted();
        if (balanceOf(msg.sender) > 0)   revert AlreadyHolder();
        if (totalMinted >= MAX_SUPPLY)   revert SupplyCapReached();
        if (!_validName(name))           revert InvalidName();

        bytes32 key = keccak256(bytes(name));
        if (nameToTokenId[key] != 0) revert NameTaken();

        unchecked { totalMinted += 1; }
        tokenId = totalMinted;

        _names[tokenId] = name;
        nameToTokenId[key] = tokenId;
        whitelisted[msg.sender] = false; // consumed
        primaryTokenOf[msg.sender] = tokenId;

        _safeMint(msg.sender, tokenId);
        emit Minted(tokenId, msg.sender, name);
        emit PrimaryNameSet(msg.sender, tokenId);
    }

    /// @notice Owner of a name NFT can set it as their displayed primary.
    function setPrimary(uint256 tokenId) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotOwner();
        primaryTokenOf[msg.sender] = tokenId;
        emit PrimaryNameSet(msg.sender, tokenId);
    }

    // ---------- views ----------

    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _names[tokenId];
    }

    function displayNameOf(uint256 tokenId) external view returns (string memory) {
        bytes memory n = bytes(_names[tokenId]);
        if (n.length == 0) return "";
        return string.concat(_names[tokenId], NAME_SUFFIX);
    }

    function primaryNameOf(address owner) external view returns (string memory) {
        uint256 t = primaryTokenOf[owner];
        if (t == 0) return "";
        return string.concat(_names[t], NAME_SUFFIX);
    }

    function resolveName(string calldata name) external view returns (uint256 tokenId, address owner) {
        tokenId = nameToTokenId[keccak256(bytes(name))];
        if (tokenId != 0) owner = _ownerOf(tokenId);
    }

    function isNameAvailable(string calldata name) external view returns (bool) {
        return _validName(name) && nameToTokenId[keccak256(bytes(name))] == 0;
    }

    function remaining() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    // ---------- admin ----------

    function setWhitelisted(address user, bool allowed) external onlyOwner {
        whitelisted[user] = allowed;
        emit WhitelistUpdated(user, allowed);
    }

    function setWhitelistBatch(address[] calldata users, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[users[i]] = allowed;
        }
        emit WhitelistBatch(users.length, allowed);
    }

    function setMintOpen(bool v) external onlyOwner {
        mintOpen = v;
        emit MintOpenChanged(v);
    }

    function setBaseTokenURI(string calldata u) external onlyOwner {
        baseTokenURI = u;
        emit BaseURISet(u);
    }

    // ---------- internal ----------

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    /// @dev Allowed: lowercase a-z, digits 0-9, hyphen. No leading/trailing hyphen.
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

    /// Clear the transferring-out owner's primary pointer if it matched this token.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address prev = super._update(to, tokenId, auth);
        if (prev != address(0) && primaryTokenOf[prev] == tokenId) {
            primaryTokenOf[prev] = 0;
            emit PrimaryNameSet(prev, 0);
        }
        return prev;
    }
}
