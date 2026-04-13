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
export const CURATED_TOKENS: CuratedToken[] = [
  {
    address: addresses.doge,
    symbol:  "TDOGE",
    name:    "Tempo Doge",
    decimals: 18,
    kind:    "project",
    description: "The native mining reward of DOGE FORGE. 210M supply cap.",
  },
  {
    address: "0x20c0000000000000000000000000000000000000",
    symbol:  "pathUSD",
    name:    "PathUSD",
    decimals: 6,
    kind:    "native-stable",
    description: "Tempo's canonical stablecoin used across DOGE FORGE.",
  },
  {
    address: "0x20c0000000000000000000000000000000000001",
    symbol:  "AlphaUSD",
    name:    "AlphaUSD",
    decimals: 6,
    kind:    "stablecoin",
  },
  {
    address: "0x20c0000000000000000000000000000000000002",
    symbol:  "BetaUSD",
    name:    "BetaUSD",
    decimals: 6,
    kind:    "stablecoin",
  },
  {
    address: "0x20c0000000000000000000000000000000000003",
    symbol:  "ThetaUSD",
    name:    "ThetaUSD",
    decimals: 6,
    kind:    "stablecoin",
  },
];

/// Tempo does not yet publish a consumer-facing DEX UI. Until the enshrined
/// orderbook is integrated natively in DOGE FORGE (Phase A) or a third-party
/// client ships, the "view" action just opens the token's explorer page.
export function explorerLink(addr: `0x${string}`): string {
  const explorer = process.env.NEXT_PUBLIC_TEMPO_EXPLORER_URL
    ?? "https://explore.testnet.tempo.xyz";
  return `${explorer}/address/${addr}`;
}

export const QUOTE_TOKEN = CURATED_TOKENS[1]; // pathUSD is the canonical quote

/// Build a deep-link to Tempo DEX for a specific trade intent.
/// Returns null if no DEX URL is configured (operator sets
/// NEXT_PUBLIC_TEMPO_DEX_URL when a compatible UI ships).
export function tradeLink(
  base: `0x${string}`,
  side: "buy" | "sell" = "buy",
  amount?: string,
): string | null {
  const dex = process.env.NEXT_PUBLIC_TEMPO_DEX_URL;
  if (!dex) return null;
  const q = new URLSearchParams({
    base,
    quote: QUOTE_TOKEN.address,
    side,
  });
  if (amount) q.set("amount", amount);
  return `${dex.replace(/\/$/, "")}/trade?${q.toString()}`;
}
