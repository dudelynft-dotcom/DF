# Deploy DOGE FORGE to Pharos Atlantic in one shot.
#
# Prerequisites:
#   1. Foundry installed at C:\Users\USER\.foundry\bin\forge.exe
#   2. contracts\.env exists with:
#        PHAROS_RPC_URL, PRIVATE_KEY, PATHUSD_ADDRESS, TREASURY_ADDRESS
#      (PATHUSD_ADDRESS is the Pharos USDC address — already filled in .env.example)
#   3. Admin wallet funded with PHRS (gas) + USDC
#
# What this does:
#   - Deploys: DOGE, Miner, TdogePair, LiquidityManager, TdogeRouter
#   - Deploys: TdogeNames (using Miner + LM addresses from above)
#   - Writes all six addresses to frontend\.env.local
#   - Writes a copy-pasteable Vercel env block to scripts\vercel-env.txt

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$frontend  = Join-Path $repoRoot "frontend"
$forge     = "C:\Users\USER\.foundry\bin\forge.exe"

# --- load contracts\.env ---
$envFile = Join-Path $contracts ".env"
if (-not (Test-Path $envFile)) {
  throw "Missing $envFile. Copy .env.example to .env and fill PRIVATE_KEY + TREASURY_ADDRESS."
}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim())
  }
}
if (-not $env:PRIVATE_KEY -or $env:PRIVATE_KEY -eq "0x") {
  throw "PRIVATE_KEY is not set in contracts\.env"
}
if (-not $env:TREASURY_ADDRESS -or $env:TREASURY_ADDRESS -eq "0x") {
  throw "TREASURY_ADDRESS is not set in contracts\.env"
}
if (-not $env:PHAROS_RPC_URL) {
  $env:PHAROS_RPC_URL = "https://atlantic.dplabs-internal.com"
}
Write-Host "RPC:      $env:PHAROS_RPC_URL"
Write-Host "USDC:     $env:PATHUSD_ADDRESS"
Write-Host "Treasury: $env:TREASURY_ADDRESS"

Push-Location $contracts
try {
  # --- deploy 1 ---
  Write-Host "`n=== Deploying Miner / DOGE / Pair / LM / Router ===" -ForegroundColor Cyan
  $out1 = & $forge script "script/Deploy.s.sol:Deploy" `
    --rpc-url $env:PHAROS_RPC_URL `
    --broadcast `
    --gas-estimate-multiplier 200 2>&1
  Write-Host ($out1 -join "`n")

  function Extract([string[]]$lines, [string]$label) {
    foreach ($l in $lines) {
      if ($l -match "$label\s*:\s*(0x[a-fA-F0-9]{40})") { return $matches[1] }
    }
    throw "Could not find '$label' address in deploy output"
  }

  $DOGE   = Extract $out1 "DOGE"
  $MINER  = Extract $out1 "Miner"
  $PAIR   = Extract $out1 "TdogePair"
  $LM     = Extract $out1 "LiquidityManager"
  $ROUTER = Extract $out1 "TdogeRouter"

  Write-Host "`n  DOGE   = $DOGE" -ForegroundColor Green
  Write-Host "  MINER  = $MINER" -ForegroundColor Green
  Write-Host "  PAIR   = $PAIR" -ForegroundColor Green
  Write-Host "  LM     = $LM" -ForegroundColor Green
  Write-Host "  ROUTER = $ROUTER" -ForegroundColor Green

  # --- deploy 2 ---
  Write-Host "`n=== Deploying TdogeNames ===" -ForegroundColor Cyan
  $env:MINER_ADDRESS = $MINER
  $env:LM_ADDRESS    = $LM
  $out2 = & $forge script "script/DeployTdogeNames.s.sol:DeployTdogeNames" `
    --rpc-url $env:PHAROS_RPC_URL `
    --broadcast `
    --gas-estimate-multiplier 200 2>&1
  Write-Host ($out2 -join "`n")
  $NAMES = Extract $out2 "TdogeNames"
  Write-Host "`n  NAMES  = $NAMES" -ForegroundColor Green
}
finally {
  Pop-Location
}

# --- write frontend\.env.local ---
$envLocal = Join-Path $frontend ".env.local"
$content = @"
NEXT_PUBLIC_PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
NEXT_PUBLIC_PHAROS_CHAIN_ID=688689
NEXT_PUBLIC_PHAROS_EXPLORER_URL=https://atlantic.pharosscan.xyz

NEXT_PUBLIC_USDC_ADDRESS=$($env:PATHUSD_ADDRESS)

NEXT_PUBLIC_DOGE_ADDRESS=$DOGE
NEXT_PUBLIC_MINER_ADDRESS=$MINER
NEXT_PUBLIC_PAIR_ADDRESS=$PAIR
NEXT_PUBLIC_LM_ADDRESS=$LM
NEXT_PUBLIC_ROUTER_ADDRESS=$ROUTER
NEXT_PUBLIC_NAMES_ADDRESS=$NAMES

NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
"@
Set-Content -Path $envLocal -Value $content -Encoding UTF8
Write-Host "`nWrote $envLocal" -ForegroundColor Cyan

# --- write scripts\vercel-env.txt ---
$vercelEnv = Join-Path $PSScriptRoot "vercel-env.txt"
$prod = @"
# Paste these into Vercel -> Settings -> Environment Variables (Raw Editor).
# Remember to ALSO set (not in this file):
#   ADMIN_TOKEN           = (same long secret as on your EC2 backend)
#   NEXT_PUBLIC_ADMIN_ADDRESS = (your admin wallet address, lowercase)

NEXT_PUBLIC_PHAROS_RPC_URL=https://atlantic.dplabs-internal.com
NEXT_PUBLIC_PHAROS_CHAIN_ID=688689
NEXT_PUBLIC_PHAROS_EXPLORER_URL=https://atlantic.pharosscan.xyz

NEXT_PUBLIC_USDC_ADDRESS=$($env:PATHUSD_ADDRESS)

NEXT_PUBLIC_DOGE_ADDRESS=$DOGE
NEXT_PUBLIC_MINER_ADDRESS=$MINER
NEXT_PUBLIC_PAIR_ADDRESS=$PAIR
NEXT_PUBLIC_LM_ADDRESS=$LM
NEXT_PUBLIC_ROUTER_ADDRESS=$ROUTER
NEXT_PUBLIC_NAMES_ADDRESS=$NAMES

NEXT_PUBLIC_BACKEND_URL=https://api.dogeforge.fun
"@
Set-Content -Path $vercelEnv -Value $prod -Encoding UTF8
Write-Host "Wrote $vercelEnv (copy-paste into Vercel)" -ForegroundColor Cyan

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Local dev: restart 'npm run dev' to pick up new addresses." -ForegroundColor Yellow
Write-Host "Vercel:    paste contents of scripts\vercel-env.txt into Settings -> Environment Variables." -ForegroundColor Yellow
Write-Host "Backend:   on EC2, edit ~/DF/backend/.env -> MINER_ADDRESS, LM_ADDRESS, PATHUSD_ADDRESS, then 'pm2 restart all'." -ForegroundColor Yellow
