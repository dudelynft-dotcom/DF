import { defineChain } from "viem";

export const tempo = defineChain({
  id: Number(process.env.NEXT_PUBLIC_TEMPO_CHAIN_ID ?? 42431),
  name: "Tempo Testnet",
  testnet: true,
  nativeCurrency: {
    // Tempo has no native gas token. Fees are paid in TIP-20 stablecoins
    // via the Fee AMM. This block is only required for wallet compatibility
    // (EIP-3085 addEthereumChain). Real fees follow Tempo's stablecoin model.
    name: "Tempo",
    symbol: "TEMPO",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_TEMPO_RPC_URL ?? "https://rpc.testnet.tempo.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Tempo Explorer",
      url: process.env.NEXT_PUBLIC_TEMPO_EXPLORER_URL ?? "https://explore.testnet.tempo.xyz",
    },
  },
  contracts: {
    multicall3: {
      // Standard Multicall3, predeployed by Tempo at the canonical address.
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

/// Tempo mainnet is registered here so wagmi can correctly model the wallet's
/// state when a user is connected to mainnet. We do NOT deploy there in Phase C;
/// it exists purely so the auto-switch logic knows about both networks.
export const tempoMainnet = defineChain({
  id: 4217,
  name: "Tempo",
  nativeCurrency: { name: "Tempo", symbol: "TEMPO", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.tempo.xyz"] },
  },
  blockExplorers: {
    default: { name: "Tempo Explorer", url: "https://explore.tempo.xyz" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const addresses = {
  pathUSD:       process.env.NEXT_PUBLIC_PATHUSD_ADDRESS       as `0x${string}`,
  doge:          process.env.NEXT_PUBLIC_DOGE_ADDRESS          as `0x${string}`,
  miner:         process.env.NEXT_PUBLIC_MINER_ADDRESS         as `0x${string}`,
  pair:          process.env.NEXT_PUBLIC_PAIR_ADDRESS          as `0x${string}`,
  liquidityManager: process.env.NEXT_PUBLIC_LM_ADDRESS         as `0x${string}`,
  router:        process.env.NEXT_PUBLIC_ROUTER_ADDRESS        as `0x${string}`,
  stablecoinDex: (process.env.NEXT_PUBLIC_STABLECOIN_DEX_ADDRESS
    ?? "0xDEc0000000000000000000000000000000000000") as `0x${string}`,
  names:         process.env.NEXT_PUBLIC_NAMES_ADDRESS             as `0x${string}`,
};

/// Tempo's enshrined Stablecoin DEX is a precompile. Prices are expressed in
/// ticks with PRICE_SCALE = 1e5 and a ±2% band (ticks -2000..2000). Only
/// stable-to-stable swaps make sense through it; volatile pairs (e.g. TDOGE)
/// use our own `pair` + `router`.
export const STABLECOIN_DEX_PRICE_SCALE = 100_000;

/// Tempo's pathUSD TIP-20 uses 6 decimals. DOGE is the standard 18.
export const PATHUSD_DECIMALS = 6;
export const DOGE_DECIMALS    = 18;
