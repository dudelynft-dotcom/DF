# Whitelist all curated DOGE FORGE trading pairs on the ForgeRouter.
#
# Background: ForgeRouter ships with whitelistOnly=true as a launch
# guardrail. Until the admin approves each pair, every swap reverts
# with PairNotWhitelisted(). This script batches the approval for all
# known pairs in one tx.
#
# Idempotent: re-running it is safe — pairs already approved just stay
# approved. Uses setPairApprovedBatch so it's one tx regardless of count.

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$frontend  = Join-Path $repoRoot "frontend"
$cast      = "C:\Users\USER\.foundry\bin\cast.exe"
$RPC       = "https://rpc.testnet.arc.network"

# --- Load PRIVATE_KEY ---
$envFile = Join-Path $contracts ".env"
if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
  }
}
if (-not $env:PRIVATE_KEY -or $env:PRIVATE_KEY -eq "0x") {
  throw "PRIVATE_KEY not set in contracts\.env"
}
$PK = $env:PRIVATE_KEY

# --- Pull addresses from frontend\.env.local ---
$envLocal = Join-Path $frontend ".env.local"
$local = Get-Content $envLocal -Raw
function GrabAddr($name) {
  if ($local -match "(?m)^\s*$name\s*=\s*(0x[a-fA-F0-9]{40})") { return $matches[1] }
  throw "$name not found in $envLocal"
}
$ROUTER  = GrabAddr "NEXT_PUBLIC_ROUTER_ADDRESS"
$FACTORY = GrabAddr "NEXT_PUBLIC_FACTORY_ADDRESS"
$FDOGE_PAIR = GrabAddr "NEXT_PUBLIC_PAIR_ADDRESS"

# --- Token addresses (same list the Pool page uses) ---
$USDC   = "0x3600000000000000000000000000000000000000"
$EURC   = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
$USYC   = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C"
$WUSDC  = "0x911b4000D3422F482F4062a913885f7b035382Df"

# Known pairs copied from frontend/src/components/LiveStats.tsx.
$CDOGE_USDC = "0x152B8a54835Ac5853ec449B60DCAB55da3A355DD"
$EURC_USDC  = "0xa699a07e68fe465d684374af02fe6105b18b5209"
$WUSDC_USDC = "0xfb75dee2cf4fb4c4cdd3486fc28a4fd9d13a3a2a"

# --- Resolve USYC/USDC pair via factory (no hard-coded address available). ---
Write-Host "Resolving USYC/USDC pair..."
$usycPairRaw = (& $cast call $FACTORY "getPair(address,address)(address)" $USYC $USDC --rpc-url $RPC).Trim()
$USYC_USDC = $usycPairRaw -replace ' .*$', ''
if ($USYC_USDC -eq "0x0000000000000000000000000000000000000000") {
  Write-Host "  USYC/USDC pair not yet created - skipping" -ForegroundColor Yellow
  $USYC_USDC = $null
}

# --- Collect pairs, drop any missing ---
$pairs = @($FDOGE_PAIR, $CDOGE_USDC, $EURC_USDC, $WUSDC_USDC)
if ($USYC_USDC) { $pairs += $USYC_USDC }

Write-Host ""
Write-Host "Router : $ROUTER"
Write-Host "Pairs to approve:"
foreach ($p in $pairs) { Write-Host "  $p" }
Write-Host ""

# setPairsApproved(address[],bool) — the batch variant on ForgeRouter.
# cast encodes address[] as a JSON-like array.
$pairsJson = "[" + ($pairs -join ",") + "]"

Write-Host "Submitting setPairsApproved..." -ForegroundColor Cyan
& $cast send $ROUTER "setPairsApproved(address[],bool)" $pairsJson true `
  --rpc-url $RPC --private-key $PK --confirmations 1

Write-Host ""
Write-Host "Done. Verifying..."
foreach ($p in $pairs) {
  $ok = (& $cast call $ROUTER "pairApproved(address)(bool)" $p --rpc-url $RPC).Trim()
  $status = if ($ok -eq "true") { "OK" } else { "FAIL" }
  $color = if ($ok -eq "true") { "Green" } else { "Red" }
  Write-Host "  [$status] $p" -ForegroundColor $color
}
