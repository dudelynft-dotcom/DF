import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { arc } from "./chain";

// Same trio of connectors as the main app so users see a consistent
// wallet picker. WalletConnect only mounts when a project id is set.
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const appMeta = {
  name: "DOGE FORGE Community",
  description: "Earn Season 1 points on Arc",
  url: typeof window !== "undefined" ? window.location.origin : "https://community.dogeforge.fun",
  icons: [] as string[],
};

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
  transports: { [arc.id]: http(arc.rpcUrls.default.http[0]) },
  ssr: true,
});
