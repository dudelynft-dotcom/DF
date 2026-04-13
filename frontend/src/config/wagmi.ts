import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { tempo, tempoMainnet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [tempo, tempoMainnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [tempo.id]:        http(tempo.rpcUrls.default.http[0]),
    [tempoMainnet.id]: http(tempoMainnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});
