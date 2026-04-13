import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { tempo, tempoMainnet } from "./chain";

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appMeta = {
  name: "DOGE FORGE",
  description: "Mine TDOGE on Tempo",
  url: typeof window !== "undefined" ? window.location.origin : "https://dogeforge.vercel.app",
  icons: [] as string[],
};

// Build connector list:
//  - EIP-6963 injected discovery (MetaMask, Rabby, Gemini, any browser extension)
//  - WalletConnect v2 (QR / mobile deep-link). Only when projectId is set.
//  - Coinbase Wallet (native SDK; works on desktop + mobile)
// The WalletModal lists all of these and dedupes by name so users can pick.
const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: appMeta.name, appLogoUrl: "" }),
  ...(wcProjectId
    ? [walletConnect({ projectId: wcProjectId, metadata: appMeta, showQrModal: true })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [tempo, tempoMainnet],
  connectors,
  transports: {
    [tempo.id]:        http(tempo.rpcUrls.default.http[0]),
    [tempoMainnet.id]: http(tempoMainnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
