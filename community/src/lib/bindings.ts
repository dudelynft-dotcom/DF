// Temporary persistence for wallet ↔ X bindings. Step 3 swaps this for
// the shared SQLite used by the main backend. Until then we keep it
// simple: a JSON file on disk, guarded by a process-level mutex.
//
// The schema deliberately matches the Step 3 DB table so the migration
// is a loader swap, not a shape change.

import fs from "node:fs/promises";
import path from "node:path";

export type Binding = {
  xId:     string;
  xHandle: string;
  wallet:  `0x${string}`;
  at:      number; // unix seconds
};

const FILE = path.join(process.cwd(), ".data", "bindings.json");

// Serialise writes so concurrent requests can't interleave-corrupt the file.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {}); // don't poison the queue
  return next;
}

async function readAll(): Promise<Binding[]> {
  try {
    const buf = await fs.readFile(FILE, "utf8");
    return JSON.parse(buf) as Binding[];
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw e;
  }
}

async function writeAll(rows: Binding[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function bindingByX(xId: string): Promise<Binding | null> {
  const rows = await readAll();
  return rows.find((r) => r.xId === xId) ?? null;
}

export async function bindingByWallet(wallet: `0x${string}`): Promise<Binding | null> {
  const rows = await readAll();
  const needle = wallet.toLowerCase();
  return rows.find((r) => r.wallet.toLowerCase() === needle) ?? null;
}

export async function saveBinding(b: Binding): Promise<void> {
  await queue(async () => {
    const rows = await readAll();
    // One X account, one wallet. If the X already has a binding, this
    // must be rejected by the caller — we fail hard here as a backstop.
    const dupX = rows.find((r) => r.xId === b.xId);
    const dupW = rows.find((r) => r.wallet.toLowerCase() === b.wallet.toLowerCase());
    if (dupX) throw new Error("x already bound");
    if (dupW) throw new Error("wallet already bound");
    rows.push(b);
    await writeAll(rows);
  });
}
