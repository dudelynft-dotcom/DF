export const namesAbi = [
  { type: "function", name: "claim",           stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }], outputs: [] },
  { type: "function", name: "claimOpen",       stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "claimCost",       stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalClaimed",    stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "remaining",       stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_SUPPLY",      stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isEligible",      stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isNameAvailable", stateMutability: "view", inputs: [{ type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "nameOf",          stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "string" }] },
  { type: "function", name: "displayNameOf",   stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "string" }] },
  { type: "function", name: "resolveName",     stateMutability: "view", inputs: [{ type: "string" }], outputs: [{ type: "address" }] },
  { type: "function", name: "liquiditySink",   stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event", name: "Claimed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "name", type: "string",  indexed: false },
      { name: "cost", type: "uint256", indexed: false },
    ],
  },
] as const;
