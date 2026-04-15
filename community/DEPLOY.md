# Deploying community.dogeforge.fun

Separate Vercel project rooted at `community/`. Backend is the same
`api.dogeforge.fun` VM that already powers the main app (adds the
community endpoints + indexer).

## 1. DNS

Add a CNAME on Cloudflare (or wherever `dogeforge.fun` lives):

| Type  | Name      | Value                   | Proxy |
| ----- | --------- | ----------------------- | ----- |
| CNAME | community | `cname.vercel-dns.com`  | DNS-only (grey cloud) |

Proxy OFF. Cloudflare termination breaks Vercel's cert issuance.

## 2. Vercel project

1. Vercel dashboard → **Add New → Project** → import `DF`.
2. **Root Directory: `community`**.
3. Framework preset: Next.js (auto).
4. Environment Variables (Production + Preview):

   ```
   NEXT_PUBLIC_SITE_URL                https://community.dogeforge.fun
   NEXT_PUBLIC_BACKEND_URL             https://api.dogeforge.fun
   COMMUNITY_BACKEND_URL               https://api.dogeforge.fun
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID <same as main app, optional>

   AUTH_TWITTER_ID                     <X OAuth client id>
   AUTH_TWITTER_SECRET                 <X OAuth secret>
   AUTH_SECRET                         <48-byte random string>
   COMMUNITY_SHARED_SECRET             <32+ char string, matches backend>
   ```

   Generate `AUTH_SECRET` and `COMMUNITY_SHARED_SECRET` fresh for prod:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
5. Deploy.
6. **Settings → Domains → Add** `community.dogeforge.fun`. Vercel
   provisions the cert in ~60s.

## 3. X OAuth callback

Developer portal → your app → **User auth settings** → add to callback URLs:

```
https://community.dogeforge.fun/api/auth/x/callback
```

Keep the localhost entry so you can still dev.

## 4. Backend (shared VM)

SSH in, pull, restart.

```
ssh <user>@api.dogeforge.fun
cd ~/DOGE-FORGE && git pull
cd backend && npm install

# Append to backend/.env (adjust values):
# COMMUNITY_SHARED_SECRET=<same value you set on Vercel>
# TDOGE_NAMES_ADDRESS=0x998ae581c462DA5aa161b5f89F4d4Fe40B5eab35
# FORGE_ROUTER_ADDRESS=0xffBD254859EbF9fC4808410f95f8C4E7998846fB
# MINER_ADDRESS=0x1574EEA1DA5e204CC035968D480aE51BF6505834
# ARC_RPC_URL=https://rpc.testnet.arc.network
# ARC_CHAIN_ID=5042002

pm2 restart api
pm2 start   npm --name community-indexer -- run community-indexer
pm2 save
```

If the indexer is new on this host, it'll backfill the last 50k blocks
on first tick (~15 minutes on Arc testnet).

## 5. Smoke test

```
curl https://api.dogeforge.fun/health                        # {"ok":true}
curl https://api.dogeforge.fun/community/tasks | head -c 200 # lists 15 tasks
curl https://community.dogeforge.fun                          # landing 200
```

Then in a browser:
- Visit community.dogeforge.fun
- Connect X → should bounce to X → back to /connect with handle shown
- Bind wallet → Sign the message → success pill
- Claim a Social task → points should increment
- Visit /leaderboard → you appear

## 6. Admin UI

`/DFAdmin/community` on the main app (dogeforge.fun). Gate is the
same wallet as `NEXT_PUBLIC_ADMIN_ADDRESS` on Vercel. Paste
`ADMIN_TOKEN` once — cached in localStorage.

Allows:
- List all users with points, tier, trade/mine volume
- Append a manual points adjustment (audited in the ledger)
- Enable/disable any task

## 7. Monitoring

On the VM:

```
pm2 logs community-indexer --lines 50
```

Healthy steady-state output:

```
[community] swaps   37350000 → 37350500 (3 logs)
[community] commits 37350000 → 37350500 (0 logs)
```

If you see `.0` suffix parse errors, that's the bigint regression —
already fixed, but if it reappears, restart the indexer after a
`git pull`.
