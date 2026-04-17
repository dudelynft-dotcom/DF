// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title cDOGE — Community Doge
/// @notice Plain ERC-20 with a fixed supply. No fee-on-transfer, no
///         inflation, no governance. The entire supply is minted to
///         the deployer on construction; distribution (airdrops, LP
///         seeding) is handled off-chain via admin transfers.
///
///         Testnet-first: exists so the community has something to
///         trade + LP before any mainnet decision is made. If cDOGE
///         ships on mainnet, a new deployment with proper governance
///         replaces this contract entirely.
contract CDOGE is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 100_000_000 ether; // 100M, 18 decimals

    constructor(address admin) ERC20("Community Doge", "cDOGE") Ownable(admin) {
        _mint(admin, TOTAL_SUPPLY);
    }
}
