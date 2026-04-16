import { createConfig, http } from "wagmi";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, coinbaseWallet, rabbyWallet } from "@rainbow-me/rainbowkit/wallets";
import { arc } from "./chain";

// Wallet lineup — intentionally excludes WalletConnect so we don't
// have to pay for or expose a WC project id. The tradeoff is that
// mobile Safari/Chrome users who don't have a wallet extension (i.e.
// everyone NOT browsing inside MetaMask's or Coinbase's in-app
// browser) can't connect. We surface this in the UI.
//
// connectorsForWallets lets us cherry-pick exactly which wallets
// RainbowKit's modal shows. Omitting walletConnectWallet here means
// there's no "paired with QR" option visible, keeping the modal
// honest about what's actually supported.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, coinbaseWallet, rabbyWallet, injectedWallet],
    },
  ],
  {
    appName: "DOGE FORGE Community",
    // RainbowKit still requires a projectId field. Passing a placeholder
    // is fine as long as we don't include walletConnectWallet in the list.
    projectId: "DOGE_FORGE_NO_WC",
  },
);

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors,
  transports: { [arc.id]: http(arc.rpcUrls.default.http[0]) },
  ssr: true,
});
