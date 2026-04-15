import { defineChain } from "viem";

/// Arc Testnet. Fully EVM (Prague). Gas is paid in USDC — users only ever
/// need one token in their wallet. Faucet: https://faucet.circle.com
export const arc = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  testnet: true,
  nativeCurrency: {
    // Arc's gas unit is USDC. Wallets display it as such.
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app",
    },
  },
  contracts: {
    multicall3: {
      // Canonical Multicall3, pre-deployed on Arc.
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

const USDC_DEFAULT = "0x3600000000000000000000000000000000000000" as const;
const ZERO_ADDR    = "0x0000000000000000000000000000000000000000" as const;

const usdcAddr = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? USDC_DEFAULT) as `0x${string}`;

export const addresses = {
  usdc:             usdcAddr,
  doge:             process.env.NEXT_PUBLIC_DOGE_ADDRESS   as `0x${string}`,
  miner:            process.env.NEXT_PUBLIC_MINER_ADDRESS  as `0x${string}`,
  pair:             process.env.NEXT_PUBLIC_PAIR_ADDRESS   as `0x${string}`,
  liquidityManager: process.env.NEXT_PUBLIC_LM_ADDRESS     as `0x${string}`,
  router:           process.env.NEXT_PUBLIC_ROUTER_ADDRESS as `0x${string}`,
  names:            process.env.NEXT_PUBLIC_NAMES_ADDRESS  as `0x${string}`,

  // DOGE FORGE owned DEX — Factory deploys/registers pairs; ForgeRouter
  // handles addLiquidity + path-based swaps and skims the 0.10% platform fee
  // to the LiquidityManager.
  factory:      process.env.NEXT_PUBLIC_FACTORY_ADDRESS     as `0x${string}`,
  forgeRouter:  process.env.NEXT_PUBLIC_ROUTER_ADDRESS      as `0x${string}`,
  wusdc:       (process.env.NEXT_PUBLIC_WUSDC_ADDRESS
    ?? "0x911b4000D3422F482F4062a913885f7b035382Df")       as `0x${string}`,

  // Backwards-compat shims — existing components still reference these names.
  // `pathUSD` aliases Arc USDC. `stablecoinDex` is a zero-address placeholder
  // (Tempo-era precompile; not used on Arc).
  pathUSD:          usdcAddr,
  stablecoinDex:    ZERO_ADDR as `0x${string}`,
};

/// USDC on Arc Testnet uses 6 decimals (verified on-chain). fDOGE is 18.
export const USDC_DECIMALS = 6;
export const DOGE_DECIMALS = 18;

// Compat aliases — removed in a follow-up cleanup pass.
export const PATHUSD_DECIMALS = USDC_DECIMALS;
export const STABLECOIN_DEX_PRICE_SCALE = 100_000;
export const tempo  = arc;
export const pharos = arc;
