import { defineChain } from "viem";

/// Pharos Atlantic testnet. Vanilla EVM, native gas is PHRS.
/// Wallets need a small PHRS balance to transact — faucet:
/// https://testnet.pharosnetwork.xyz/
export const pharos = defineChain({
  id: Number(process.env.NEXT_PUBLIC_PHAROS_CHAIN_ID ?? 688689),
  name: "Pharos Testnet",
  testnet: true,
  nativeCurrency: {
    name: "Pharos",
    symbol: "PHRS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Pharos Explorer",
      url: process.env.NEXT_PUBLIC_PHAROS_EXPLORER_URL ?? "https://atlantic.pharosscan.xyz",
    },
  },
  contracts: {
    multicall3: {
      // Canonical Multicall3, pre-deployed on Pharos Atlantic.
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

const USDC_DEFAULT = "0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B" as const;
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

  // Backwards-compat shims — existing components still reference these names.
  // `pathUSD` now aliases Pharos USDC. `stablecoinDex` is a zero-address
  // placeholder; the Tempo-precompile route is being removed from TradeModal.
  pathUSD:          usdcAddr,
  stablecoinDex:    ZERO_ADDR as `0x${string}`,
};

/// USDC on Pharos uses 6 decimals (verified on-chain). fDOGE is the standard 18.
export const USDC_DECIMALS = 6;
export const DOGE_DECIMALS = 18;

// Compat aliases — removed in a follow-up cleanup pass.
export const PATHUSD_DECIMALS = USDC_DECIMALS;
export const STABLECOIN_DEX_PRICE_SCALE = 100_000;
export const tempo = pharos;
