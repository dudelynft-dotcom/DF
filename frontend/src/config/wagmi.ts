import { createConfig, createStorage, http } from "wagmi";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  rabbyWallet,
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { arc } from "./chain";

// Main-site wallet lineup, powered by RainbowKit. Unlike the community
// app we KEEP WalletConnect here — trading is the primary flow and we
// can't afford to lose mobile Safari/Chrome users. WC is free up to
// 100 MAW on the project ID we provision in Vercel env; add paid tier
// when we cross that.
//
// Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID at build time. RainbowKit
// still renders the rest of the wallets if the id is missing, but the
// WC deep-link stops working.
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const wallets = [
  {
    groupName: "Recommended",
    wallets: [
      metaMaskWallet,
      coinbaseWallet,
      rabbyWallet,
      walletConnectWallet,
      injectedWallet,
    ],
  },
];

const connectors = connectorsForWallets(wallets, {
  appName: "DOGE FORGE",
  projectId: wcProjectId || "DOGE_FORGE_NO_WC", // placeholder so RainbowKit doesn't throw
});

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors,
  transports: {
    [arc.id]: http(arc.rpcUrls.default.http[0]),
  },
  // Force localStorage persistence so wallet sessions survive page
  // refreshes. The default `ssr: true` uses cookie storage which
  // loses state without initialState wiring.
  storage: createStorage({ storage: typeof window !== "undefined" ? window.localStorage : undefined }),
});
