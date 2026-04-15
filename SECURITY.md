# DOGE FORGE — Security Notes

DOGE FORGE has **not been audited**. This document lists the protocol
invariants we rely on, the admin powers that exist, the known risks, and
the boundaries of "safe" usage while we harden the stack pre-audit.

If you believe you've found an issue, please disclose privately before
publishing. Contact: **security@dogeforge.fun** (PGP on request).

---

## 1. Protocol invariants

Every invariant below is either enforced in code, asserted by a test, or
both. Adding a new contract feature should not require weakening any of
them. If a feature would weaken an invariant, the invariant must be
updated here first and reasoned about explicitly.

### Token supply

- **I1.** `DOGE.totalSupply()` is never greater than `DOGE.currentCap()`.
  Enforced in `DOGE.mint`. Tested in `DOGE.t.sol`.
- **I2.** `DOGE.currentCap()` before `capAnchorTime` is `INITIAL_CAP`
  (210,000,000 × 1e18). After anchor, it grows at
  `yearlyInflation / SECONDS_PER_YEAR` per second, with
  `yearlyInflation ≤ MAX_YEARLY_INFLATION` (5%/yr).
- **I3.** `DOGE` transfer fee is bounded: `feeBps ≤ MAX_FEE_BPS` (0.2%).
  Enforced in `setFeeBps`.
- **I4.** Only whitelisted minters may mint. The `Miner` and
  `LiquidityManager` contracts are the only production minters.

### Mining

- **M1.** For every `Position`, `remaining ≤ totalDeposited` at all times.
  Enforced by `_accruePosition` subtracting at most `remaining`.
- **M2.** Per-wallet open-position count is bounded by
  `maxPositionsPerWallet` (default 10).
- **M3.** Per-wallet sum of `totalDeposited` across open positions is
  bounded by `perWalletCap`.
- **M4.** Effective emission multiplier is clamped to
  `[minEffectiveMultBps, maxEffectiveMultBps]` after every component
  multiplier is composed. Defaults: `[0.25×, 10×]`.
- **M5.** `Miner.pendingLiquidity + Miner.pendingTreasury + distributed
  == cumulative flowed USDC`. Every bump of `pendingLiquidity` or
  `pendingTreasury` is paired with a matching deduction on flush.
- **M6.** Auto-flush is always wrapped in `try/catch`. A `seedLiquidity`
  revert never blocks a user's mine/harvest. (Production guard: the
  call is only issued when `lm.code.length > 0`.)

### DEX

- **D1.** For any registered pair, `reserve0 * reserve1` (k) does not
  crash to zero while LP tokens are outstanding. Enforced by the
  k-invariant check inside `TdogePair.swap`. Fuzz-tested in
  `invariant/DexInvariant.t.sol`.
- **D2.** `ForgeRouter` holds no user funds between calls. The fee skim
  in `swapExactTokensForTokens` is transferred to `feeRecipient` in the
  same transaction; the router never accumulates user balances.
  Invariant-tested.
- **D3.** `ForgeRouter.platformFeeBps ≤ MAX_PLATFORM_FEE_BPS` (0.50%).
  Enforced in `setPlatformFeeBps`.
- **D4.** `removeLiquidity` is **not** gated by the pause switch or the
  pair whitelist. Users can always withdraw their LP regardless of
  operational state.
- **D5.** `TdogeFactory.registerPair` re-reads `token0()` / `token1()`
  from the candidate pair and rejects if they don't match the sorted
  arguments. Prevents misrouting via an admin mistake.

### Identity

- **N1.** `TdogeNames` never issues more than `MAX_SUPPLY` (5000) names.
- **N2.** Claim fee routes 100% to `liquiditySink` (LiquidityManager by
  default). No treasury take.

---

## 2. Admin powers

Every `onlyOwner` function falls into one of three buckets.

### Bounded parameter tuning — safe, always allowed

These change numbers within hard-coded caps. Worst case: a malicious
admin sets a parameter to zero or its max, which degrades UX but cannot
mint free tokens or drain funds.

- `DOGE.setFeeBps(bps)` — capped at `MAX_FEE_BPS` (0.2%).
- `DOGE.setYearlyInflation(amount)` — capped at `MAX_YEARLY_INFLATION`.
- `Miner.setGlobalMultiplier`, `setFlowRateBpsPerDay`, `setPerWalletCap`,
  `setMaxPositionsPerWallet`, `setEffectiveMultBand`, `setAdaptiveEnabled`,
  `setReferenceTdogePrice`, `setAdaptiveBounds`, `setSplit`,
  `setAutoFlushEnabled`, `setAutoFlushThreshold`, `setAutoFlushIntervalSec`.
  All clamp to safe ranges via invariant M4 and `setSplit`'s `BPS` check.
- `Miner.setPhases`, `setCommitmentTiers`, `setHarvestModes` — reshape
  the emission curve but cannot lift the 210M supply cap (that's in `DOGE`).
- `ForgeRouter.setPlatformFeeBps` — capped at 0.50%.
- `ForgeRouter.setFeeEnabled`, `setFeeRecipient`, `setWhitelistOnly`,
  `setPairApproved`, `setPairsApproved`.
- `TdogeNames.setClaimCost`, `setClaimOpen`, `setLiquiditySink`,
  `setMaxSupply` (within existing cap).

### Operational controls — halt, don't steal

- `Miner.pause()` / `unpause()` — blocks commits and harvests. Does not
  freeze pending balances.
- `ForgeRouter.pause()` / `unpause()` — blocks swaps and addLiquidity.
  **removeLiquidity remains callable** so users can always exit.

### Rescue functions — limited scope

- `Miner.adminWithdrawPathUSD(to, amount)` — **HIGH RISK.** Admin can
  withdraw any USDC balance held by the Miner. Intended for rescuing
  misrouted funds, but a compromised key can drain the Miner's
  pendingLiquidity before the next flush. Mitigation: multisig the
  admin EOA before mainnet (see §4).
- `LiquidityManager.sweep(token, to, amount)` — can move any ERC-20 out
  of the LiquidityManager. Same key-compromise risk as above.
- `ForgeRouter.rescueERC20(token, to, amount)` — In steady state the
  router holds zero user funds (invariant D2), so rescue only recovers
  dust from a reverted swap.

### What admin CAN'T do

- **Mint DOGE.** Admin is not on the `minters` map. Only `Miner` and
  `LiquidityManager` can mint, each bounded by `currentCap()`.
- **Bypass `perWalletCap` or `maxPositionsPerWallet` on user positions.**
- **Lift the 210M hard cap.** `INITIAL_CAP` is an `immutable`.
- **Reach into user wallets.** Every path requires explicit ERC-20 approval.
- **Fork a pair.** `TdogeFactory.registerPair` verifies token bindings;
  the admin cannot bind a random contract as a pair.

---

## 3. Known risks & accepted trade-offs

### 3.1 Oracleless adaptive multiplier

`Miner`'s adaptive multiplier uses an admin-set `referenceTdogePrice`
rather than a pool oracle. Rationale: pool-based oracles can be
manipulated via a flash-swap in the same block (even though our router
requires `minOut`, a determined attacker could sandwich their own
harvest). Admin-set reference is centralisation we accept over
manipulation risk.

Mitigation: `referenceTdogePrice` only scales the multiplier, which is
then clamped by invariant **M4**. Upper bound on reward inflation from
a malicious reference is the `maxEffectiveMultBps` ceiling.

### 3.2 First-LP donation attack

UniswapV2's classic issue: a rounding-induced donation attack on an
empty pool. Mitigated by minting `MINIMUM_LIQUIDITY` (10^3 wei) to
`0xdead` on the very first `mint`. This is inherited from our
`TdogePair` (line 79). Standard and battle-tested.

### 3.3 MEV / sandwich on swaps

Not protected at the protocol level. Every user swap must pass a
user-chosen `minOut` and `deadline`. Frontend defaults: 1% slippage,
5-minute deadline. Front-running is inherent to public-mempool EVM
chains. Arc's sequencer behaviour here is an open question we revisit
pre-mainnet.

### 3.4 Single-key admin

Launch admin is a single EOA. A key compromise = all admin powers
exposed. See §4 for the pre-mainnet mitigation path.

### 3.5 Frontend trust

`dogeforge.fun` serves the UI. A DNS or Vercel compromise could deliver
malicious swap transactions. Mitigations: CSP headers locking script /
connect origins (`next.config.mjs`), HSTS preload, no secrets in
frontend code, open-source for independent build.

### 3.6 Testnet shortcuts

Several operational niceties are testnet-only:

- Admin EOA holds the single-signer key.
- Pairs are seeded from admin wallet (`scripts/seed-liquidity.ps1`).
- Adaptive reference price is not connected to an on-chain oracle.

None of these ship to mainnet as-is.

---

## 4. Pre-mainnet checklist

Before any real funds land:

1. **Multisig** — deploy a Gnosis Safe (3-of-5 or 2-of-3 with a hot
   operator key) and `transferOwnership` on every Ownable contract:
   `DOGE`, `Miner`, `LiquidityManager`, `TdogeFactory`, `ForgeRouter`,
   `TdogeNames`. Admin EOA becomes a documented ex-owner.
2. **Contract verification** — verify every deployed address on the Arc
   block explorer so the source is auditable by users.
3. **Continuous fuzzing** — the invariant suite in `test/invariant/`
   runs locally. Extend it to cover Miner accrual math and run with a
   higher depth in CI before each release.
4. **Timelock** — optional but recommended: route sensitive admin calls
   (`adminWithdrawPathUSD`, `LiquidityManager.sweep`, `setYearlyInflation`)
   through an on-chain timelock so a compromised key has a 24-48h
   visibility window before any damage.
5. **Bug bounty** — once the surface is stable, list on Immunefi or
   Code4rena with a clear scope and payout schedule. Explicit skip of
   a formal audit is fine if the bounty is generous enough to attract
   serious reviewers.

---

## 5. Reporting

Reports go to **security@dogeforge.fun**. We will:

- Acknowledge within 48 hours.
- Triage severity within 5 business days.
- Keep the reporter updated through resolution.
- Publicly credit the reporter (if they wish) after remediation.

Please **do not** publicly disclose until a fix is deployed, unless
we've been unresponsive for more than 14 days.
