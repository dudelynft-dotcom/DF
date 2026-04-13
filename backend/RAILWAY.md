# Railway deployment — DOGE FORGE backend

Two services, both from this repo, both with **Root Directory = `backend`**.

> Liquidity flushing is now **on-chain auto-flush** (triggered inside
> `Miner.commit / harvest`). No keeper bot, no separate funded EOA.

## 1. Create the project

1. railway.app → New Project → Deploy from GitHub repo → `dudelynft-dotcom/DF`.
2. After the first service appears, rename it to `api` and add one more service from the same repo (`+ New` → GitHub Repo → same repo). Rename it to `indexer`.

## 2. Per-service settings

For each service: **Settings → Root Directory → `backend`**. Then set the start command via the `Procfile` process selector (Settings → Deploy → Custom Start Command, or pick the Procfile process):

| Service   | Start command       | Procfile process |
| --------- | ------------------- | ---------------- |
| `api`     | `npm run start`     | `web`            |
| `indexer` | `npm run indexer`   | `indexer`        |

Build command on both: leave blank (Railway runs `npm install` automatically).

## 3. Shared environment variables

Set on **both** services (Settings → Variables):

```
TEMPO_RPC_URL      https://rpc.testnet.tempo.xyz
TEMPO_CHAIN_ID     42431
MINER_ADDRESS      0xa0fc97a102bdf39039cf09094811ef39995066ab
LM_ADDRESS         0x7317ab8ddd23c63f0187740c1a75e1570ad2f9ba
PATHUSD_ADDRESS    0x20c0000000000000000000000000000000000000
DB_PATH            /data/forge.db
ADMIN_TOKEN        <random 32+ char string you choose>
```

### `api` only

```
PORT               4000
```

### `indexer` only

```
INDEXER_POLL_MS    10000
INDEXER_RANGE      200
INDEXER_START_BLOCK 0
```

## 4. Persistent volume (SQLite)

The `api` and `indexer` share a SQLite file. Add a volume to **both**:

- Service → Volumes → Add Volume
- Mount path: `/data`
- Size: 1 GB

## 5. Wire the frontend

Once `api` is live, copy its public URL (e.g. `https://doge-forge-api-production.up.railway.app`).

In Vercel → Project → Settings → Environment Variables:

```
NEXT_PUBLIC_BACKEND_URL  https://<your-api-url>
```

Redeploy the frontend. The Trade page's "Unverified" tab will populate from the indexer's discoveries.

## 6. Smoke test

```
curl https://<your-api-url>/health
curl https://<your-api-url>/tokens
```

Logs (Railway → Service → Deployments → Logs):

- `api` should show `listening on :4000`
- `indexer` should show poll ticks every ~10s

## 7. Auto-flush behavior

Liquidity flushing happens automatically inside `Miner.sol` at the end of
`commit`, `deposit`, `harvest`, and `harvestAll`. A flush fires when:

- `pendingLiquidity ≥ autoFlushThreshold` (default: 100 pathUSD), **or**
- `pendingLiquidity > 0` and at least `autoFlushIntervalSec` (default: 1h)
  has passed since the last auto-flush.

The seed call is wrapped in `try/catch` — if `LiquidityManager.seedLiquidity`
ever reverts (e.g. mint budget exhausted), an `AutoFlushSeedFailed` event is
emitted and the user's mining tx still succeeds.

Admin can tune via:

```
Miner.setAutoFlushEnabled(bool)
Miner.setAutoFlushThreshold(uint256)   // pathUSD-wei
Miner.setAutoFlushIntervalSec(uint256) // seconds
```

The public `flush()` function still exists as a manual fallback — anyone can
call it to force-process the backlog without paying for `seedLiquidity`.
