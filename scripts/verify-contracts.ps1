# Verify all DOGE FORGE contracts on Arc testnet block explorer.
#
# Arcscan exposes a Blockscout/Etherscan-compatible API at
#   https://testnet.arcscan.app/api
# `forge verify-contract` with `--verifier blockscout` handles it.
#
# Compiler settings MUST match contracts/foundry.toml exactly:
#   solc 0.8.24, optimizer on (200 runs), via_ir on, evm default.
#
# Re-running is safe: already-verified contracts return "Already Verified".

$ErrorActionPreference = "Stop"
$repoRoot  = Split-Path -Parent $PSScriptRoot
$contracts = Join-Path $repoRoot "contracts"
$forge     = "C:\Users\USER\.foundry\bin\forge.exe"
$cast      = "C:\Users\USER\.foundry\bin\cast.exe"

$CHAIN_ID    = "5042002"
$VERIFIER    = "blockscout"
$VERIFIER_URL = "https://testnet.arcscan.app/api"
$COMPILER    = "v0.8.24+commit.e11b9ed9"

# Deployed addresses + constructor-arg signatures + values.
# Values come from contracts/broadcast/*/5042002/run-latest.json (CREATE txs).
#
# ViaIr: per deployment snapshot. Commit 4f6b47b flipped the compiler flag
# via_ir from false to true. Contracts deployed BEFORE that commit must be
# verified with via_ir=false, contracts deployed AFTER with via_ir=true,
# otherwise the runtime bytecode hash won't match.
$contractsToVerify = @(
  @{
    Name        = "DOGE";
    Path        = "src/DOGE.sol:DOGE";
    Address     = "0x25497e0aC492B79A3781fed41762F106f9158F71";
    Ctor        = "constructor(address,address)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x7742E5bDabfFb328806Ce55407E3420d8503A16B");
    ViaIr       = $false;
  },
  @{
    Name        = "Miner";
    Path        = "src/Miner.sol:Miner";
    Address     = "0x1574EEA1DA5e204CC035968D480aE51BF6505834";
    Ctor        = "constructor(address,address,address,address,uint8)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x3600000000000000000000000000000000000000", "0x25497e0aC492B79A3781fed41762F106f9158F71", "0x7742E5bDabfFb328806Ce55407E3420d8503A16B", "6");
    ViaIr       = $false;
  },
  @{
    Name        = "TdogePair";
    Path        = "src/TdogePair.sol:TdogePair";
    Address     = "0x96da2A3DeE82295e752bdE12541120ccCDFaf407";
    Ctor        = "constructor(address,address)";
    Args        = @("0x3600000000000000000000000000000000000000", "0x25497e0aC492B79A3781fed41762F106f9158F71");
    ViaIr       = $false;
  },
  @{
    Name        = "LiquidityManager";
    Path        = "src/LiquidityManager.sol:LiquidityManager";
    Address     = "0x7232883c1abC50DCfaae96394f55f14DF927CF38";
    Ctor        = "constructor(address,address,address,address,uint8,uint256)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x3600000000000000000000000000000000000000", "0x25497e0aC492B79A3781fed41762F106f9158F71", "0x96da2A3DeE82295e752bdE12541120ccCDFaf407", "6", "21000000000000000000000000");
    ViaIr       = $false;
  },
  @{
    Name        = "TdogeRouter";
    Path        = "src/TdogeRouter.sol:TdogeRouter";
    Address     = "0x48AB91aDaBF212c1cB178AA3F5533D2193817A00";
    Ctor        = "constructor(address)";
    Args        = @("0x96da2A3DeE82295e752bdE12541120ccCDFaf407");
    ViaIr       = $false;
  },
  @{
    Name        = "TdogeFactory";
    Path        = "src/TdogeFactory.sol:TdogeFactory";
    Address     = "0x75E4CBF4D804A15a945D5758d1b4976E1c6ceAE9";
    Ctor        = "constructor(address)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7");
    ViaIr       = $true;
  },
  @{
    Name        = "ForgeRouter";
    Path        = "src/ForgeRouter.sol:ForgeRouter";
    Address     = "0xffBD254859EbF9fC4808410f95f8C4E7998846fB";
    Ctor        = "constructor(address,address,address)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x75E4CBF4D804A15a945D5758d1b4976E1c6ceAE9", "0x7232883c1abC50DCfaae96394f55f14DF927CF38");
    ViaIr       = $true;
  },
  @{
    Name        = "ForgeAggregator";
    Path        = "src/ForgeAggregator.sol:ForgeAggregator";
    Address     = "0x2167b92df8B75D61D4482CA18fed8ab43648B9De";
    Ctor        = "constructor(address,address,address)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x4AA8c7Ac458479d9A4FA5c1481e03061ac76824A", "0x7232883c1abC50DCfaae96394f55f14DF927CF38");
    ViaIr       = $false;
  },
  @{
    Name        = "TdogeNames";
    Path        = "src/TdogeNames.sol:TdogeNames";
    Address     = "0x998AE581c462Da5aa161b5F89F4d4fE40b5eAb35";
    Ctor        = "constructor(address,address,address,address,uint256)";
    Args        = @("0x55a0096ce6031d21e65DBF37416F576D502f11A7", "0x3600000000000000000000000000000000000000", "0x1574EEA1DA5e204CC035968D480aE51BF6505834", "0x7232883c1abC50DCfaae96394f55f14DF927CF38", "100000");
    ViaIr       = $false;
  }
)

Push-Location $contracts
try {
  foreach ($c in $contractsToVerify) {
    Write-Host "`n=== Verifying $($c.Name) @ $($c.Address) ===" -ForegroundColor Cyan

    # Encode constructor args via cast. Empty-arg ctors would need this skipped.
    $encoded = & $cast abi-encode $c.Ctor @($c.Args)
    if ($LASTEXITCODE -ne 0) { throw "cast abi-encode failed for $($c.Name)" }
    $encoded = $encoded.Trim() -replace '^0x',''

    $verifyArgs = @(
      "verify-contract",
      "--chain-id", $CHAIN_ID,
      "--verifier", $VERIFIER,
      "--verifier-url", $VERIFIER_URL,
      "--compiler-version", $COMPILER,
      "--num-of-optimizations", "200",
      "--constructor-args", $encoded,
      "--watch",
      $c.Address, $c.Path
    )
    if ($c.ViaIr) { $verifyArgs += "--via-ir" }

    & $forge @verifyArgs

    if ($LASTEXITCODE -ne 0) {
      Write-Host "  ! $($c.Name) verification reported an error (may already be verified)" -ForegroundColor Yellow
    } else {
      Write-Host "  OK $($c.Name) verified" -ForegroundColor Green
    }
  }
}
finally {
  Pop-Location
}

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Check each contract on https://testnet.arcscan.app/address/" -ForegroundColor Cyan
