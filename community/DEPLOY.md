# Deploying community.dogeforge.fun

Second Vercel project, shares nothing with the main `dogeforge.fun` app
except the visual tokens. Backend is shared (same `api.dogeforge.fun`).

## 1. Vercel project

1. Vercel → **Add New → Project** → Import the `DF` repo.
2. **Root Directory:** `community`
3. Framework preset: Next.js (auto-detected).
4. Build command: `npm run build` (default).
5. Output directory: `.next` (default).
6. Environment variables: copy from [community/.env.example](.env.example). Only
   `NEXT_PUBLIC_BACKEND_URL` is required for Step 1. Auth vars arrive in Step 2.
7. Deploy.

## 2. Custom domain

1. Vercel project → **Settings → Domains → Add** → `community.dogeforge.fun`.
2. Vercel prints the DNS target. Add it on Cloudflare (or wherever the apex
   is hosted):

   | Type  | Name      | Value                     | Proxy |
   | ----- | --------- | ------------------------- | ----- |
   | CNAME | community | `cname.vercel-dns.com`    | DNS-only (grey cloud) |

   Leaving the Cloudflare proxy **off** is important — Vercel's SSL
   provisioning fails if Cloudflare's proxy is terminating the handshake.
3. SSL auto-provisions via Vercel inside ~60 seconds.

## 3. Local dev

```bash
cd community
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3001
```

Port 3001 so it coexists with `frontend` on 3000.

## 4. What's in Step 1

Only the visual shell:
- `/` landing with hero, how-it-works, category preview, final CTA
- `/connect` two-card placeholder (buttons disabled)
- `/tasks`, `/leaderboard`, `/profile` placeholders so header nav resolves
- Shared brand tokens with the main app (same Tailwind config)
- CSP + security headers mirror frontend
- PWA metadata (icons land in Step 2 alongside the auth UI)

No auth, no DB calls, no points yet. Steps 2–9 add those.
