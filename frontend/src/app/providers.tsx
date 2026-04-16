"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/config/wagmi";
import { useState } from "react";
import { Toaster } from "@/components/Toaster";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";

// Deep brand theme for RainbowKit's connect modal. Every colour is a
// DOGE FORGE design token — no RainbowKit default bleeds through. Kept
// in sync with community/src/app/providers.tsx; both apps share it.
const dfTheme = darkTheme({
  accentColor:           "#C9A34A",
  accentColorForeground: "#0E0D08",
  borderRadius:          "medium",
  overlayBlur:           "small",
  fontStack:             "system",
});

// Page + panel surfaces
dfTheme.colors.modalBackground             = "#0E0D08";              // bg-base — matches page
dfTheme.colors.modalBackdrop               = "rgba(0,0,0,0.72)";
dfTheme.colors.generalBorder               = "rgba(201,163,74,0.22)"; // gold-tinted hairline
dfTheme.colors.generalBorderDim            = "rgba(201,163,74,0.12)";
dfTheme.colors.modalBorder                 = "rgba(201,163,74,0.28)"; // stronger border on modal
dfTheme.colors.modalText                   = "#F5ECD0";              // ink
dfTheme.colors.modalTextSecondary          = "rgba(245,236,208,0.62)"; // ink-muted
dfTheme.colors.modalTextDim                = "rgba(245,236,208,0.38)"; // ink-faint

// Row / item backgrounds — the wallet list
dfTheme.colors.menuItemBackground          = "#17150E";              // bg-surface
dfTheme.colors.actionButtonBorder          = "rgba(201,163,74,0.22)";
dfTheme.colors.actionButtonBorderMobile    = "rgba(201,163,74,0.22)";
dfTheme.colors.actionButtonSecondaryBackground = "#1F1C12";          // bg-raised
dfTheme.colors.closeButton                 = "rgba(245,236,208,0.62)";
dfTheme.colors.closeButtonBackground       = "rgba(255,255,255,0.05)";

// Header button (when rendered) + profile / connected states
dfTheme.colors.connectButtonBackground     = "#17150E";
dfTheme.colors.connectButtonBackgroundError = "#401414";
dfTheme.colors.connectButtonInnerBackground = "#1F1C12";
dfTheme.colors.connectButtonText           = "#F5ECD0";
dfTheme.colors.connectButtonTextError      = "#FCA5A5";
dfTheme.colors.profileAction               = "#17150E";
dfTheme.colors.profileActionHover          = "rgba(201,163,74,0.08)";
dfTheme.colors.profileForeground           = "#17150E";

// Fonts — use the same Inter variable the rest of the app uses.
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
          <ExtensionErrorFilter />
          <Toaster>{children}</Toaster>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
