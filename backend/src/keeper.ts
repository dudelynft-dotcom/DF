import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Liquidity keeper.
 *
 * Every `KEEPER_INTERVAL_MS` (default 30s):
 *   1. Checks Miner's pathUSD balance. If > 0 AND Miner.pendingLiquidity > 0,
 *      calls `Miner.flush()` to push pathUSD out to LiquidityManager + treasury.
 *   2. Checks LiquidityManager's pathUSD balance. If > 0, calls
 *      `LiquidityManager.seedLiquidity()` to deposit both sides into TdogePair.
 *
 * Both actions are permissionless on-chain; this keeper is just whoever pays gas.
 * Idle ticks are cheap (two view reads, no tx).
 */

const RPC      = process.env.TEMPO_RPC_URL ?? "https://rpc.testnet.tempo.xyz";
const MINER    = process.env.MINER_ADDRESS    as `0x${string}` | undefined;
const LM       = process.env.LM_ADDRESS       as `0x${string}` | undefined;
const PATHUSD  = process.env.PATHUSD_ADDRESS  as `0x${string}` | undefined;
const PK       = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined;
const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 30_000);

if (!MINER || !LM || !PATHUSD || !PK) {
  console.error("[keeper] idle — require MINER_ADDRESS, LM_ADDRESS, PATHUSD_ADDRESS, KEEPER_PRIVATE_KEY");
  process.exit(0);
}

const abi = parseAbi([
  // Miner
  "function pendingLiquidity() view returns (uint256)",
  "function pendingTreasury() view returns (uint256)",
  "function flush()",
  // LiquidityManager
  "function seedLiquidity() returns (uint256)",
  // ERC20
  "function balanceOf(address) view returns (uint256)",
]);

const account = privateKeyToAccount(PK);
const pub = createPublicClient({ transport: http(RPC) });
const wal = createWalletClient({ account, transport: http(RPC) });

async function tryFlush(): Promise<boolean> {
  const [pendLq, pendTz] = await Promise.all([
    pub.readContract({ address: MINER!, abi, functionName: "pendingLiquidity" }),
    pub.readContract({ address: MINER!, abi, functionName: "pendingTreasury" }),
  ]);
  if (pendLq === 0n && pendTz === 0n) return false;
  console.log(`[keeper] flush: pendingLq=${pendLq}, pendingTz=${pendTz}`);
  const hash = await wal.writeContract({
    address: MINER!, abi, functionName: "flush", chain: null,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`[keeper] flushed (${r.status}): ${hash}`);
  return r.status === "success";
}

async function trySeed(): Promise<boolean> {
  const bal = await pub.readContract({
    address: PATHUSD!, abi, functionName: "balanceOf", args: [LM!],
  });
  if (bal === 0n) return false;
  console.log(`[keeper] seed: LM pathUSD = ${bal}`);
  try {
    const hash = await wal.writeContract({
      address: LM!, abi, functionName: "seedLiquidity", chain: null,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`[keeper] seeded (${r.status}): ${hash}`);
    return r.status === "success";
  } catch (e: unknown) {
    const err = e as { shortMessage?: string; message?: string };
    console.error(`[keeper] seed failed: ${err.shortMessage ?? err.message ?? e}`);
    return false;
  }
}

async function tick() {
  const flushed = await tryFlush();
  // chain seed immediately after a successful flush, otherwise still try (LM may
  // have leftover balance from a previous failure)
  await trySeed();
  if (!flushed) {
    // nothing changed; quiet idle
  }
}

async function loop() {
  console.log(`[keeper] starting. miner=${MINER} lm=${LM} interval=${INTERVAL}ms`);
  while (true) {
    try { await tick(); }
    catch (e) { console.error("[keeper] tick error", e); }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}
loop();
