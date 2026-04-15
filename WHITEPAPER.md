# DOGE FORGE

## A Mining-First Token Economy on Arc

**Whitepaper · Version 2.0 (Arc)**

---

> "Validate the engine first, plug into Arc rails after."
>
> — *DOGE FORGE design directive*

---

## Abstract

DOGE FORGE is a self-contained token economy built natively on Arc Network. It pairs a continuous mining engine with a hybrid trading layer and an on-chain identity registry. Users commit USDC (Arc's native gas + canonical stablecoin) into capped, supply-curve-driven mining positions that emit fDOGE — a meme-flavoured but rules-disciplined token with a 210,000,000 hard cap. Every cycle of value flowing through the system feeds liquidity back into the fDOGE / USDC pool, while user identity is layered on top through the `.fdoge` registry.

This document specifies the full system: the contracts, the multipliers, the emission curve, the liquidity loop, the trading routes, the identity registry, the security boundaries, and the roadmap. It is written to be fully reproducible from public testnet state.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Architecture](#2-system-architecture)
3. [fDOGE Token](#3-tdoge-token)
4. [Mining Mechanism](#4-mining-mechanism)
5. [Emission Curve](#5-emission-curve)
6. [Harvest Modes](#6-harvest-modes)
7. [Multiplier System](#7-multiplier-system)
8. [Liquidity System](#8-liquidity-system)
9. [Trading Layer](#9-trading-layer)
10. [.fdoge Identity Registry](#10-tdoge-identity-registry)
11. [Token Discovery](#11-token-discovery)
12. [Operational Tooling](#12-operational-tooling)
13. [Security Model](#13-security-model)
14. [Threat Model](#14-threat-model)
15. [Treasury and Fee Policy](#15-treasury-and-fee-policy)
16. [Comparative Analysis](#16-comparative-analysis)
17. [Roadmap](#17-roadmap)
18. [Risks and Disclosures](#18-risks-and-disclosures)
19. [Appendix](#19-appendix)

---

## 1. Introduction

### 1.1 The Arc Context

Arc is an EVM-compatible (Prague hard fork) Layer-1 designed as the "economic OS for the internet" — onchain capital markets, lending, payments, and FX, with deterministic sub-second finality. The defining property is that gas is paid in **USDC**, not a volatile native token: transaction costs are denominated and settled in stablecoin units, giving developers and users predictable fiat-aligned fees.

Three properties of Arc shaped DOGE FORGE materially:

- **Stablecoin-native fees.** Users do not need to acquire a separate gas token. A single USDC balance covers both transaction fees and protocol activity, collapsing onboarding friction.
- **Standard EVM with full DeFi compatibility.** UniswapV2-style AMMs, ERC-20 tokens, Multicall3, Permit2, and Account Abstraction (EntryPoint v0.7) are all supported as canonical primitives, so DOGE FORGE deploys without chain-specific workarounds.
- **Sub-second finality.** Continuous-flow accounting and live-updating UIs are practical. Users feel the loop respond in real time rather than waiting on minute-scale block windows.

DOGE FORGE pairs USDC commitments with on-chain mining accrual, deploys its own constant-product AMM for the volatile fDOGE / USDC pair, and uses Arc's fast finality for second-resolution earning displays.

### 1.2 Why DOGE FORGE

The system addresses three observations:

1. **Memetic tokens often lack discipline.** They launch with uncapped supply, ad-hoc emissions, and no mechanism to convert speculative interest into protocol-owned liquidity. DOGE FORGE inverts this: emissions are bounded, supply is hard-capped, and every act of mining contributes USDC directly into the fDOGE liquidity pool.
2. **Mining-only economies decay into pure yield extraction.** DOGE FORGE introduces a Harvest Mode lock-up choice and a commitment-size tier so larger and more patient participants are mathematically advantaged. Multipliers compound but are bounded above and below.
3. **Identity is missing on most chains.** A user's address is opaque. DOGE FORGE adds `.fdoge` names as a flat registry (not an NFT collection) where claim fees route directly into liquidity. Identity becomes both a status signal and a deflationary action against USDC demand.

### 1.3 Design Principles

| Principle | Effect |
|---|---|
| Hard caps, soft dials | The 210M supply ceiling is immutable; emission rates and bounds are admin-tunable post-launch. |
| Multipliers compose, then clamp | Speed, harvest mode, global, and adaptive multipliers all multiply together but the combined product is clamped to a `[min, max]` band so no parameter combination can blow up emissions. |
| Liquidity grows passively | Users do not need to provide LP. The mining flow itself feeds the pool. |
| Identity is not yield | `.fdoge` IDs confer no mining advantage, no fee discount, no protocol claim. They are status only. |
| Trust boundary is explicit | A single EOA admin holds protocol parameters at launch. The path to multisig is documented, not hidden. |

### 1.4 Reading Guide

This document is split into three layers:

- **Sections 1–6** describe the user-facing system: what mining looks like, the emission curve, harvest modes.
- **Sections 7–11** specify the economic and infrastructure layers: multipliers, liquidity, trading, identity, token discovery.
- **Sections 12–18** cover operations, security, threat model, treasury, comparative analysis, roadmap, and disclosures.

A pure user can read 1–6 and stop. A protocol developer should read everything. A security reviewer should read 1, 4, 7, 8, 13, 14.

---

## 2. System Architecture

### 2.1 High-Level Overview

```mermaid
flowchart TB
    User([User wallet])

    subgraph FE [Frontend: Next.js + wagmi + viem]
        Mine[Mine page]
        Trade[Trade page]
        ID[Identity page]
        LB[Leaderboard]
        Portfolio[Portfolio page]
    end

    subgraph BE [Backend services]
        Indexer[Token discovery indexer]
        API[REST API tokens / verify]
    end

    subgraph Chain [Arc Network - 5042002]
        DOGE[DOGE.sol - fDOGE token]
        Miner[Miner.sol - positions and accrual]
        LM[LiquidityManager.sol]
        Factory[TdogeFactory.sol - pair registry]
        Pair[TdogePair.sol - AMM per pair]
        Router[ForgeRouter.sol - addLiquidity / swap / 0.10 percent fee]
        Names[TdogeNames.sol - .fdoge registry]
        USDC[(USDC - Arc native gas)]
    end

    User -->|connect| FE
    FE -->|read and write| Chain

    BE -->|read events| Chain
    Indexer -->|track new contracts and Swap events| API
    FE -->|fetch token list and candles| API

    Miner -->|mint fDOGE| DOGE
    Miner -->|95 percent flowed USDC| LM
    Miner -->|5 percent flowed USDC| USDC
    Miner -->|auto-flush + seedLiquidity| LM
    LM -->|mint fDOGE side| DOGE
    LM -->|deposit into fDOGE pair| Pair
    Router -->|0.10 percent platform fee| LM
    Router -->|swap / mint LP| Pair
    Factory -->|deploys| Pair
    Names -->|claim fee| LM
```

### 2.2 Component Map

| Component | Purpose | Trust |
|---|---|---|
| `DOGE.sol` | fDOGE ERC-20 token, capped + post-cap inflation, 0.1% transfer fee | Admin: tune fee within hard cap (max 0.2%), tune inflation within hard cap (max 5%/yr) |
| `Miner.sol` | Multi-position mining, lazy accrual, harvest cooldown via mode | Admin: tune emission curve, multipliers, sinks, pause |
| `LiquidityManager.sol` | Receives 95% USDC share from Miner; mints matching fDOGE; deposits into pair | Admin: set initial price, mint budget, sweep |
| `TdogePair.sol` | Constant-product AMM per trading pair, 0.30% LP fee | None — immutable pair, standard UniV2 mechanics |
| `TdogeFactory.sol` | Registry + deployer of `TdogePair` instances, keyed by sorted `(tokenA, tokenB)` | Admin: `registerPair` (bind pre-existing pairs into the map, once) |
| `ForgeRouter.sol` | Multi-pair router: `addLiquidity`, `removeLiquidity`, path-based `swapExactTokensForTokens`; 0.10% platform fee skim on swap input → LM | Admin: toggle fee on/off, tune fee bps (max 0.50%), set fee recipient, pause, pair whitelist |
| `TdogeNames.sol` | `.fdoge` identity registry, 5,000 cap, fee routes to LM | Admin: set cost, sink, open/close claims |

### 2.3 Trust Boundaries

```mermaid
flowchart LR
    subgraph Immutable [Immutable on deploy]
        IC1[fDOGE INITIAL_CAP - 210M]
        IC2[Pair token addresses - sorted]
        IC3[LP fee - 0.30%]
        IC4[TdogeNames MAX_SUPPLY - 5000]
    end

    subgraph Bounded [Admin-tunable, hard ceiling]
        T1[Transfer fee max 0.20%]
        T2[Yearly inflation max 5% of cap]
        T3[Effective mult band]
    end

    subgraph Open [Admin-tunable, no protocol ceiling]
        O1[Phase rates]
        O2[Commitment tiers]
        O3[Harvest modes]
        O4[Global multiplier]
        O5[Reference price]
        O6[Per-wallet cap]
    end

    Bounded --> Pause[Admin can pause Miner]
```

The intention is that the parts a user could be economically harmed by (cap, fee ceiling, inflation ceiling) are immutable or hard-bounded, while the parts that need post-launch tuning (rates, multipliers, caps) remain adjustable. The pause switch is a circuit breaker — it stops new commits and harvests but cannot move user funds.

### 2.4 End-to-End Data Flow

```mermaid
flowchart LR
    pUSD[User USDC] -->|commit| MP[Miner Position]
    MP -->|accrual| PD[pendingDoge]
    MP -->|accrual| PL[pendingLiquidity]
    MP -->|accrual| PT[pendingTreasury]
    PD -->|harvest| MintTo[fDOGE to user]
    PL -->|flush| LMBal[LiquidityManager USDC]
    PT -->|flush| Tre[Treasury wallet]
    LMBal -->|seedLiquidity| Pool[(fDOGE/USDC pool)]
    Pool -->|swaps| Trades[Market activity]
    Trades -->|0.30% LP fee| Pool
```

A USDC unit entering the system follows a deterministic path: commitment → flow accrual → split into pending counters → flush to either user (via fDOGE mint) or pool (via LM seed) or treasury. Once in the pool, it earns 0.30% LP fee on every trade until withdrawn through LP burn.

---

## 3. fDOGE Token

### 3.1 Specification

| Field | Value |
|---|---|
| Name | Doge Forge |
| Symbol | fDOGE |
| Standard | ERC-20 (intended ERC-20 compatible) |
| Decimals | 18 |
| Initial hard cap | 210,000,000 |
| Transfer fee | 0.10% (admin-tunable, max 0.20%) |
| Fee destination | `feeTreasury` |
| Post-cap inflation | 10,000,000 / year linear (admin-tunable, max 5%/yr, pausable) |
| Mint authority | Whitelisted minter contracts only |

### 3.2 Supply Schedule

The supply rules are layered:

1. **Phase mining (0 → 210M)** — fDOGE is created by `Miner.sol` against USDC flow. The emission curve (§5) controls the rate.
2. **LP seeding** — `LiquidityManager.sol` mints additional fDOGE against incoming USDC to provision the pair. This counts toward the same 210M cap, drawn from the LM's own mint budget.
3. **Post-cap inflation** — Once `totalSupply()` first reaches `INITIAL_CAP`, an anchor timestamp is recorded. From that moment forward, `currentCap()` grows linearly at the configured `yearlyInflation` rate. New mints (still gated by minter authority) can fill the moving ceiling.

Formally:

```
currentCap(t) = INITIAL_CAP                              if t < anchor
              = INITIAL_CAP + (t - anchor) × yearlyInflation / YEAR    otherwise
```

The hard ceiling on `yearlyInflation` itself is `MAX_YEARLY_INFLATION = 10,500,000` (5% of `INITIAL_CAP`). Admin may set inflation to zero at any time.

### 3.3 Transfer Fee

Every transfer routes a `feeBps`/10,000 fraction to `feeTreasury` before the recipient receives the residual. Mint and burn paths bypass the fee. Per-address allowlists (`feeExempt`) cover protocol contracts so internal flows do not pay fee. Pair contracts are intentionally **not** exempt: every DEX trade contributes fee revenue to treasury.

```mermaid
flowchart LR
    A[from] -->|value| Hook{_update}
    Hook -->|from is zero| Mint[Mint - no fee]
    Hook -->|to is zero| Burn[Burn - no fee]
    Hook -->|either is exempt| Direct[Direct transfer]
    Hook -->|standard transfer| Split
    Split -->|0.1 percent| FT[(feeTreasury)]
    Split -->|99.9 percent| To[to]
```

### 3.4 Post-Cap Inflation

The post-cap regime is intentionally minimal: a slow linear drip to keep mining incentives alive after the curve closes. The Miner contract reads `DOGE.currentCap()` at every accrual; if the supply is below the moving cap, a tiny `postCapRatePerPathUSD` (default 0.2 fDOGE per USDC flowed) emission applies. If admin sets `yearlyInflation = 0`, the cap becomes flat and post-cap mining produces nothing.

### 3.5 Supply Allocation by Phase

The 210M mining supply is distributed across the four phases by their respective ranges:

```mermaid
pie showData
    title fDOGE supply distribution by emission phase
    "Phase 0 (0 to 10M)"   : 10
    "Phase 1 (10M to 70M)" : 60
    "Phase 2 (70M to 150M)": 80
    "Phase 3 (150M to 210M)": 60
```

Phase 2 absorbs the largest portion (38.1% of supply) at a moderate rate, balancing distribution depth with scarcity preservation. Phase 0 is the smallest (4.76%) but uses the highest rate to reward bootstrap participants disproportionately for taking risk before the system has on-chain liquidity.

---

## 4. Mining Mechanism

### 4.1 Commit-Flow-Harvest Loop

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Miner
    participant DOGE
    participant LM as LiquidityManager
    participant Pair as TdogePair

    User->>Miner: commit(amount, mode)
    activate Miner
    Miner->>Miner: accrue all open positions
    Miner->>Miner: pull USDC, push new Position
    deactivate Miner

    loop Background time
        Note over Miner: position.remaining decreases<br/>at flowRateBpsPerDay
    end

    User->>Miner: harvest(positionId)
    activate Miner
    Miner->>Miner: accrue this position
    alt unlock time reached
        Miner->>DOGE: mint pendingDoge to user
        DOGE-->>User: fDOGE tokens
    else still locked
        Miner-->>User: revert RewardsLocked
    end
    deactivate Miner

    Note over Miner,LM: Permissionless flush
    User->>Miner: flush()
    Miner->>LM: transfer pendingLiquidity in USDC
    Miner->>Miner: transfer pendingTreasury

    User->>LM: seedLiquidity()
    LM->>DOGE: mint matching fDOGE from budget
    LM->>Pair: deposit USDC + fDOGE
    Pair->>LM: LP tokens
```

### 4.2 Multi-Position Model

Each call to `commit(amount, mode)` opens a **new Position** rather than topping up an existing one. A wallet may hold multiple positions in parallel, each with its own:

- `totalDeposited` — original commitment size
- `remaining` — USDC still to flow
- `lastUpdate` — accrual timestamp
- `mode` — chosen Harvest Mode index (0 = Instant, 1 = Monthly, 2 = Long-Term)
- `unlockAt` — earliest timestamp for harvest
- `pendingDoge` — accrued but unclaimed fDOGE
- `open` — closes on full conversion + claim

The per-wallet cap (default 10,000 USDC) applies to the **sum** of open positions' `totalDeposited`. There is also a `maxPositionsPerWallet` ceiling (default 10) for gas safety, since accrual loops across all open positions on commit.

### 4.3 Conversion Rate

Each open position converts USDC at a configurable `flowRateBpsPerDay` (default 200 bps = 2% per day, computed against the original `totalDeposited`). The flow accumulates **lazily** — it only updates state when the position is touched (commit, harvest, or accrue via another commit on the same wallet).

```
elapsed = block.timestamp - position.lastUpdate
flowed  = totalDeposited × flowRateBpsPerDay × elapsed / (BPS × SECONDS_PER_DAY)
flowed  = min(flowed, position.remaining)
```

At 2% / day a position drains to zero in 50 days exactly. A 100 USDC commitment flows 2 USDC per day for 50 days. Time spent without touching the position does not affect the eventual total — the user can ignore the position for 50 days and harvest once at the end with identical economics to a daily-poker.

### 4.4 Lazy Accrual: Why It Matters

Because flow only updates on touch, the protocol does not need a global per-second accumulator. Every position's state is purely local:

- A position never accrues when nobody is paying gas to update it.
- The `Miner` contract's storage stays bounded regardless of user count.
- Users who walk away and come back months later receive *exactly* what they would have received with continuous polling.

The trade-off: pending counters (`pendingLiquidity`, `pendingTreasury`) only reflect realised flow. The in-contract auto-flush (§12.1) ensures these counters drain into the pool whenever activity reaches the configured threshold or interval.

### 4.5 Sink Allocation

When USDC flows, it is split into two sinks:

```mermaid
flowchart LR
    F[Flowed USDC] -->|95 percent| LM[LiquidityManager pending]
    F -->|5 percent| Tr[Treasury pending]
    LM -->|flush| LMSink((LiquidityManager))
    Tr -->|flush| TrSink((Treasury))
    LMSink -->|seedLiquidity| Pool[(fDOGE/USDC pool)]
```

The split is parameterised (`liquidityBps`, `treasuryBps`) and must sum to 10,000. The default 95/5 reflects the design priority that the protocol owns its liquidity rather than paying out the conversion to a treasury wallet.

### 4.6 Position State Machine

```mermaid
stateDiagram-v2
    [*] --> Open: commit(amount, mode)
    Open --> Open: accrual touches position
    Open --> Open: harvest before unlockAt — RewardsLocked revert
    Open --> ReadyToClaim: block.timestamp >= unlockAt
    ReadyToClaim --> Open: harvest (remaining > 0)
    ReadyToClaim --> Closed: harvest (remaining == 0)
    Closed --> [*]
```

A Position lives through three meaningful states: `Open` (pre-unlock or unclaimed-but-still-active), `ReadyToClaim` (unlock passed), and `Closed` (fully drained and final harvest done). The slot is freed only on Closed; new commits open new positions until the cap.

---

## 5. Emission Curve

### 5.1 Phase Structure

The emission curve is **supply-based**, not time-based. The active rate is determined by the current `DOGE.totalSupply()` at the time of accrual.

| Phase | Supply range | Rate (fDOGE / USDC) | Intent |
|---|---|---|---|
| 0 | 0 → 10M | **200** | Bootstrap |
| 1 | 10M → 70M | 100 | Early growth |
| 2 | 70M → 150M | 40 | Stabilisation |
| 3 | 150M → 210M | 10 | Scarcity |
| Post-cap | 210M+ | 0.2 | Long-tail incentive bounded by `currentCap()` |

### 5.2 Curve Diagram

```mermaid
flowchart LR
    P0["Phase 0<br/>0 to 10M<br/>200 per USDC"] --> P1
    P1["Phase 1<br/>10M to 70M<br/>100 per USDC"] --> P2
    P2["Phase 2<br/>70M to 150M<br/>40 per USDC"] --> P3
    P3["Phase 3<br/>150M to 210M<br/>10 per USDC"] --> PC
    PC["Post-cap<br/>210M+<br/>0.2 per USDC<br/>capped by inflation"]
```

### 5.3 Boundary-Crossing Accrual

A single accrual can span multiple phases. The contract handles this exactly: it walks the phase table, consuming as much of the flow as the current phase has headroom for, then advances to the next phase with the remainder. This guarantees that the supply ceiling for a phase is never exceeded by even one wei.

### 5.4 Worked Example: Boundary Cross

Assume current `totalSupply = 9,950,000` fDOGE (Phase 0, 50,000 of headroom remaining), and a single accrual would naturally emit 300 fDOGE under Phase 0 rate parameters.

Step-by-step:

1. Phase 0 has `headroom = 10,000,000 - 9,950,000 = 50,000`.
2. The accrual's natural emission of 300 fDOGE fits within headroom → emit 300 fDOGE at Phase 0 rate. Done.

Now assume the accrual would naturally emit 80,000 fDOGE under Phase 0:

1. Phase 0 headroom = 50,000. Natural emission 80,000 > 50,000.
2. Emit exactly 50,000 fDOGE in Phase 0. Compute USDC-equivalent consumed: `flowUsed = 50,000 / 200 = 250 USDC`.
3. Subtract from remaining flow. Advance to Phase 1.
4. Recompute remaining-flow's emission at Phase 1's 100/USDC rate.

The user receives the proper sum; supply lands exactly at 10,000,000 (the phase boundary) before crossing.

### 5.5 Post-Cap Behavior

Once supply reaches 210M, mining continues at the much-reduced post-cap rate, but every emission is bounded by `DOGE.currentCap()` — which itself only grows at the configured yearly inflation. If admin pauses inflation, `currentCap()` is flat and post-cap emissions become impossible.

This is intentional: post-cap mining keeps the engine running for engagement, but it cannot inflate supply faster than the chosen yearly rate. The 0.2 default rate × the protocol's expected daily flow puts emission well below the inflation ceiling under any realistic scenario.

---

## 6. Harvest Modes

### 6.1 Three Modes

| Mode | Boost | Lock | Intent |
|---|---|---|---|
| 0 — Instant | 1.00× | none | Liquidity for active traders |
| 1 — Monthly | 1.20× | 30 days | Mid-term commitment |
| 2 — Long-Term | 1.50× | 180 days | Maximum boost, patient capital |

Mode is **chosen at the moment of commit** and stored on the Position. It cannot be changed later for that position. Subsequent commits open new positions and can pick different modes.

### 6.2 Cycle Lifecycle

A position's cycle traverses (see §4.6 state machine).

A position closes when:
1. `remaining` reaches zero (all USDC has flowed), AND
2. The user calls `harvest()` once unlocked — which mints the final pending fDOGE and flips `open = false`.

A closed position's slot frees up and can be replaced by a new `commit()` (subject to the `maxPositionsPerWallet` ceiling).

### 6.3 Compounding Multipliers

Harvest Mode is one of four multiplier inputs. They compose multiplicatively. See §7 for the full system.

### 6.4 Why Three Lock Tiers

The mode set was chosen to span three distinct user archetypes:

| Archetype | Mode | Why |
|---|---|---|
| Active trader | Instant | Wants fDOGE liquid the moment it accrues, willing to accept the lowest boost. |
| Patient holder | Monthly | Accepts a 30-day pause for a 20% premium. Reasonable for a believer. |
| Conviction stake | Long-Term | 180-day lock for 50% premium. Signals intent to hold beyond a single market cycle. |

Adding more tiers would dilute the signalling. Removing one would force users into a worse fit. The three-tier set has the shortest description that still maps onto distinguishable behaviours.

---

## 7. Multiplier System

### 7.1 Components

```mermaid
flowchart LR
    C[Commitment tier<br/>by position size] -->|x| E
    M[Harvest mode<br/>1.0 / 1.2 / 1.5] -->|x| E
    G[Global multiplier<br/>admin dial] -->|x| E
    A[Adaptive multiplier<br/>price band] -->|x| E
    E[Effective multiplier] -->|clamp| Out[min max band]
    Out -->|x phase rate| Mint[fDOGE emitted]
```

### 7.2 Commitment Tier

Per-position size determines a tier:

| Position size (USDC) | Boost |
|---|---|
| < 100 | 1.00× |
| 100 to 999 | 1.10× |
| 1,000 to 4,999 | 1.25× |
| 5,000 and above | 1.50× |

Tiers are stored as a sorted array on the contract; admin may replace the table. The effective tier is determined per-position at the time of accrual using that position's `totalDeposited`.

### 7.3 Adaptive Multiplier (Profitability Band)

The adaptive layer is a soft mechanism to keep mining value-per-USDC near a configured target, even as the active phase rate drops. It uses an admin-set reference fDOGE price (in USDC per whole fDOGE, 1e18-scaled). The contract computes:

```
valueOut    = phaseRate × referencePrice / 1e18                // USDC value of 1 USDC committed
adaptiveBps = targetValueBps × 1e18 / valueOut                // raw scaling factor
adaptiveBps = clamp(adaptiveBps, adaptiveMinBps, adaptiveMaxBps)
```

Defaults: `targetValueBps = 10_000` (1.0 USDC value per USDC committed), `[adaptiveMinBps, adaptiveMaxBps] = [8_000, 11_000]` — the multiplier can soften to 0.80× or stretch to 1.10×, no further. When `adaptiveEnabled = false` or `referenceTdogePrice = 0`, the adaptive component returns 1.00×.

### 7.4 Effective Multiplier Bounds

The product of all four multipliers is clamped to `[minEffectiveMultBps, maxEffectiveMultBps]` (defaults 0.25× / 10×). This guarantees that no parameter combination — even an adversarial admin update — can take emissions outside this band.

### 7.5 Worked Example

A wallet commits **2,000 USDC** in Long-Term Mode during Phase 0:

| Component | Value |
|---|---|
| Phase rate (Phase 0) | 200 fDOGE / USDC |
| Commitment tier (1,000–4,999) | 1.25× |
| Harvest Mode (Long-Term) | 1.50× |
| Global multiplier | 1.00× |
| Adaptive (disabled) | 1.00× |
| **Effective multiplier** | **1.875×** |
| **Effective rate** | **375 fDOGE / USDC** |

Daily flow at 2%/day = 40 USDC. Daily emission = 40 × 375 = **15,000 fDOGE**. Rewards lock for 180 days; on unlock the user can claim or continue accruing.

### 7.6 Derivation of the Combined Formula

The full per-accrual emission is:

```
flowed       = totalDeposited × flowRateBpsPerDay × elapsed / (BPS × SECONDS_PER_DAY)
multBps      = clamp(commBps × globalBps × modeBps × adaptiveBps / BPS^3,
                     minEffectiveMultBps, maxEffectiveMultBps)
emission     = flowed × phaseRate × multBps / (USDCUnit × BPS)
```

Where `USDCUnit = 10^USDCDecimals` (1e6 for Arc's USDC). This formula is decimal-aware: `flowed` is in USDC-wei (6-dec), `phaseRate` is "fDOGE per whole USDC" (18-dec), and the result is in fDOGE-wei (18-dec).

The clamp on `multBps` is the safety rail. Even if adaptive misbehaves, an admin sets a runaway `globalMultiplier`, or speed tiers are replaced with extreme values, the per-emission output cannot exceed `maxEffectiveMultBps × phaseRate × flowed`. With defaults that ceiling is 10× the base phase rate.

---

## 8. Liquidity System

### 8.1 The Constant-Product Pair

`TdogePair.sol` implements a Uniswap V2-style AMM. Each pair is a standalone contract with two tokens sorted by address at construction, 0.30% LP fee retained by LPs through the standard k-invariant, and its own LP token (`DOGE FORGE LP`, symbol `DFLP`). The flagship fDOGE / USDC pair is the emission sink for the Miner → LiquidityManager flow; additional pairs (EURC/USDC, USYC/USDC, WUSDC/USDC, and any future token a user chooses to open) are deployed on demand via the factory.

### 8.1b Factory & Router

`TdogeFactory.sol` is a permissionless pair registry. Anyone can call `createPair(tokenA, tokenB)` to open a new market; the factory deterministically deploys a new `TdogePair` and stores it under the sorted-address key. It also exposes an admin-only `registerPair(a, b, pair)` used once at launch to absorb the fDOGE/USDC pair that predates the factory — the function verifies the external pair's `token0` / `token1` match before binding it to prevent accidental misrouting.

`ForgeRouter.sol` is the user-facing entry point for every trade and liquidity action on the DEX:

- `addLiquidity(tokenA, tokenB, …)` — creates the pair lazily if missing, quotes optimal amounts against current reserves, pulls funds, mints LP to the caller.
- `removeLiquidity(…)` — burns LP and returns the two sides. Intentionally **not** pausable/whitelisted so users can always withdraw.
- `swapExactTokensForTokens(amountIn, minOut, path, to, deadline)` — path-based (`[fDOGE, USDC]`, `[EURC, USDC]`, or any multi-hop) with standard V2 fee-adjusted math.
- `getAmountsOut` / `getAmountsOutAfterFee` — view helpers the UI uses for live quotes.

The router owns the protocol fee: on every swap it skims **0.10%** of the input token on entry, transfers it to the `LiquidityManager`, then forwards the remaining 99.90% into the pair chain. The fee is admin-toggleable and capped at 0.50%. fDOGE swaps pay the same 0.10% platform fee plus the standard 0.30% LP fee — since the protocol owns the fDOGE LP position, those LP fees accrue right back to LiquidityManager, so effectively every fDOGE trade rebates into the pool.

Why a custom DEX? Arc is a young stablecoin-native L1 with no depth yet on third-party AMMs. Rather than route users through thin external pools (or ask them to trust an unaudited aggregator we don't control), DOGE FORGE owns the complete liquidity and trading layer. The stack is standard UniswapV2 mechanics — battle-tested since 2020 — plus two operational guardrails: a pause switch on swap/addLiquidity (never on removeLiquidity) and an optional pair-whitelist mode the admin can flip on during incident response.

### 8.2 Automated Liquidity Loop

```mermaid
flowchart TB
    UC[User commits USDC] --> M[Miner pendingLiquidity grows]
    UH[User harvests / commits more] -.touches accrual.-> M
    M -->|auto-flush at threshold or interval| LM[LiquidityManager USDC balance]
    LM -->|mint matching fDOGE| DOGE[(DOGE)]
    LM -->|deposit both sides| Pair[(TdogePair)]
    Pair -->|LP tokens| LM
```

Liquidity flushing happens **on-chain, automatically**. At the end of every user-facing write (`commit`, `deposit`, `harvest`, `harvestAll`), the Miner's `_maybeAutoFlush()` checks whether `pendingLiquidity ≥ autoFlushThreshold` (default 100 USDC) **or** at least `autoFlushIntervalSec` (default 1 hour) has elapsed since the last flush. If either condition is met, the Miner transfers the pending USDC to the LiquidityManager and invokes `seedLiquidity()` in the same transaction.

The seed call is wrapped in `try/catch`: if `LiquidityManager.seedLiquidity` ever reverts (e.g. mint budget exhausted), an `AutoFlushSeedFailed` event is emitted and the user's mining transaction still succeeds. There is no off-chain keeper, no privileged keeper key, and no operational dependency on a backend loop. The public `flush()` function still exists as a manual fallback — anyone may call it to force-process the backlog.

### 8.3 LM Mint Budget

`LiquidityManager.dogeMintBudget` is the maximum fDOGE the LM may mint over its lifetime to provision the pair's fDOGE side. It is set at deploy (default 21,000,000 — 10% of cap) and counts toward the 210M ceiling. If the budget is exhausted, future seed calls revert with `BudgetExceeded` and an admin must increase it.

### 8.4 Initial Price vs Pool Mirror

On the very first `seedLiquidity()` (pool is empty), LM uses the admin-set `initialDogePerPathUSD` (default 100 fDOGE per USDC) to size the fDOGE side. On subsequent seeds, LM mirrors the current pool ratio so liquidity adds at the prevailing market price without slippage.

### 8.5 Liquidity Growth Trajectory

Assume a steady state with `N` users, each holding an average open position of `D` USDC, all in Instant mode for simplicity. Daily USDC flow into the protocol is:

```
F_daily = N × D × flowRateBpsPerDay / 10000
```

Of which 95% (default) routes to LM, becoming the daily new USDC entering the pool:

```
P_daily_in = F_daily × 0.95
```

As the auto-flush fires on user activity, the pool grows at roughly:

```
ΔReserve_USDC per day = P_daily_in
ΔReserve_fDOGE   per day = P_daily_in × poolPriceRatio   // at current pool price
```

With 100 users averaging 500 USDC in commitments, daily flow is `100 × 500 × 0.02 = 1,000 USDC`. After a 30-day period, the pool gains `1,000 × 0.95 × 30 = 28,500 USDC` of one-sided value plus the matching fDOGE side, for a total liquidity addition of `~57,000 USDC-equivalent`.

This compounds into the price surface: as the pool grows, the slippage of any given trade size shrinks. The system is self-reinforcing: more mining → more liquidity → tighter market → more usage.

### 8.6 LP Token Ownership

The LP tokens issued by `TdogePair.mint` are held by `LiquidityManager` (the caller). LM never burns them autonomously — the protocol owns its liquidity by default. Future governance can decide whether to:

- Hold LP indefinitely (current behaviour).
- Distribute LP to long-term holders, treasury, or community.
- Burn LP slowly to give back to the pool (rare, but possible).

The choice is post-launch and reversible. Until governance acts, all LP from mining flow accrues to LM.

---

## 9. Trading Layer

### 9.1 Routing Logic

```mermaid
flowchart TD
    U[User opens trade modal for token X] --> Q{Factory.getPair token,USDC != 0}
    Q -->|yes| R[ForgeRouter.swapExactTokensForTokens path=token,USDC]
    R -->|0.10 percent input| LM[(LiquidityManager)]
    R -->|99.90 percent| P[(TdogePair)]
    Q -->|no| N[No route - pool not opened yet]
```

Every swap on DOGE FORGE goes through the same router, regardless of which pair. The frontend calls `Factory.getPair(token, USDC)` to verify a pool exists, then `ForgeRouter.getAmountsOutAfterFee` for the displayed quote. Approval is always set on the router. Settlement happens on Arc in a single transaction; DOGE FORGE never custodies funds during a swap — the router pulls the input, skims the 0.10% platform fee, and forwards the remainder into the pair chain in one atomic tx.

### 9.2 ForgeRouter (all swaps)

`ForgeRouter.swapExactTokensForTokens(amountIn, minOut, path, to, deadline)` executes:

1. Verify every hop exists in the factory (and is whitelisted if admin has enabled whitelist mode).
2. `transferFrom` the full input amount into the router.
3. Skim `platformFeeBps` (default 0.10%) of the input, transfer to the fee recipient (LiquidityManager).
4. Transfer the net input into the first pair and walk the path hop-by-hop via `pair.swap` — each intermediate output lands in the next pair, the final output in the user's `to` address.
5. Revert if the final output is below `minOut` or the deadline has passed.

View helpers — `getAmountsOut(amountIn, path)` (pre-fee) and `getAmountsOutAfterFee(amountIn, path)` (post-fee) — let the UI quote without a simulation. The router itself holds no state for users; all balances live in the pair contracts.

### 9.3 Opening New Markets

`Factory.createPair(tokenA, tokenB)` is permissionless. Any user (or the router, lazily inside `addLiquidity`) can deploy a fresh `TdogePair` for any ERC-20 / ERC-20 combination. Once the pair exists, it shows up in the discovery index and becomes tradable as soon as someone seeds it with `ForgeRouter.addLiquidity`. The admin-only `registerPair` exists solely to bind the historical fDOGE/USDC pair into the map at launch; under normal operation it is never called.

### 9.4 Slippage Model

The trade modal exposes 0.5% / 1% / 3% / 5% slippage presets. `minOut` is computed as `quoteOut × (10_000 - slippageBps) / 10_000`. If executed price diverges past the preset, the swap reverts at the chain level — funds remain with the user.

### 9.5 Failure Modes

| Failure | Cause | UX outcome |
|---|---|---|
| `K` invariant violation | Sandwiching or stale quote | Tx reverts, user retries with fresh quote |
| `InsufficientLiquidity` | Pool empty or one side near-zero | Disabled in UI when reserves below threshold |
| `InsufficientOutput` | Slippage exceeded | Tx reverts, user widens slippage |
| `ExpiredDeadline` | Wallet held tx >5 min | Tx reverts, user resubmits |

---

## 10. .fdoge Identity Registry

### 10.1 What It Is

`TdogeNames.sol` is a flat on-chain registry binding lowercase alphanumeric names (`a-z`, `0-9`, `-`, 1–20 chars, no leading/trailing hyphen) to wallet addresses. Each entry is displayed as `name.fdoge`. **It is not an NFT**: there is no ERC-721 contract, no transferable token. It is a status layer.

The registry imposes no impact on mining: holding a name does not affect emission rate, multipliers, fees, or any economic parameter elsewhere.

### 10.2 Eligibility & Cost

| Property | Value |
|---|---|
| Total supply | 5,000 |
| Eligibility | Any wallet with `Miner.positionCount(user) > 0` |
| Cost | 0.10 USDC (admin-tunable) |
| Fee destination | `LiquidityManager` (100% routed to fDOGE liquidity) |
| Mints per wallet | 1 |
| Name uniqueness | Enforced at contract level |

### 10.3 Liquidity-Routed Fees

```mermaid
flowchart LR
    U[User] -->|claim with 0.1 USDC| N[TdogeNames]
    N -->|safeTransferFrom user to LM| LM[(LiquidityManager)]
    LM -.in same tx.-> Pair[(TdogePair pool grows)]
```

Each claim is a small, additive deposit into the liquidity pool. 5,000 names × 0.10 USDC = 500 USDC of bonus liquidity if the registry fills, on top of the mining-driven baseline.

### 10.4 Identity Economics

The registry creates three distinct effects:

1. **Direct deflationary action**: every claim spends 0.10 USDC that is routed to liquidity, growing the pool's USDC side by exactly the spent amount. Unlike most "name service" tokens that route fees to treasury or burn, every claim here is a small, additive provision-of-liquidity event.
2. **Status signal**: a `name.fdoge` persists across the app — header, leaderboard, mining page, portfolio. It functions as a public on-chain badge of early participation.
3. **Coordination primitive for future products**: future drops, governance, or PFP collections can read `nameOf(address)` to determine eligibility without re-doing whitelisting. The registry becomes the single source of truth for "who is a participant" in the DOGE FORGE community.

The 5,000 cap is intentional: it creates scarcity (statistically only the first ~5K committers can claim) without being so small as to be elitist.

---

## 11. Token Discovery

### 11.1 Indexer Architecture

The backend runs a token discovery service that scans Arc blocks for contract creations, probes each new contract for ERC-20 / ERC-20 compliance (`symbol`, `name`, `decimals`), and persists discoveries into a SQLite store. Discovered tokens land in the `unverified` bucket by default.

```mermaid
flowchart LR
    Chain[Arc blocks] -->|getBlock + receipts| Scanner[Indexer loop]
    Scanner -->|filter contractAddress field| Probe[Probe ERC20 metadata]
    Probe -->|valid| Insert[Insert as unverified]
    Probe -->|invalid| Drop[Discard]
    Insert --> DB[(SQLite tokens)]
    DB -->|GET /tokens| FE[Trade page]
    Admin -->|POST /admin/verify| DB
```

### 11.2 Verification

An admin endpoint (`POST /admin/verify`) flips the `verified` flag on a token. Verified tokens render alongside the curated list in the Trade UI; unverified ones render in a separate section with a "verify before trading" disclaimer. Verification is purely a UX signal — it does not change anything on-chain.

### 11.3 Discovery → Trading

Discovered tokens are surfaced as View-only entries until an admin verifies them. DOGE FORGE does not deploy AMM pairs for arbitrary discovered tokens (out of scope); users wanting to trade them route through any third-party Arc DEX. The indexer's job is purely discovery + metadata collection so the Trade page can show what is being deployed in the broader Arc ecosystem.

---

## 12. Operational Tooling

### 12.1 In-Contract Auto-Flush

Liquidity flushing runs **inside the Miner**, not in a separate off-chain process. At the end of `commit`, `deposit`, `harvest`, and `harvestAll`, `_maybeAutoFlush()` evaluates whether to fire:

- **Threshold trigger** — `pendingLiquidity ≥ autoFlushThreshold` (default 100 USDC).
- **Interval trigger** — `pendingLiquidity > 0` and `block.timestamp ≥ lastAutoFlushAt + autoFlushIntervalSec` (default 1 hour).

When triggered, the Miner transfers the pending USDC + treasury cuts, then calls `LiquidityManager.seedLiquidity()` in a `try/catch` block. A revert in the seed call emits `AutoFlushSeedFailed(bytes reason)` and lets the user's transaction succeed normally — never a stuck mine/harvest.

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Miner
    participant LM as LiquidityManager
    participant Pair

    User->>Miner: commit / harvest
    Miner->>Miner: _maybeAutoFlush()
    alt threshold met OR interval elapsed
        Miner->>LM: transfer pending USDC
        Miner->>LM: try seedLiquidity()
        LM->>Pair: deposit both sides
        Pair-->>LM: LP tokens
    end
    Miner-->>User: success
```

There is no keeper, no funded EOA, no operational dependency. The unlucky user whose transaction crosses the threshold pays a small extra gas cost (~30–50%) for that single tx. Admin can tune `autoFlushEnabled`, `autoFlushThreshold`, `autoFlushIntervalSec` via setters, or call the public `flush()` manually at any time.

### 12.2 Token Discovery Indexer

A second loop that walks recent block ranges for contract-creation transactions, probes ERC-20 metadata, and stores discoveries. Configurable parameters:

- `INDEXER_RANGE` — blocks per scan tick (default 200)
- `INDEXER_POLL_MS` — sleep between ticks (default 10s)
- `INDEXER_START_BLOCK` — bootstrap cursor (default: head − range)

The indexer is also stateless; cursor is persisted to SQLite. Restarting picks up exactly where it left off.

### 12.3 Frontend Architecture

```mermaid
flowchart LR
    Pages[Pages: Mine / Trade / Identity / Leaderboard / Portfolio]
    Pages --> Hooks[wagmi + viem hooks]
    Hooks --> RPC[Arc RPC]
    Pages --> Toaster[Toast queue]
    Pages --> Modal[TradeModal]
    Pages --> Backend[Backend REST]
    Modal --> SendTx[lib/tx.ts: sendTx + ensureArcChain]
    SendTx --> RPC
```

`lib/tx.ts` centralises chain switching (with EIP-3085 add-chain fallback) and write-tx wrapping so every page submits transactions through the same path. This means a single bug fix in chain handling propagates everywhere.

### 12.4 Failure Modes & Recovery

| Failure | Effect | Recovery |
|---|---|---|
| Auto-flush stalled | If user activity drops to zero, flushes pause | Any address can call `flush()` + `seedLiquidity()` permissionlessly |
| Indexer offline | New tokens stop being discovered | Restart indexer; cursor resumes |
| Backend offline | Trade page shows curated list only | Pages still function; unverified bucket empty |
| RPC unavailable | All on-chain reads fail | Retry; viem auto-retries |
| Wallet on wrong chain | Reads pinned to Arc work; writes prompt switch | Chain-switch banner + auto-trigger |

The architecture is designed so any single off-chain component can fail without breaking the on-chain state. The contracts are the source of truth.

---

## 13. Security Model

### 13.1 Admin Powers and Constraints

| Power | Scope | Hard Bound |
|---|---|---|
| Mint fDOGE | `Miner` and `LiquidityManager` only (whitelisted minters) | `currentCap()` always enforced inside `DOGE.mint` |
| Pause Miner | Stops `commit` and `harvest` | Cannot move user funds |
| Tune emission curve | Replace phase table | Cannot exceed `INITIAL_CAP` per phase threshold |
| Tune multipliers | Speed tier, modes, global, adaptive | Combined product clamped to effective band |
| Set transfer fee | DOGE | Hard ceiling 0.20% |
| Set yearly inflation | DOGE | Hard ceiling 5% of cap |
| `adminWithdrawPathUSD` | Miner | **Pulls any USDC held by Miner contract** — operator concession to recover stuck funds |

The `adminWithdrawPathUSD` function is the most concentrated admin power: it allows the operator to drain USDC held by Miner (typically funds in transit between accrual and `flush`). It exists because Miner holds user-deposited capital and there must be a path to recover funds in a stuck-state scenario. The plan is to migrate ownership of `Miner` and `DOGE` to a multisig before the system handles material TVL. This is documented as a known constraint, not hidden.

### 13.2 Reentrancy and Safe Transfers

Every state-mutating function on `Miner`, `LiquidityManager`, `TdogePair`, and `TdogeNames` carries `nonReentrant`. All ERC-20 calls go through OpenZeppelin's `SafeERC20` so non-standard token return values cannot break flows.

### 13.3 Cap Enforcement Layers

Three layers guarantee fDOGE supply cannot exceed the configured ceiling:

1. **`DOGE.mint`** rejects any mint that would push `totalSupply` above `currentCap()`.
2. **`Miner._computeEmission`** clamps emission at the active phase's headroom and the post-cap headroom (`currentCap() - supply`).
3. **`LiquidityManager.seedLiquidity`** rejects mints that exceed its dedicated `dogeMintBudget`.

A revert in any of these would leave the system in a consistent state — USDC already deposited is not lost, only the over-cap mint is rejected.

### 13.4 Path to Multisig

The launch admin is a single EOA. Before the protocol holds material value:

1. Deploy a 3-of-5 (or similar) Safe multisig.
2. Transfer ownership of `DOGE`, `Miner`, `LiquidityManager`, `TdogeNames` via `transferOwnership`.
3. Document the operational runbook for incident response and parameter tuning.

---

## 14. Threat Model

### 14.1 Attack Surface Map

```mermaid
flowchart TB
    subgraph A1 [Contract-level]
        S1[Reentrancy] --> M1[OZ ReentrancyGuard]
        S2[Integer overflow] --> M2[Solidity 0.8 + bounded params]
        S3[Cap bypass] --> M3[Three-layer enforcement]
        S4[Transfer fee bypass] --> M4[_update hook is single path]
    end
    subgraph A2 [Economic]
        E1[Sandwich on swap] --> ME1[Slippage param + deadline]
        E2[Phase-rate front-run on commit] --> ME2[No fee discount; rate purely from supply]
        E3[Adaptive oracle manipulation] --> ME3[Admin-set ref price; no on-chain oracle]
        E4[Multiplier blowup] --> ME4[Effective band clamp]
    end
    subgraph A3 [Operational]
        O1[Admin key compromise] --> MO1[Multisig migration plan]
        O2[Backend host compromise] --> MO2[Indexer DB only; no signing keys on server]
        O3[Indexer DB tamper] --> MO3[Verification UX-only; no on-chain effect]
    end
```

### 14.2 Specific Vectors

**Sandwich attack on swap.** A bot front-runs a user's swap, moves the price unfavourably, lets the user execute, then back-runs to revert the price. Mitigations: per-tx slippage param (default 1% in UI), deadline enforcement, no MEV protection at the protocol level (Arc's mempool dynamics are an open question).

**Adaptive multiplier oracle drift.** The reference fDOGE price is admin-set, not oracle-fed. If the admin sets a stale or wrong price, emissions drift away from market-equilibrium. Mitigation: bounded by `[adaptiveMinBps, adaptiveMaxBps]` — even a wildly wrong price can only push the multiplier ±20% from neutral by default.

**Phase-rate gaming.** Could a user time their commit to land at a phase boundary and capture the higher rate before crossing? Yes, if they harvest exactly at the right moment — but the boundary-crossing logic in `_computeEmission` exactly splits the emission at the boundary, so the gain equals what they'd naturally receive. There is no exploit, only optimal play.

**Per-wallet cap bypass via multiple wallets.** A user with funds can split into N wallets and effectively raise their cap N-fold. This is acknowledged: the cap is a soft anti-whale signal, not a hard sybil-resistant constraint. Sybil-resistance would require off-chain identity (out of scope).

**Pair manipulation pre-seed.** Before the LM has seeded liquidity, the pair's reserves are zero. A malicious actor could front-run the first `seedLiquidity()` by directly transferring tokens to the pair and calling `mint(self)` to capture the initial LP at any ratio they choose. Mitigation: the LM mints the very first liquidity itself, in a transaction from the operator. The window between deploy and first-seed is the only vulnerable period and is covered by ops procedure.

**Transfer-fee griefing.** A user could attempt to grief by sending fDOGE in a way that breaks fee accounting. Mitigation: the `_update` override is the single path for all balance changes (transfer/mint/burn) and handles every case explicitly. Mint and burn skip fee; exempt addresses skip fee; everything else pays exactly the configured fraction.

### 14.3 Mitigations Already In Place

- ReentrancyGuard on every state-mutating external function.
- SafeERC20 for all token transfers.
- Hard ceilings on fee (0.20%), inflation rate (5%/yr), effective multiplier band.
- Three-layer cap enforcement.
- Pause switch as circuit breaker.
- All admin actions emit events (auditability).

### 14.4 Open Risks

- **Single admin EOA at launch.** Highest priority to migrate to multisig.
- **No external audit yet.** Code is open and tested but not professionally reviewed.
- **First-seed window**: see vector 5 above.
- **Arc protocol dependency**: any breaking change to Arc's USDC predeploy or Multicall3 would require frontend updates.

---

## 15. Treasury and Fee Policy

### 15.1 Revenue Streams

The protocol generates value into two destinations:

```mermaid
flowchart LR
    M[Mining flow] -->|95 percent of flowed USDC| LP[(LP pool)]
    M -->|5 percent of flowed USDC| TR[(Treasury wallet)]
    NM[Names claims] -->|100 percent of fee| LP
    TF[fDOGE transfer fee] -->|0.10 percent on every transfer| TR
    LPF[Pair LP fee] -->|0.30 percent on every swap| LP
    RTR[ForgeRouter] -->|0.10 percent platform fee on every swap| LP
```

The split is intentional: **liquidity gets 100% of identity revenue, 95% of mining revenue, and 100% of platform swap fees**; treasury gets 5% of mining and the residual transfer fee revenue. Liquidity is treated as the primary public good of the protocol; treasury is an operational reserve.

Every swap — fDOGE or stablecoin-pair — routes through `ForgeRouter`, which skims **0.10%** of the input token and forwards it to `LiquidityManager`. The router itself holds no funds. For fDOGE trades the protocol additionally earns the 0.30% LP fee baked into `TdogePair` (because LM owns the LP position), so each fDOGE swap contributes **0.40%** back into the pool effectively. Stablecoin-pair swaps yield 0.10% to LM plus the 0.30% LP fee to whoever seeded that pair's liquidity.

### 15.2 Fee Routing

| Source | Destination | Mechanism |
|---|---|---|
| Mining flow (95%) | LP pool via `LiquidityManager` | `Miner.flush` → `LM.seedLiquidity` |
| Mining flow (5%) | Treasury wallet | `Miner.flush` |
| `.fdoge` claim fees | LP pool via `LiquidityManager` | `TdogeNames.claim` → direct safeTransferFrom to LM |
| fDOGE transfer fee | Treasury wallet | `DOGE._update` hook |
| Swap fee | LP holders (LM is the only LP currently) | Standard k-invariant retention |

### 15.3 Use of Treasury Funds

Treasury holds:
- 5% share of mining-converted USDC.
- fDOGE transfer fees (in fDOGE).

Both are held in an EOA / multisig at the chain level. There is no on-chain governance over treasury spending today. Acceptable uses are documented as:

1. Operations cost (RPC, hosting, audits).
2. Bootstrapping liquidity in market dislocations (admin discretion within multisig).
3. Future programs (rewards, grants, contributors).

A formal treasury policy will accompany the multisig migration.

### 15.4 fDOGE Burn Mechanics (Future)

A planned post-launch enhancement: route a portion of fDOGE transfer fees (or all of them) into a periodic burn rather than treasury. The burn would reduce `totalSupply` and effectively counter the post-cap inflation.

This is not yet implemented. Implementation notes:
- The `feeTreasury` could be a small burner contract that calls `DOGE.burn(self balance)` on a schedule.
- Or the `feeBps` could be split into `burnBps` and `treasuryBps` natively in `DOGE._update`.

The choice and timing of this is a governance decision pending after multisig migration.

---

## 16. Comparative Analysis

### 16.1 vs Pure Mining Tokens

Compared to a token whose only property is "stake X to earn Y":

| Property | Pure mining | DOGE FORGE |
|---|---|---|
| Supply cap | Often missing or symbolic | Hard 210M, layered enforcement |
| Liquidity bootstrapping | User-funded LP, often abandoned | Protocol-owned, automatic from flow |
| Reward differentiation | One rate for everyone | Commitment tier × Harvest mode × global × adaptive |
| Identity | None | `.fdoge` registry |
| Adaptive emissions | Static | Reference price + bounded scaling |

### 16.2 vs Bonding Curve Launches

Bonding curves provide instant liquidity but mint supply on every buy, often without a meaningful ceiling. They reward early participants through price slope, not protocol structure.

DOGE FORGE inverts this: supply emission is rate-limited (2%/day max per position), liquidity grows from production rather than from speculation, and the reward differential between early and late comes from supply-based phase rates rather than price-curve mechanics.

### 16.3 vs Stake-to-Earn

Classical stake-to-earn sees users lock token A to receive token B. Token A is usually pre-existing and externally priced. DOGE FORGE inverts the asset roles: users commit a stable (USDC), receive a freshly-minted volatile (fDOGE), and the protocol uses the stable to seed the market for the volatile. The system is effectively a productized DEX-launch with a 50-day per-position vesting cycle.

### 16.4 vs Memecoin Launches

Most memecoin launches are a one-shot mint to a single LP position. Holders speculate, the LP is volatile, and there is no mechanism for liquidity to grow organically.

DOGE FORGE keeps the meme aesthetic (fDOGE branding, .fdoge identity) but installs an underlying mechanism that converts speculative interest into protocol-owned liquidity. Every commit grows the pool. The pool is never extracted.

---

## 17. Roadmap

```mermaid
flowchart TD
    P1[Phase C - Isolated mining<br/>shipped] --> P2
    P2[Phase A - AMM + auto liquidity<br/>shipped] --> P3
    P3[Identity registry + leaderboard<br/>shipped] --> P4
    P4[24h volume + price chart indexing] --> P5
    P5[Token discovery: deeper metadata enrichment<br/>for discovered tokens] --> P6
    P6[Multisig handover + audit] --> P7
    P7[Doge PFP collection - identity holders<br/>get priority access]
```

| Phase | State | Description |
|---|---|---|
| C — Isolated mining | shipped | Miner, emission curve, harvest modes, multipliers, treasury accumulation |
| A — Liquidity loop | shipped | TdogePair, LM, Router, in-contract auto-flush, in-app swap |
| Identity + Leaderboard | shipped | `.fdoge` claims with fee-to-liquidity routing, public ranking |
| Volume / chart | next | Backend indexes Pair `Swap` events for 24h volume + sparkline charts on tiles |
| Discovery enrich | next | For each discovered token, fetch holder counts and recent transfer activity from indexed events |
| Multisig + audit | pre-mainnet | Ownership migration and external review |
| PFP collection | future | Optional ERC-721 layer, priority for `.fdoge` holders |

---

## 18. Risks and Disclosures

This system is on testnet. Material risks before mainnet deployment include:

- **Centralisation at launch.** A single EOA controls upgrades and parameters. The path to multisig is documented but not yet executed.
- **Admin rescue power.** `adminWithdrawPathUSD` allows the operator to remove USDC held by `Miner`. Until ownership migrates, users should size positions accordingly.
- **AMM pricing risk.** The custom pair has no oracle. The first seed sets the initial price; subsequent trades discover price freely. Manipulation requires capital; large enough capital can move the price.
- **Arc primitive assumptions.** USDC is treated as a fixed protocol primitive at `0x3600…`. If Arc changes its predeploy layout in a future upgrade, the protocol address constants would need a config update + redeploy.
- **Smart contract risk.** All code is open and tested but unaudited. Tests cover happy paths, boundary conditions, and adversarial cases included in this whitepaper.
- **Memetic narrative risk.** fDOGE is a meme-flavoured token. Price action will reflect speculative interest more than fundamentals, especially in the bootstrap phase. Users should treat all participation as voluntary risk.

This whitepaper is not investment advice. DOGE FORGE is a permissionless protocol; participants are responsible for their own decisions and key custody.

---

## 19. Appendix

### A. Deployed Addresses (Arc Testnet, chain 5042002)

| Contract | Address |
|---|---|
| fDOGE | `0x25497e0aC492B79A3781fed41762F106f9158F71` |
| Miner | `0x1574EEA1DA5e204CC035968D480aE51BF6505834` |
| LiquidityManager | `0x7232883c1abC50DCfaae96394f55f14DF927CF38` |
| TdogeFactory | `0x75E4CBF4D804A15a945D5758d1b4976E1c6ceAE9` |
| ForgeRouter | `0xfFBd254859ebF9fc4808410f95f8c4e7998846FB` |
| fDOGE/USDC pair | `0x96da2A3DeE82295e752bdE12541120ccCDFaf407` |
| EURC/USDC pair | `0xa699a07e68FE465d684374aF02FE6105B18B5209` |
| USYC/USDC pair | `0x4D4C296190A360E3F5c946341fA90CA65Ef5574e` |
| WUSDC/USDC pair | `0xFB75Dee2Cf4fB4c4CDD3486Fc28a4Fd9d13a3a2A` |
| TdogeNames | `0x998ae581c462DA5aa161b5f89F4d4Fe40B5eab35` |
| USDC (Arc predeploy) | `0x3600000000000000000000000000000000000000` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

Explorer: `https://testnet.arcscan.app`. RPC: `https://rpc.testnet.arc.network`. Faucet: `https://faucet.circle.com`.

### B. Function Catalogue (User-Facing)

**Miner**
- `commit(uint256 amount, uint8 mode) returns (uint256 positionId)`
- `deposit(uint256 amount) returns (uint256)` — alias for `commit(amount, 0)`
- `harvest(uint256 positionId)`
- `harvestAll()`
- `flush()` — permissionless
- `getPositions(address user) view returns (Position[])`
- `pending(address user, uint256 positionId) view returns (uint256 flow, uint256 doge, uint256 secsToUnlock)`
- `pendingAll(address user) view returns (uint256 openCount, uint256 totalCommitted, uint256 totalPending)`
- `currentPhase() view returns (uint256 index, uint256 ratePerUSDC)`
- `effectiveMultiplierBps(address user, uint256 positionId) view returns (uint256 commitment, uint256 mode, uint256 global, uint256 adaptive, uint256 effective)`

**LiquidityManager**
- `seedLiquidity() returns (uint256 lp)` — permissionless
- `totalReceived() view returns (uint256)` / `totalDeployed()` / `dogeMinted()`

**TdogePair**
- `getReserves() view returns (uint112, uint112, uint32)`
- `mint(address to)`, `burn(address to)`, `swap(uint256 a0Out, uint256 a1Out, address to)`

**TdogeRouter**
- `swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to, uint256 deadline)`
- `swapExactOut(address tokenIn, uint256 amountOut, uint256 maxIn, address to, uint256 deadline)`
- `quote(address tokenIn, uint256 amountIn) view returns (uint256)`

**TdogeNames**
- `claim(string name)`
- `nameOf(address) view returns (string)`
- `displayNameOf(address) view returns (string)` — returns `<name>.fdoge` or empty
- `isEligible(address) view returns (bool)`
- `isNameAvailable(string) view returns (bool)`
- `resolveName(string) view returns (address)`

### C. Storage Layout (Selected)

**Miner.Position**

```
struct Position {
    uint256 remaining;       // USDC still to flow (token-wei)
    uint256 totalDeposited;  // original commitment (token-wei)
    uint64  lastUpdate;      // accrual timestamp
    uint64  unlockAt;        // earliest harvest timestamp
    uint8   mode;            // index into harvestModes
    bool    open;            // false once fully closed
    uint256 pendingDoge;     // accrued but unclaimed fDOGE (fDOGE-wei)
}
```

**Miner Globals**

```
mapping(address => Position[]) private _positions;
mapping(address => uint256)    public  minerScore;       // lifetime points (USDC-days)
uint256 public pendingLiquidity;  // USDC awaiting flush
uint256 public pendingTreasury;   // USDC awaiting flush
uint256 public totalFlowed;       // cumulative flowed USDC
```

**TdogePair Reserves**

```
uint112 private reserve0;  // sorted token0 reserve
uint112 private reserve1;  // sorted token1 reserve
uint32  private blockTimestampLast;
```

### D. Developer Quickstart

Clone, build, and test:

```bash
# contracts
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge build
forge test

# frontend
cd ../frontend
npm install
cp .env.example .env.local && $EDITOR .env.local
npm run dev

# backend
cd ../backend
npm install
cp .env.example .env && $EDITOR .env
npm run dev      # API on :4000
npm run indexer  # token discovery
# (no keeper needed — auto-flush is in the Miner contract)
```

Deploy fresh contracts to Arc testnet:

```bash
cd contracts
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_RPC_URL --broadcast --gas-estimate-multiplier 200
```

Or use the one-shot helper that captures all addresses and writes Vercel-ready env files:

```bash
powershell -ExecutionPolicy Bypass -File scripts/deploy-arc.ps1
```

### E. Glossary

- **Accrual** — the act of updating a position's flowed amount and pendingDoge based on elapsed time. Lazy: only happens when the position is touched.
- **Cycle** — the lifecycle of a single Position from commit through full conversion to close.
- **Flow rate** — `flowRateBpsPerDay`. The percentage of the original commitment that converts each day.
- **Harvest Mode** — chosen at commit; controls reward boost and unlock delay.
- **Effective multiplier** — the combined product of commitment × mode × global × adaptive, clamped to the configured band.
- **Liquidity sink** — the destination that receives the 95% share of flowed USDC; the LiquidityManager.
- **Treasury sink** — the destination of the 5% share; the project treasury wallet.
- **Pair** — `TdogePair`, the constant-product AMM for fDOGE / USDC.
- **ERC-20** — the standard fungible token interface used by USDC, fDOGE, and every Arc-deployed token.
- **LM** — `LiquidityManager`. Holds incoming USDC, mints matching fDOGE, deposits into the pair.
- **Auto-flush** — Miner-internal mechanism that triggers `flush` + `seedLiquidity` from inside user write transactions once a USDC threshold or time interval is reached. Replaces the off-chain keeper.
- **Identity** — a `.fdoge` name claimed via `TdogeNames`. Pure status; no economic effect.
- **Miner score** — cumulative points = Σ(committed × time-active / day). Used for ranking.
- **K-invariant** — the constant-product `reserve0 × reserve1 = k` rule that governs AMM swaps.

---

*DOGE FORGE Whitepaper · Version 1.1 · Arc Network*
