"use client";
import { useReadContract } from "wagmi";
import { addresses, tempo } from "@/config/chain";
import { namesAbi } from "@/lib/namesAbi";

/// Returns the user's `<name>.tdoge` identity, or null if none claimed.
/// Refetches every 30s.
export function useIdentity(address: `0x${string}` | undefined) {
  const { data } = useReadContract({
    address: addresses.names,
    abi: namesAbi,
    functionName: "displayNameOf",
    args: address ? [address] : undefined,
    chainId: tempo.id,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });
  const name = data as string | undefined;
  return name && name.length > 0 ? name : null;
}
