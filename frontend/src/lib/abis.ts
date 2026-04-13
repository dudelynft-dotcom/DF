export const minerAbi = [
  { type: "function", name: "commit",   stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }, { name: "mode", type: "uint8" }],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  { type: "function", name: "deposit",  stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "harvest",  stateMutability: "nonpayable", inputs: [{ name: "positionId", type: "uint256" }], outputs: [] },
  { type: "function", name: "harvestAll", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "flush",    stateMutability: "nonpayable", inputs: [], outputs: [] },

  {
    type: "function", name: "getPositions", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{
      name: "", type: "tuple[]",
      components: [
        { name: "remaining",      type: "uint256" },
        { name: "totalDeposited", type: "uint256" },
        { name: "lastUpdate",     type: "uint64"  },
        { name: "unlockAt",       type: "uint64"  },
        { name: "mode",           type: "uint8"   },
        { name: "open",           type: "bool"    },
        { name: "pendingDoge",    type: "uint256" },
      ],
    }],
  },
  {
    type: "function", name: "pending", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "positionId", type: "uint256" }],
    outputs: [
      { name: "flowPreview",        type: "uint256" },
      { name: "dogePreview",        type: "uint256" },
      { name: "secondsUntilUnlock", type: "uint256" },
    ],
  },
  {
    type: "function", name: "pendingAll", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "openCount",      type: "uint256" },
      { name: "totalCommitted", type: "uint256" },
      { name: "totalPending",   type: "uint256" },
    ],
  },
  {
    type: "function", name: "harvestModes", stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "lockSeconds",   type: "uint32"  },
      { name: "multiplierBps", type: "uint256" },
    ],
  },

  { type: "function", name: "flowRateBpsPerDay",    stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "perWalletCap",         stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxPositionsPerWallet",stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalFlowed",          stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minerScore",           stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },

  {
    type: "function", name: "currentPhase", stateMutability: "view", inputs: [],
    outputs: [
      { name: "index", type: "uint256" },
      { name: "ratePerPathUSD", type: "uint256" },
    ],
  },
  {
    type: "function", name: "effectiveMultiplierBps", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "positionId", type: "uint256" }],
    outputs: [
      { name: "commitment", type: "uint256" },
      { name: "mode",       type: "uint256" },
      { name: "global",     type: "uint256" },
      { name: "adaptive",   type: "uint256" },
      { name: "effective",  type: "uint256" },
    ],
  },
  {
    type: "event", name: "Committed",
    inputs: [
      { name: "user",        type: "address", indexed: true  },
      { name: "positionId",  type: "uint256", indexed: true  },
      { name: "amount",      type: "uint256", indexed: false },
      { name: "mode",        type: "uint8",   indexed: false },
      { name: "unlockAt",    type: "uint64",  indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "balanceOf",  stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance",  stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve",    stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalSupply",stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals",   stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol",     stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
