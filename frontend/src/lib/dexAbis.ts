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

/// DOGE FORGE Factory — registry/deployer of TdogePair instances.
export const forgeFactoryAbi = [
  {
    type: "function", name: "getPair", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function", name: "allPairsLength", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
] as const;

/// DOGE FORGE Router — multi-pair router with built-in platform fee skim
/// and path-based swaps. Replaces the earlier TdogeRouter + ForgeAggregator
/// stack once deployed.
export const forgeRouterAbi = [
  {
    type: "function", name: "platformFeeBps", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint16" }],
  },
  {
    type: "function", name: "feeEnabled", stateMutability: "view",
    inputs: [], outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "getAmountsOut", stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path",     type: "address[]" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function", name: "getAmountsOutAfterFee", stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path",     type: "address[]" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function", name: "addLiquidity", stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA",         type: "address" },
      { name: "tokenB",         type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin",     type: "uint256" },
      { name: "amountBMin",     type: "uint256" },
      { name: "to",             type: "address" },
      { name: "deadline",       type: "uint256" },
    ],
    outputs: [
      { name: "amountA",   type: "uint256" },
      { name: "amountB",   type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
  },
  {
    type: "function", name: "removeLiquidity", stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA",      type: "address" },
      { name: "tokenB",      type: "address" },
      { name: "liquidity",   type: "uint256" },
      { name: "amountAMin",  type: "uint256" },
      { name: "amountBMin",  type: "uint256" },
      { name: "to",          type: "address" },
      { name: "deadline",    type: "uint256" },
    ],
    outputs: [
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
    ],
  },
] as const;

/// UnitFlow V2.5 — legacy ABI retained for compat while we migrate. Safe to
/// remove once every caller has switched to forgeRouterAbi.
export const unitflowFactoryAbi = [
  {
    type: "function", name: "getPair", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function", name: "allPairsLength", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
] as const;

export const unitflowRouterAbi = [
  {
    type: "function", name: "getAmountsOut", stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path",     type: "address[]" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
] as const;

/// DOGE FORGE's own aggregator — takes a platform fee in the input token,
/// forwards the rest to the underlying UniV2 router. Interface is nearly
/// identical to UnitFlow's, plus `getAmountsOutAfterFee` for correct quotes.
export const aggregatorAbi = [
  {
    type: "function", name: "feeBps", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint16" }],
  },
  {
    type: "function", name: "getAmountsOutAfterFee", stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path",     type: "address[]" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function", name: "swapExactTokensForTokens", stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
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
