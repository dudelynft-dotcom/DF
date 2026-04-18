"use client";
import type { Config } from "wagmi";
import {
  writeContract as wagmiWriteContract,
  getAccount,
  getConnections,
} from "@wagmi/core";
import { tempo } from "@/config/chain";
import { numberToHex, BaseError, ContractFunctionRevertedError } from "viem";

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

// Custom errors emitted by our contracts mapped to user-facing copy. Keys
// must match the `error Foo()` names in contracts/src/*.sol. Missing ones
// fall through to a camelCase-spaced fallback so users always see something
// readable instead of raw selector bytes.
const FRIENDLY_ERRORS: Record<string, string> = {
  // ForgeRouter
  ExpiredDeadline:         "The transaction took too long to confirm. Try again.",
  BadPath:                 "Route is invalid. Pick a different pair.",
  ZeroAmount:              "Amount must be greater than zero.",
  InsufficientOutputAmount:"Price moved too fast. Increase slippage or try a smaller amount.",
  InsufficientInputAmount: "Input amount is too small for this swap.",
  InsufficientAAmount:     "Price moved — try a smaller amount or increase slippage.",
  InsufficientBAmount:     "Price moved — try a smaller amount or increase slippage.",
  PairMissing:             "No pool exists for this pair yet.",
  PairNotWhitelisted:      "This pair isn't enabled for trading yet. Please check back soon.",
  FeeTooHigh:              "Configured fee exceeds the protocol maximum.",
  ZeroAddress:             "Invalid address.",
  // TdogePair
  InsufficientLiquidity:       "Not enough liquidity in the pool for this trade.",
  InsufficientLiquidityMinted: "Pool received too little liquidity — try larger amounts.",
  InsufficientLiquidityBurned: "Pool received too little liquidity to burn.",
  // ERC20 / OZ
  ERC20InsufficientBalance:   "Insufficient token balance.",
  ERC20InsufficientAllowance: "Approval missing or too low. Approve, then try again.",
  // Ownable
  OwnableUnauthorizedAccount: "You don't have permission for that action.",
};

function friendlyForError(name: string | undefined): string | null {
  if (!name) return null;
  if (FRIENDLY_ERRORS[name]) return FRIENDLY_ERRORS[name];
  // Unknown error: split camelCase into a sentence. Keeps output readable
  // even for errors we haven't mapped yet, so nothing ever renders as raw
  // selector bytes like "B0\uFFFD#".
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1) + ".";
}

export function prettifyError(e: unknown): string {
  const raw = (e as { shortMessage?: string; message?: string; details?: string; code?: number });
  const msg = raw?.shortMessage || raw?.details || raw?.message || String(e);

  // Wallet-side rejections never reach the chain — check these first.
  if (raw?.code === 4001 || /user rejected|user denied|rejected the request/i.test(msg)) {
    return "Request rejected in wallet.";
  }
  if (/already pending/i.test(msg)) {
    return "Check your wallet. A network prompt is already waiting for approval.";
  }
  if (/insufficient funds/i.test(msg)) {
    return "Insufficient balance for this transaction.";
  }

  // Walk viem's error tree to extract the decoded custom-error name.
  // Without this, undecoded selectors render as raw bytes (e.g. "B0\uFFFD#")
  // which is unreadable for users.
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const friendly = friendlyForError(revert.data?.errorName);
      if (friendly) return friendly;
      if (revert.reason) return revert.reason;
    }
  }

  if (msg.length > 240) return msg.slice(0, 240) + "…";
  return msg;
}
