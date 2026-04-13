# DOGE FORGE — Backend

Minimal Node/Express + SQLite service.

- `src/server.ts` — REST API (`/tokens`, `/admin/verify`, `/health`)
- `src/indexer.ts` — Polls Tempo for new tokens (Phase A integration pending)
- `src/db.ts` — SQLite schema

> **Phase C scope:** the backend is optional for the mining MVP. It exists to
> power the Trading Hub's token list once Tempo's enshrined DEX is wired in
> Phase A. You can run the frontend + contracts alone without the backend.

## Setup
```bash
cd backend
npm install
cp .env.example .env
npm run dev            # API on :4000
npm run indexer        # second terminal (optional in Phase C)
```
