import { defineChain } from "viem";

// Arc Testnet. Mirrors frontend/src/config/chain.ts minimally — the
// community app only needs to let users connect a wallet, not read
// any contracts. When Step 4+ needs contract reads, we'll extend.
export const arc = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  testnet: true,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url:  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app",
    },
  },
});
