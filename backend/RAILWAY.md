# Railway deployment — DOGE FORGE backend

Three services, all from this repo, all with **Root Directory = `backend`**.

## 1. Create the project

1. railway.app → New Project → Deploy from GitHub repo → `dudelynft-dotcom/DF`.
2. After the first service appears, rename it to `api` and add two more services from the same repo (`+ New` → GitHub Repo → same repo).

## 2. Per-service settings

For each service: **Settings → Root Directory → `backend`**. Then set the start command via the `Procfile` process selector (Settings → Deploy → Custom Start Command, or pick the Procfile process):

| Service   | Start command       | Procfile process |
| --------- | ------------------- | ---------------- |
| `api`     | `npm run start`     | `web`            |
| `indexer` | `npm run indexer`   | `indexer`        |
| `keeper`  | `npm run keeper`    | `keeper`         |

Build command on all three: leave blank (Railway runs `npm install` automatically).

## 3. Shared environment variables

Set on **all three** services (Settings → Variables):

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

### `keeper` only

```
KEEPER_PRIVATE_KEY <private key of a fresh EOA — NOT your admin key>
KEEPER_INTERVAL_MS 30000
```

Fund the keeper EOA with a small amount of pathUSD for gas. The keeper only calls permissionless functions (`flush()`, `seedLiquidity()`), so it needs no admin role.

## 4. Persistent volume (SQLite)

The `api` and `indexer` share a SQLite file. Add a volume to **both**:

- Service → Volumes → Add Volume
- Mount path: `/data`
- Size: 1 GB

The `keeper` does not touch the DB — no volume needed.

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
- `keeper` should show flush + seed attempts every 30s (skipped if `pendingLiquidity = 0`, which is normal)
