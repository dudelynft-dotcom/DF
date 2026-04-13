"use client";
import type { Config } from "wagmi";
import {
  writeContract as wagmiWriteContract,
  getAccount,
  getConnections,
} from "@wagmi/core";
import { tempo } from "@/config/chain";
import { numberToHex } from "viem";

type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/// Module-level singleton: if an add/switch flow is already waiting on the
/// wallet, subsequent callers join the same promise instead of firing another
/// wallet_addEthereumChain (which MetaMask rejects with "already pending").
let inFlight: Promise<void> | null = null;

/// Ensure wallet is on Tempo testnet, then submit a write.
export async function sendTx(
  config: Config,
  params: Parameters<typeof wagmiWriteContract>[1]
): Promise<`0x${string}`> {
  await ensureTempoChain(config);
  return wagmiWriteContract(config, { ...params, chainId: tempo.id });
}

/// Switch (or add-then-switch) the wallet to Tempo testnet. Deduplicates
/// concurrent calls so the wallet only sees one pending prompt at a time.
export async function ensureTempoChain(config: Config): Promise<void> {
  const { chainId } = getAccount(config);
  if (chainId === tempo.id) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const provider = await getActiveProvider(config);
      const targetChainHex = numberToHex(tempo.id);

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainHex }],
        });
        return;
      } catch (err) {
        const e = err as { code?: number; message?: string };
        const unknownChain =
          e.code === 4902 ||
          e.code === -32603 ||
          /unrecognized chain|not added|not been added|unknown chain|4902/i.test(e.message ?? "");
        if (!unknownChain) throw err;
      }

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: targetChainHex,
          chainName: tempo.name,
          nativeCurrency: tempo.nativeCurrency,
          rpcUrls: [...tempo.rpcUrls.default.http],
          blockExplorerUrls: [tempo.blockExplorers!.default.url],
        }],
      });

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChainHex }],
        });
      } catch {
        /* some wallets auto-switch after add */
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

async function getActiveProvider(config: Config): Promise<EIP1193Provider> {
  const conns = getConnections(config);
  const conn = conns[0];
  if (!conn) throw new Error("No wallet connected.");
  const provider = await conn.connector.getProvider();
  return provider as EIP1193Provider;
}

export function prettifyError(e: unknown): string {
  const raw = (e as { shortMessage?: string; message?: string; details?: string; code?: number });
  const msg = raw?.shortMessage || raw?.details || raw?.message || String(e);
  if (raw?.code === 4001 || /user rejected|user denied|rejected the request/i.test(msg)) {
    return "Request rejected in wallet.";
  }
  if (/already pending/i.test(msg)) {
    return "Check your wallet. A network prompt is already waiting for approval.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Insufficient balance for this transaction.";
  }
  if (msg.length > 240) return msg.slice(0, 240) + "…";
  return msg;
}
