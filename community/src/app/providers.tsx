"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { wagmiConfig } from "@/config/wagmi";

// Deep brand theme for RainbowKit's connect modal. Kept in sync with
// frontend/src/app/providers.tsx — both apps share the DOGE FORGE
// dark + gold palette. Any token change here must land there too.
const dfTheme = darkTheme({
  accentColor:           "#C9A34A",
  accentColorForeground: "#0E0D08",
  borderRadius:          "medium",
  overlayBlur:           "small",
  fontStack:             "system",
});

dfTheme.colors.modalBackground             = "#0E0D08";
dfTheme.colors.modalBackdrop               = "rgba(0,0,0,0.72)";
dfTheme.colors.generalBorder               = "rgba(201,163,74,0.22)";
dfTheme.colors.generalBorderDim            = "rgba(201,163,74,0.12)";
dfTheme.colors.modalBorder                 = "rgba(201,163,74,0.28)";
dfTheme.colors.modalText                   = "#F5ECD0";
dfTheme.colors.modalTextSecondary          = "rgba(245,236,208,0.62)";
dfTheme.colors.modalTextDim                = "rgba(245,236,208,0.38)";
dfTheme.colors.menuItemBackground          = "#17150E";
dfTheme.colors.actionButtonBorder          = "rgba(201,163,74,0.22)";
dfTheme.colors.actionButtonBorderMobile    = "rgba(201,163,74,0.22)";
dfTheme.colors.actionButtonSecondaryBackground = "#1F1C12";
dfTheme.colors.closeButton                 = "rgba(245,236,208,0.62)";
dfTheme.colors.closeButtonBackground       = "rgba(255,255,255,0.05)";
dfTheme.colors.connectButtonBackground     = "#17150E";
dfTheme.colors.connectButtonBackgroundError = "#401414";
dfTheme.colors.connectButtonInnerBackground = "#1F1C12";
dfTheme.colors.connectButtonText           = "#F5ECD0";
dfTheme.colors.connectButtonTextError      = "#FCA5A5";
dfTheme.colors.profileAction               = "#17150E";
dfTheme.colors.profileActionHover          = "rgba(201,163,74,0.08)";
dfTheme.colors.profileForeground           = "#17150E";

dfTheme.fonts.body = "var(--font-inter), system-ui, sans-serif";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={dfTheme}
          modalSize="compact"
          appInfo={{
            appName: "DOGE FORGE",
            learnMoreUrl: "https://dogeforge.fun/TDOGEPAPER",
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
