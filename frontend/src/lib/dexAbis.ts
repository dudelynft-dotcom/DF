/// ABIs for the DEX layer: our own UniV2-style TdogePair + TdogeRouter, plus
/// Tempo's enshrined IStablecoinDEX precompile for stable ↔ stable routing.

export const pairAbi = [
  { type: "function", name: "token0",     stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1",     stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalSupply",stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf",  stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getReserves", stateMutability: "view", inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

export const routerAbi = [
  { type: "function", name: "pair",   stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function", name: "getAmountOut", stateMutability: "pure",
    inputs: [
      { name: "amountIn",  type: "uint256" },
      { name: "reserveIn", type: "uint256" },
      { name: "reserveOut",type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "quote", stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "amountIn",type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function", name: "swapExactIn", stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn",      type: "address" },
      { name: "amountIn",     type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/// Subset of Tempo's enshrined IStablecoinDEX precompile that we actually use.
/// Full interface: https://github.com/tempoxyz/tempo-std/blob/main/src/interfaces/IStablecoinDEX.sol
export const stablecoinDexAbi = [
  { type: "function", name: "MIN_PRICE",   stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "MAX_PRICE",   stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "PRICE_SCALE", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "MIN_ORDER_AMOUNT", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function", name: "books", stateMutability: "view",
    inputs: [{ name: "pairKey", type: "bytes32" }],
    outputs: [
      { name: "base",         type: "address" },
      { name: "quote",        type: "address" },
      { name: "bestBidTick",  type: "int16" },
      { name: "bestAskTick",  type: "int16" },
    ],
  },
  {
    type: "function", name: "pairKey", stateMutability: "pure",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "key", type: "bytes32" }],
  },
  {
    type: "function", name: "quoteSwapExactAmountIn", stateMutability: "view",
    inputs: [
      { name: "tokenIn",  type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint128" },
    ],
    outputs: [{ name: "amountOut", type: "uint128" }],
  },
  {
    type: "function", name: "swapExactAmountIn", stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn",     type: "address" },
      { name: "tokenOut",    type: "address" },
      { name: "amountIn",    type: "uint128" },
      { name: "minAmountOut",type: "uint128" },
    ],
    outputs: [{ name: "amountOut", type: "uint128" }],
  },
  {
    type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint128" }],
    outputs: [],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }],
    outputs: [{ type: "uint128" }],
  },
] as const;
