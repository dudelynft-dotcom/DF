"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/config/wagmi";
import { useState } from "react";
import { Toaster } from "@/components/Toaster";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <ExtensionErrorFilter />
        <Toaster>{children}</Toaster>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
