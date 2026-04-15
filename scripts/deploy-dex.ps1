# Deploy the owned-DEX stack (Factory + Router + pairs) on Arc Testnet and
# wire the addresses into frontend/.env.local.
#
# Prereq: contracts\.env already contains PRIVATE_KEY (from deploy-arc.ps1)
#         and the admin wallet has USDC for gas.

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$frontend  = Join-Path $repoRoot "frontend"
$forge     = "C:\Users\USER\.foundry\bin\forge.exe"
$RPC       = "https://rpc.testnet.arc.network"

# --- load contracts\.env ---
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

# Inputs the deploy script reads from the environment.
$env:LM_ADDRESS    = "0x7232883c1abC50DCfaae96394f55f14DF927CF38"
$env:DOGE_ADDRESS  = "0x25497e0aC492B79A3781fed41762F106f9158F71"
$env:USDC_ADDRESS  = "0x3600000000000000000000000000000000000000"
$env:PAIR_ADDRESS  = "0x96da2A3DeE82295e752bdE12541120ccCDFaf407"

Push-Location $contracts
try {
  Write-Host "`n=== Deploying Factory + Router + pairs ===" -ForegroundColor Cyan
  $out = & $forge script "script/DeployForgeDex.s.sol:DeployForgeDex" `
    --rpc-url $RPC `
    --broadcast `
    --gas-estimate-multiplier 200 2>&1
  Write-Host ($out -join "`n")

  function Extract([string[]]$lines, [string]$label) {
    foreach ($l in $lines) {
      if ($l -match "$label\s*:\s*(0x[a-fA-F0-9]{40})") { return $matches[1] }
    }
    return $null
  }

  $FACTORY   = Extract $out "TdogeFactory"
  $ROUTER    = Extract $out "ForgeRouter"
  $EURC_PAIR = Extract $out "EURC/USDC"
  $USYC_PAIR = Extract $out "USYC/USDC"
  $WUSDC_PAIR = Extract $out "WUSDC/USDC"

  if (-not $FACTORY -or -not $ROUTER) { throw "Failed to parse addresses from deploy output" }

  Write-Host "`n  FACTORY    = $FACTORY"    -ForegroundColor Green
  Write-Host "  ROUTER     = $ROUTER"       -ForegroundColor Green
  Write-Host "  EURC pair  = $EURC_PAIR"    -ForegroundColor Green
  Write-Host "  USYC pair  = $USYC_PAIR"    -ForegroundColor Green
  Write-Host "  WUSDC pair = $WUSDC_PAIR"   -ForegroundColor Green
}
finally {
  Pop-Location
}

# --- patch frontend\.env.local ---
$envLocal = Join-Path $frontend ".env.local"
$content = Get-Content $envLocal -Raw
function Upsert([ref]$c, [string]$key, [string]$val) {
  $pattern = "(?m)^\s*$key\s*=.*$"
  if ($c.Value -match $pattern) {
    $c.Value = [regex]::Replace($c.Value, $pattern, "$key=$val")
  } else {
    $c.Value = $c.Value.TrimEnd() + "`r`n$key=$val`r`n"
  }
}
Upsert ([ref]$content) "NEXT_PUBLIC_FACTORY_ADDRESS" $FACTORY
Upsert ([ref]$content) "NEXT_PUBLIC_ROUTER_ADDRESS"  $ROUTER
# Remove deprecated vars; no-op if absent.
$content = $content -replace "(?m)^\s*NEXT_PUBLIC_UNITFLOW_[A-Z_]+\s*=.*\r?\n?", ""
$content = $content -replace "(?m)^\s*NEXT_PUBLIC_AGGREGATOR_ADDRESS\s*=.*\r?\n?", ""
Set-Content -Path $envLocal -Value $content -Encoding UTF8
Write-Host "`nUpdated $envLocal" -ForegroundColor Cyan

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Set these on Vercel (and redeploy, uncheck build cache):" -ForegroundColor Yellow
Write-Host "  NEXT_PUBLIC_FACTORY_ADDRESS = $FACTORY"
Write-Host "  NEXT_PUBLIC_ROUTER_ADDRESS  = $ROUTER"
Write-Host "Remove: NEXT_PUBLIC_UNITFLOW_FACTORY, NEXT_PUBLIC_UNITFLOW_ROUTER, NEXT_PUBLIC_AGGREGATOR_ADDRESS"
Write-Host "`nNext: seed liquidity via scripts\seed-liquidity.ps1" -ForegroundColor Yellow
