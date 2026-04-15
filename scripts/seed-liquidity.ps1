# Seed ~10 USDC per side on each stablecoin pair via ForgeRouter.addLiquidity.
#
# Uses `cast send` instead of a forge script because Arc's USDC calls a
# blocklist precompile at 0x1800…0001 on every transfer, which forge's local
# EVM can't simulate (StackUnderflow). Raw tx broadcasts bypass that.
#
# Skips any token the admin wallet doesn't hold (balance check before each).

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

# --- Pull ROUTER_ADDRESS from frontend\.env.local ---
$envLocal = Join-Path $frontend ".env.local"
$local = Get-Content $envLocal -Raw
if ($local -match "(?m)^\s*NEXT_PUBLIC_ROUTER_ADDRESS\s*=\s*(0x[a-fA-F0-9]{40})") {
  $ROUTER = $matches[1]
} else {
  throw "NEXT_PUBLIC_ROUTER_ADDRESS not found in $envLocal. Run deploy-dex.ps1 first."
}

$USDC   = "0x3600000000000000000000000000000000000000"
$EURC   = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
$USYC   = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C"
$WUSDC  = "0x911b4000D3422F482F4062a913885f7b035382Df"

$ADMIN  = (& $cast wallet address --private-key $PK).Trim()
$USDC_H = if ($env:SEED_USDC_AMOUNT) { [int]$env:SEED_USDC_AMOUNT } else { 10 }

Write-Host "Admin  : $ADMIN"
Write-Host "Router : $ROUTER"
Write-Host "Seed   : $USDC_H USDC per side`n"

# Helper: seed one pair (tokenAddr, tokenDecimals).
function Seed-Pair([string]$label, [string]$token, [int]$dec) {
  Write-Host "--- $label ---" -ForegroundColor Cyan

  $tokBal = (& $cast call $token "balanceOf(address)(uint256)" $ADMIN --rpc-url $RPC).Trim()
  $usdcBal = (& $cast call $USDC "balanceOf(address)(uint256)" $ADMIN --rpc-url $RPC).Trim()
  $tokBal  = $tokBal  -replace ' .*$', ''    # strip " [1e8]" annotation
  $usdcBal = $usdcBal -replace ' .*$', ''

  $tokAmt  = [decimal]$USDC_H * [math]::Pow(10, $dec)
  $usdcAmt = [decimal]$USDC_H * 1000000

  if ([decimal]$tokBal -lt $tokAmt) {
    Write-Host "  skip: admin has $tokBal $label, need $tokAmt" -ForegroundColor Yellow
    return
  }
  if ([decimal]$usdcBal -lt $usdcAmt) {
    Write-Host "  skip: admin has $usdcBal USDC, need $usdcAmt" -ForegroundColor Yellow
    return
  }

  Write-Host "  approving $label -> router..."
  & $cast send $token "approve(address,uint256)" $ROUTER $tokAmt `
    --rpc-url $RPC --private-key $PK --confirmations 1 | Out-Null

  Write-Host "  approving USDC  -> router..."
  & $cast send $USDC "approve(address,uint256)" $ROUTER $usdcAmt `
    --rpc-url $RPC --private-key $PK --confirmations 1 | Out-Null

  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 600
  Write-Host "  addLiquidity..."
  & $cast send $ROUTER "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)" `
    $token $USDC $tokAmt $usdcAmt 0 0 $ADMIN $deadline `
    --rpc-url $RPC --private-key $PK --confirmations 1 | Out-Null

  Write-Host "  seeded $label / USDC" -ForegroundColor Green
}

Seed-Pair "EURC"  $EURC  6
Seed-Pair "USYC"  $USYC  6
Seed-Pair "WUSDC" $WUSDC 18

Write-Host "`nDone." -ForegroundColor Green
