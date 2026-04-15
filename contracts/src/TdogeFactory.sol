// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TdogePair} from "./TdogePair.sol";

/// @title TdogeFactory — Uniswap V2-style pair registry & deployer
/// @notice Permissionless `createPair`. Admin-only `registerPair` exists so
///         we can bind the already-deployed fDOGE/USDC pair (address 0x96da…)
///         into the map on mainnet-day-one without redeploying Miner or LM.
contract TdogeFactory is Ownable {
    /// @notice token0 → token1 → pair (symmetric: both (A,B) and (B,A) point to same pair)
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairCount);
    event PairRegistered(address indexed token0, address indexed token1, address pair);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error NotAPair();

    constructor(address admin) Ownable(admin) {}

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Permissionless pair creation. Anyone can open a new market.
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        pair = address(new TdogePair(token0, token1));

        _register(token0, token1, pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    /// @notice Admin-only: bind a pre-existing pair contract into the map.
    ///         Used to absorb the historical fDOGE/USDC pair. The caller must
    ///         have verified that `pair` is a genuine TdogePair for (tokenA, tokenB).
    function registerPair(address tokenA, address tokenB, address pair) external onlyOwner {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0) || pair == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        // Sanity-check: pair.token0()/token1() must match. A bad register would
        // route user funds into a random contract, so fail loudly on mismatch.
        address p0 = address(TdogePair(pair).token0());
        address p1 = address(TdogePair(pair).token1());
        if (p0 != token0 || p1 != token1) revert NotAPair();

        _register(token0, token1, pair);
        emit PairRegistered(token0, token1, pair);
    }

    function _register(address token0, address token1, address pair) internal {
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
    }
}
