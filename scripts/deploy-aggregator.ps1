# Deploy ForgeAggregator to Arc Testnet and wire it into frontend/.env.local.
#
# Prerequisite: contracts\.env already has PRIVATE_KEY set (from deploy-arc.ps1).

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$frontend  = Join-Path $repoRoot "frontend"
$forge     = "C:\Users\USER\.foundry\bin\forge.exe"

$UNITFLOW_ROUTER = "0x4AA8c7Ac458479d9A4FA5c1481e03061ac76824A"
$LM_ADDRESS      = "0x7232883c1abC50DCfaae96394f55f14DF927CF38"
$RPC             = "https://rpc.testnet.arc.network"

# --- load contracts\.env for PRIVATE_KEY ---
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

$env:UNITFLOW_ROUTER_ADDRESS = $UNITFLOW_ROUTER
$env:LM_ADDRESS = $LM_ADDRESS

Push-Location $contracts
try {
  Write-Host "`n=== Deploying ForgeAggregator ===" -ForegroundColor Cyan
  $out = & $forge script "script/DeployForgeAggregator.s.sol:DeployForgeAggregator" `
    --rpc-url $RPC `
    --broadcast `
    --gas-estimate-multiplier 200 2>&1
  Write-Host ($out -join "`n")

  $addr = ($out | Select-String 'ForgeAggregator\s*:\s*(0x[a-fA-F0-9]{40})' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
  if (-not $addr) { throw "Could not parse deployed address" }
  Write-Host "`n  AGGREGATOR = $addr" -ForegroundColor Green
}
finally {
  Pop-Location
}

# --- append to frontend\.env.local ---
$envLocal = Join-Path $frontend ".env.local"
$content = Get-Content $envLocal -Raw
if ($content -match "NEXT_PUBLIC_AGGREGATOR_ADDRESS=") {
  $content = $content -replace "NEXT_PUBLIC_AGGREGATOR_ADDRESS=.*", "NEXT_PUBLIC_AGGREGATOR_ADDRESS=$addr"
} else {
  $content = $content.TrimEnd() + "`r`nNEXT_PUBLIC_AGGREGATOR_ADDRESS=$addr`r`n"
}
Set-Content -Path $envLocal -Value $content -Encoding UTF8
Write-Host "Updated $envLocal" -ForegroundColor Cyan

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Also add on Vercel:" -ForegroundColor Yellow
Write-Host "  NEXT_PUBLIC_AGGREGATOR_ADDRESS=$addr" -ForegroundColor Yellow
Write-Host "Then Redeploy (uncheck 'Use existing Build Cache')." -ForegroundColor Yellow
