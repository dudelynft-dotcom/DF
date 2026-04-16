"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/config/wagmi";
import { useState } from "react";
import { Toaster } from "@/components/Toaster";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";

// Dark+gold RainbowKit theme to match the DOGE FORGE brand. Kept in
// sync with the community app's theme — both apps share this palette.
const dfTheme = darkTheme({
  accentColor: "#C9A34A",
  accentColorForeground: "#0E0D08",
  borderRadius: "medium",
  overlayBlur: "small",
});
dfTheme.colors.modalBackground = "#17150E";
dfTheme.colors.profileForeground = "#0E0D08";
dfTheme.colors.connectButtonBackground = "#1F1C12";
dfTheme.colors.connectButtonText = "#F5ECD0";
dfTheme.fonts.body = "var(--font-inter), system-ui, sans-serif";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={dfTheme} modalSize="compact">
          <ExtensionErrorFilter />
          <Toaster>{children}</Toaster>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
