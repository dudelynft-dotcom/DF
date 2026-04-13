# DOGE FORGE — TEMPO

A mining protocol + gamified economy on Tempo chain. Phase C scope: isolated
mining engine, no DEX dependency.

- **Mine** — commit pathUSD, convert continuously, earn TDOGE in real time
- **TDOGE** — 21M initial cap, controlled post-cap inflation, 0.1% transfer fee

## Status: Phase C → Phase A

| Phase | Scope | State |
|-------|-------|-------|
| **C** | Isolated mining — commit, flow, emit, treasury accumulation | ✓ ready for testnet |
| **A** | Tempo orderbook integration — flip orders, mid-price reads, replace LM | blocked on ABI |

Validate the engine first, plug into Tempo rails after.

## Monorepo layout

```
DOGE FORGE/
├─ contracts/   Foundry — Solidity contracts + tests + deploy
├─ frontend/    Next.js 14 + wagmi + viem + RainbowKit + Tailwind
└─ backend/     Node/Express + SQLite indexer (optional in Phase C)
```

## Quick start

```bash
# 1) contracts
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
cp .env.example .env && $EDITOR .env
forge test -vv

# 2) frontend
cd ../frontend
npm install
cp .env.example .env.local && $EDITOR .env.local
npm run dev

# 3) backend (optional in Phase C)
cd ../backend
npm install
cp .env.example .env
npm run dev
```

## Chain

- **Tempo** (chain ID **4217**), EVM-compatible, sub-second finality (Simplex BFT)
- **No native gas token** — fees paid in stablecoins (TIP-20), auto-converted via Fee AMM
- Explorer: `explore.testnet.tempo.xyz` / `explore.tempo.xyz`

## TDOGE tokenomics

| Piece | Value |
|-------|-------|
| Name / Symbol | Tempo Doge / **TDOGE** |
| Initial hard cap | 21,000,000 |
| Transfer fee | 0.1% → treasury (max 0.2%) |
| Post-cap inflation | 1,000,000 / year linear (max 5%/yr, pausable) |

## Mining

- **Conversion rate:** 2% of commitment per day (tunable)
- **Commitment cap:** 5,000 pathUSD per wallet (tunable)
- **Split of converted pathUSD:** 95% → liquidityManager sink, 5% → treasury (both default to treasury in Phase C)
- **Emission curve (supply-based):**

| Phase | Supply range | Rate |
|------:|--------------|------|
| I  | 0 → 7M         | 100 TDOGE / pathUSD |
| II | 7M → 15M       | 40 TDOGE / pathUSD |
| III| 15M → 21M      | 10 TDOGE / pathUSD |
| Post-cap | 21M +   | 0.2 TDOGE / pathUSD, bounded by `DOGE.currentCap()` |

Multipliers: speed tier (by commitment size) × admin global multiplier. Adaptive
layer retired in Phase C; returns in Phase A via orderbook mid-price.

## Roadmap

- **V1 Phase C** — isolated mining (now)
- **V1 Phase A** — Tempo enshrined-orderbook integration: flip orders, mid-price, real liquidity path
- **V2** — TDOGE utility: stake for fee share, boost mining with TDOGE
- **V3** — NFT system (boosters, burn-to-upgrade)
