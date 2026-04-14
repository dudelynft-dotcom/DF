import { addresses } from "./chain";

export type CuratedToken = {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  kind: "native-stable" | "project" | "stablecoin";
  description?: string;
};

/// Curated list is always marked verified. Backend discovery adds to the
/// unverified pool below this, which admins can later promote to verified.
/// Entries with a missing/empty address are filtered out — happens during
/// the window between a chain migration and the first deploy.
const RAW_CURATED: Array<CuratedToken | null> = [
  addresses.doge ? {
    address: addresses.doge,
    symbol:  "fDOGE",
    name:    "Doge Forge",
    decimals: 18,
    kind:    "project",
    description: "The native mining reward of DOGE FORGE. 210M supply cap.",
  } : null,
  addresses.usdc ? {
    address: addresses.usdc,
    symbol:  "USDC",
    name:    "USD Coin",
    decimals: 6,
    kind:    "native-stable",
    description: "Arc's native gas token; also the canonical stablecoin for DOGE FORGE.",
  } : null,
  // Arc's official predeployed stablecoins (docs.arc.network).
  {
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    symbol:  "EURC",
    name:    "Euro Coin",
    decimals: 6,
    kind:    "stablecoin",
    description: "Circle's euro-backed stablecoin, predeployed on Arc.",
  },
  {
    address: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
    symbol:  "USYC",
    name:    "US Yield Coin",
    decimals: 6,
    kind:    "stablecoin",
    description: "Yield-bearing USD stablecoin (Hashnote), predeployed on Arc.",
  },
  // UnitFlow's wrapped USDC (paired against most of their tokens).
  {
    address: addresses.wusdc,
    symbol:  "WUSDC",
    name:    "Wrapped USDC",
    decimals: 6,
    kind:    "stablecoin",
    description: "UnitFlow's wrapped USDC for AMM pool routing.",
  },
];

export const CURATED_TOKENS: CuratedToken[] = RAW_CURATED.filter(
  (t): t is CuratedToken => !!t && !!t.address,
);

export function explorerLink(addr: `0x${string}`): string {
  const explorer = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL
    ?? "https://testnet.arcscan.app";
  return `${explorer}/address/${addr}`;
}

export const QUOTE_TOKEN: CuratedToken | undefined =
  CURATED_TOKENS.find((t) => t.kind === "native-stable");

/// Deep-link to an external DEX for a specific trade intent.
/// Returns null if no DEX URL is configured (operator sets
/// NEXT_PUBLIC_ARC_DEX_URL when a compatible UI ships).
export function tradeLink(
  base: `0x${string}`,
  side: "buy" | "sell" = "buy",
  amount?: string,
): string | null {
  const dex = process.env.NEXT_PUBLIC_ARC_DEX_URL;
  if (!dex || !QUOTE_TOKEN) return null;
  const q = new URLSearchParams({
    base,
    quote: QUOTE_TOKEN.address,
    side,
  });
  if (amount) q.set("amount", amount);
  return `${dex.replace(/\/$/, "")}/trade?${q.toString()}`;
}
