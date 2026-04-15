# Seed ~10 USDC on each stablecoin pair via ForgeRouter.addLiquidity.
# Skips any token the admin wallet doesn't already hold.

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$frontend  = Join-Path $repoRoot "frontend"
$forge     = "C:\Users\USER\.foundry\bin\forge.exe"
$RPC       = "https://rpc.testnet.arc.network"

# Load contracts\.env for PRIVATE_KEY
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

# Pull ROUTER_ADDRESS from frontend\.env.local (written by deploy-dex.ps1).
$envLocal = Join-Path $frontend ".env.local"
$localContent = Get-Content $envLocal -Raw
if ($localContent -match "(?m)^\s*NEXT_PUBLIC_ROUTER_ADDRESS\s*=\s*(0x[a-fA-F0-9]{40})") {
  $env:ROUTER_ADDRESS = $matches[1]
} else {
  throw "NEXT_PUBLIC_ROUTER_ADDRESS not found in $envLocal. Run deploy-dex.ps1 first."
}
$env:USDC_ADDRESS = "0x3600000000000000000000000000000000000000"
if (-not $env:SEED_USDC_AMOUNT) { $env:SEED_USDC_AMOUNT = "10" }

Write-Host "Router : $env:ROUTER_ADDRESS"
Write-Host "Seed   : $env:SEED_USDC_AMOUNT USDC per side"

Push-Location $contracts
try {
  & $forge script "script/SeedLiquidity.s.sol:SeedLiquidity" `
    --rpc-url $RPC `
    --broadcast `
    --gas-estimate-multiplier 200
}
finally {
  Pop-Location
}

Write-Host "`nDone. Reminder: admin wallet needed USDC + EURC (+ USYC + WUSDC if held) for each pair seeded." -ForegroundColor Yellow
