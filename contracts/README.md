# DOGE FORGE — Contracts (V1 · Phase C)

Foundry workspace. Token: **TDOGE** (Tempo Doge).

> **Phase C — isolated mining.** No DEX dependency. LiquidityManager + TWAP +
> adaptive emission removed until Phase A integrates Tempo's enshrined orderbook.
> Validate the engine first, plug into Tempo rails after.

## Contracts
- **DOGE.sol** — ERC20 *Tempo Doge / TDOGE*. 21M initial hard cap + controlled post-cap linear inflation (default 1M/yr, max 5%/yr, pausable). 0.1% transfer fee (max 0.2%) routed to treasury.
- **Miner.sol** — Commit pathUSD, continuous flow at configurable rate, supply-based 3-phase emission + post-cap rate, speed tiers, admin global multiplier, pausable. Both flow sinks default to treasury until Phase A.

## Setup
```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
cp .env.example .env
forge build
forge test -vv
```

## Deploy (Tempo testnet)
```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $TEMPO_RPC_URL \
  --broadcast
```

**Required env:**
- `PRIVATE_KEY` — deployer (also becomes admin)
- `PATHUSD_ADDRESS` — pathUSD on Tempo testnet
- `TREASURY_ADDRESS` — treasury EOA or multisig
- `TEMPO_RPC_URL` — from docs.tempo.xyz (chain ID 4217)

## Post-deploy checklist (Phase C)
1. Confirm `doge.setMinter(miner, true)` + `doge.setFeeExempt(miner, true)` (auto in script).
2. Confirm `miner.liquidityManager() == treasury` (default).
3. Commit small amount (e.g. 10 pathUSD) to smoke-test `commit → flow → harvest`.
4. Tune params as needed: `setFlowRateBpsPerDay`, `setGlobalMultiplier`, `setSpeedTiers`, `setPostCapRate`, `setPhases`.
5. Transfer admin to multisig before opening to users.

## Key defaults
| Param | Default | Meaning |
|-------|---------|---------|
| Phases | 7M / 15M / 21M @ 100 / 40 / 10 TDOGE per pathUSD | Supply-based emission curve |
| `postCapRatePerPathUSD` | 0.2e18 | TDOGE per pathUSD after 21M, bounded by `DOGE.currentCap()` |
| `flowRateBpsPerDay` | 200 | 2% of committed amount converts per day |
| `globalMultiplier` | 10_000 | 1× master dial |
| Speed tiers | 0 → 1×, 100 → 1.5×, 500 → 2.5× | Based on `totalDeposited` |
| `perWalletCap` | 5_000e18 | Max lifetime commitment per wallet |
| Split | 9500 / 500 | liquidityManager / treasury (BPS) |
| DOGE `feeBps` | 10 | 0.1% transfer fee (max 20 = 0.2%) |
| DOGE `yearlyInflation` | 1_000_000e18 | Post-cap linear (max 1_050_000e18 = 5%) |

## Phase A preview
Once Tempo's enshrined-orderbook ABI is confirmed:
- New `LiquidityManager` (orderbook edition) placing flip orders from accumulated pathUSD.
- Admin calls `miner.setLiquidityManager(<new LM>)`; 95% share automatically redirects.
- Optional adaptive multiplier reintroduced using orderbook mid-price.
