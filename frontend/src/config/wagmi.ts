import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { arc } from "./chain";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appMeta = {
  name: "DOGE FORGE",
  description: "Mine fDOGE on Arc",
  url: typeof window !== "undefined" ? window.location.origin : "https://dogeforge.fun",
  icons: [] as string[],
};

// Build connector list:
//  - EIP-6963 injected discovery (MetaMask, Rabby, any browser extension)
//  - WalletConnect v2 (QR / mobile deep-link). Only when projectId is set.
//  - Coinbase Wallet (native SDK; works on desktop + mobile)
const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: appMeta.name, appLogoUrl: "" }),
  ...(wcProjectId
    ? [walletConnect({ projectId: wcProjectId, metadata: appMeta, showQrModal: true })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [arc],
  connectors,
  transports: {
    [arc.id]: http(arc.rpcUrls.default.http[0]),
  },
  ssr: true,
});
