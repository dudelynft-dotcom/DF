"use client";
import { useAccount, useConfig, useReadContract, useReadContracts } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
import { addresses, tempo, PATHUSD_DECIMALS } from "@/config/chain";
import { erc20Abi } from "@/lib/abis";
import { namesAbi } from "@/lib/namesAbi";
import { sendTx, ensureTempoChain, prettifyError } from "@/lib/tx";
import { useToast } from "@/components/Toaster";

export default function IdPage() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const toast = useToast();
  const onWrongChain = Boolean(address) && chainId !== tempo.id;

  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "claim" | "approve" | "switch">(null);

  // Global + per-wallet reads
  const { data: batch, refetch } = useReadContracts({
    contracts: [
      { address: addresses.names, abi: namesAbi, functionName: "claimOpen",     chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "claimCost",     chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "totalClaimed",  chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "remaining",     chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "MAX_SUPPLY",    chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "isEligible",    args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.names, abi: namesAbi, functionName: "displayNameOf", args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "balanceOf",   args: address ? [address] : undefined, chainId: tempo.id },
      { address: addresses.pathUSD, abi: erc20Abi, functionName: "allowance",   args: address ? [address, addresses.names] : undefined, chainId: tempo.id },
    ],
    allowFailure: true,
    query: { refetchInterval: 10_000 },
  });

  const claimOpen    = batch?.[0]?.result as boolean | undefined;
  const claimCost    = batch?.[1]?.result as bigint  | undefined;
  const totalClaimed = batch?.[2]?.result as bigint  | undefined;
  const remaining    = batch?.[3]?.result as bigint  | undefined;
  const maxSupply    = batch?.[4]?.result as bigint  | undefined;
  const isEligible   = batch?.[5]?.result as boolean | undefined;
  const existingName = batch?.[6]?.result as string  | undefined;
  const pathBalance  = batch?.[7]?.result as bigint  | undefined;
  const allowance    = batch?.[8]?.result as bigint  | undefined;

  const alreadyHolder = (existingName?.length ?? 0) > 0;

  // Debounced name input + on-chain availability check
  const [debouncedName, setDebouncedName] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(name.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [name]);

  const localValid = useMemo(() => isValidName(debouncedName), [debouncedName]);
  const { data: availData } = useReadContract({
    address: addresses.names,
    abi: namesAbi,
    functionName: "isNameAvailable",
    args: debouncedName ? [debouncedName] : undefined,
    chainId: tempo.id,
    query: { enabled: !!debouncedName && localValid },
  });
  const available = availData as boolean | undefined;

  const needsApproval = claimCost !== undefined && allowance !== undefined
    && allowance < claimCost;
  const insufficientBalance = claimCost !== undefined && pathBalance !== undefined
    && pathBalance < claimCost;

  const canClaim = !!address
    && !onWrongChain
    && claimOpen
    && !alreadyHolder
    && isEligible
    && !insufficientBalance
    && !needsApproval
    && localValid
    && available === true;

  async function switchToTempo() {
    setBusy("switch");
    try { await ensureTempoChain(config); }
    catch (e) { toast.push({ kind: "error", title: "Switch failed", body: prettifyError(e), ttl: 8000 }); }
    finally { setBusy(null); }
  }

  async function doApprove() {
    if (!claimCost) return;
    const id = toast.push({ kind: "pending", title: "Approving pathUSD", ttl: 0 });
    setBusy("approve");
    try {
      const hash = await sendTx(config, {
        address: addresses.pathUSD, abi: erc20Abi, functionName: "approve",
        args: [addresses.names, claimCost],
      });
      toast.update(id, { body: "Waiting for confirmation", hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: tempo.id });
      if (r.status === "success") {
        toast.update(id, { kind: "success", title: "Approved", body: undefined, ttl: 5000 });
        refetch();
      } else {
        toast.update(id, { kind: "error", title: "Approval reverted", body: undefined, ttl: 8000 });
      }
    } catch (e) {
      toast.update(id, { kind: "error", title: "Approval failed", body: prettifyError(e), ttl: 8000 });
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!canClaim) return;
    const id = toast.push({ kind: "pending", title: `Claiming ${debouncedName}.tdoge`, ttl: 0 });
    setBusy("claim");
    try {
      const hash = await sendTx(config, {
        address: addresses.names, abi: namesAbi, functionName: "claim",
        args: [debouncedName],
      });
      toast.update(id, { body: "Submitted. Waiting for confirmation", hash });
      const r = await waitForTransactionReceipt(config, { hash, chainId: tempo.id });
      if (r.status === "success") {
        toast.update(id, { kind: "success", title: `${debouncedName}.tdoge claimed`, body: "Fee routed to TDOGE liquidity.", ttl: 7000 });
        setName("");
        refetch();
      } else {
        toast.update(id, { kind: "error", title: "Transaction reverted", body: undefined, ttl: 8000 });
      }
    } catch (e) {
      toast.update(id, { kind: "error", title: "Claim failed", body: prettifyError(e), ttl: 8000 });
    } finally {
      setBusy(null);
    }
  }

  const percentClaimed = totalClaimed !== undefined && maxSupply && maxSupply > 0n
    ? (Number(totalClaimed) / Number(maxSupply)) * 100
    : 0;

  const costHuman = claimCost !== undefined ? formatUnits(claimCost, PATHUSD_DECIMALS) : "-";

  return (
    <div className="space-y-10 max-w-2xl mx-auto">
      <div>
        <p className="text-xs uppercase tracking-[0.28em] text-gold-400/80">Identity</p>
        <h1 className="font-display text-5xl tracking-tightest mt-3">Claim your .tdoge ID</h1>
        <p className="text-ink-muted mt-3 max-w-xl">
          Your on-chain identity across DOGE FORGE. Any miner is eligible.
          Claim fee routes straight to TDOGE liquidity — not treasury.
        </p>
      </div>

      {onWrongChain && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-red-500/40 bg-red-500/5">
          <div className="text-sm text-red-300">Switch to Tempo Testnet (chain {tempo.id}).</div>
          <button
            onClick={switchToTempo} disabled={busy === "switch"}
            className="px-3 py-1.5 rounded-md bg-gold-400 text-bg-base text-xs font-medium disabled:opacity-40"
          >
            Switch
          </button>
        </div>
      )}

      {/* Supply strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line rounded-xl overflow-hidden">
        <Stat label="Cost"      value={`${costHuman} pathUSD`} />
        <Stat label="Supply"    value={maxSupply !== undefined ? maxSupply.toString() : "-"} />
        <Stat label="Claimed"   value={totalClaimed !== undefined ? totalClaimed.toString() : "-"} />
        <Stat label="Remaining" value={remaining !== undefined ? remaining.toString() : "-"} emphasis />
      </section>

      <div className="h-1.5 w-full rounded-full bg-bg-raised overflow-hidden">
        <div
          className="h-full bg-gold-400 transition-[width] duration-500"
          style={{ width: `${percentClaimed.toFixed(2)}%` }}
        />
      </div>

      {/* Wallet status */}
      {address && (
        <section className="rounded-xl border border-line bg-bg-surface p-5 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">Your status</span>
            <span className="text-ink">
              {alreadyHolder
                ? <span className="font-display text-gold-300">{existingName} claimed</span>
                : !isEligible
                  ? <span className="text-ink-muted">Commit pathUSD in Mine to become eligible</span>
                  : insufficientBalance
                    ? <span className="text-red-300">Not enough pathUSD (need {costHuman})</span>
                    : <span className="text-gold-300">Eligible · ready to claim</span>}
            </span>
          </div>
        </section>
      )}

      {/* Claim form */}
      {!alreadyHolder && (
        <section className="rounded-2xl border border-line bg-bg-surface p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-ink-faint">Your on-chain identity</p>
            <h2 className="font-display text-2xl tracking-tight mt-1">Pick a name</h2>
          </div>

          <div className="flex items-stretch gap-0 rounded-md bg-bg-base border border-line focus-within:border-gold-400/70 transition-colors overflow-hidden">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="yourname"
              maxLength={20}
              className="flex-1 px-4 py-3 bg-transparent outline-none text-lg tabular text-ink"
            />
            <span className="px-4 py-3 text-ink-faint text-lg tabular bg-bg-surface border-l border-line select-none">
              .tdoge
            </span>
          </div>

          <NameStatus name={debouncedName} localValid={localValid} available={available} />

          {needsApproval ? (
            <button
              onClick={doApprove}
              disabled={!address || onWrongChain || busy !== null || insufficientBalance}
              className="w-full px-4 py-3 rounded-md border border-gold-400/60 text-ink font-medium hover:bg-gold-400/10 transition-colors disabled:opacity-40"
            >
              {busy === "approve" ? "Approving..." : `Approve ${costHuman} pathUSD`}
            </button>
          ) : (
            <button
              onClick={doClaim}
              disabled={!canClaim || busy !== null}
              className="w-full px-4 py-3 rounded-md bg-gold-400 text-bg-base font-semibold hover:bg-gold-300 transition-colors disabled:opacity-40"
            >
              {busy === "claim"
                ? "Claiming..."
                : !address              ? "Connect wallet"
                : onWrongChain          ? "Wrong network"
                : !claimOpen            ? "Claims not open"
                : !isEligible           ? "Commit pathUSD to become eligible"
                : insufficientBalance   ? `Need ${costHuman} pathUSD`
                : !localValid           ? "Enter a valid name"
                : available === false   ? "Name taken"
                :                         `Claim ${debouncedName || "name"}.tdoge · ${costHuman} pathUSD`}
            </button>
          )}

          <p className="text-[11px] text-ink-faint text-center leading-relaxed">
            Lowercase a-z, 0-9, hyphens. 1 to 20 characters. One ID per wallet.
            Claim fee flows directly into TDOGE liquidity.
          </p>
        </section>
      )}
    </div>
  );
}

function NameStatus({
  name, localValid, available,
}: { name: string; localValid: boolean; available?: boolean }) {
  if (!name) return <div className="text-xs text-ink-faint h-4">&nbsp;</div>;
  if (!localValid) return <div className="text-xs text-red-300">Invalid name format.</div>;
  if (available === undefined) return <div className="text-xs text-ink-faint">Checking availability...</div>;
  if (available) return <div className="text-xs text-emerald-300">{name}.tdoge is available.</div>;
  return <div className="text-xs text-red-300">{name}.tdoge is already taken.</div>;
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="p-4 bg-bg-surface">
      <div className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div className={`mt-2 font-display tracking-tight tabular ${emphasis ? "text-2xl text-gold-300" : "text-lg text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function isValidName(n: string): boolean {
  if (!n) return false;
  if (n.length < 1 || n.length > 20) return false;
  if (!/^[a-z0-9-]+$/.test(n)) return false;
  if (n.startsWith("-") || n.endsWith("-")) return false;
  return true;
}
