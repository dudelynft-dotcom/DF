"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { wagmiConfig } from "@/config/wagmi";

// Custom RainbowKit theme to match the DOGE FORGE dark+gold palette.
const dfTheme = darkTheme({
  accentColor: "#C9A34A",       // gold-400
  accentColorForeground: "#0E0D08", // bg-base
  borderRadius: "medium",
  overlayBlur: "small",
});
// Override specific tokens for deeper brand alignment.
dfTheme.colors.modalBackground = "#17150E";       // bg-surface
dfTheme.colors.profileForeground = "#0E0D08";
dfTheme.colors.connectButtonBackground = "#1F1C12"; // bg-raised
dfTheme.colors.connectButtonText = "#F5ECD0";       // ink
dfTheme.fonts.body = "var(--font-inter), system-ui, sans-serif";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider theme={dfTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
