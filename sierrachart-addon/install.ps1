# Copies the RoninFlow Sync study into Sierra Chart's ACS_Source folder.
# Usage (from the journal folder):  npm run addon:sierra        (or ... -SierraPath "D:\SierraChart")
param([string]$SierraPath = "")
$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "RoninFlow Sync - Sierra Chart study installer" -ForegroundColor Cyan
Write-Host ""
$roots = @($SierraPath, "C:\SierraChart", "D:\SierraChart", "$env:USERPROFILE\SierraChart", "C:\SierraChart2") | Where-Object { $_ -and (Test-Path (Join-Path $_ "ACS_Source")) }
if (-not $roots) { Write-Host "  X  Couldn't find Sierra Chart. Run again with its folder:  powershell -ExecutionPolicy Bypass -File sierrachart-addon\install.ps1 -SierraPath 'D:\SierraChart'" -ForegroundColor Red; exit 1 }
foreach ($r in $roots) {
  Copy-Item (Join-Path $PSScriptRoot "TradeJournalSync.cpp") (Join-Path $r "ACS_Source\TradeJournalSync.cpp") -Force
  Write-Host "  OK Copied to $r\ACS_Source\TradeJournalSync.cpp" -ForegroundColor Green
}
New-Item -ItemType Directory -Force -Path (Join-Path $env:LOCALAPPDATA "TradeJournal\drop") | Out-Null
Write-Host ""
Write-Host "Next, in Sierra Chart:" -ForegroundColor Cyan
Write-Host "  1. Analysis -> Build Custom Studies DLL -> pick TradeJournalSync.cpp -> Remote Build (Sierra compiles it for you)."
Write-Host "  2. Open the chart you trade from: Analysis -> Studies -> Add Custom Study -> RoninFlow Sync -> Add -> OK."
Write-Host "  3. Message Log shows 'RoninFlow Sync started'. Fills reach the journal within ~10 seconds."
Write-Host "  Add it to each symbol's chart you trade (it reads that chart's symbol + trade account)."
Write-Host "If the build shows errors, copy them into an issue at https://github.com/coreyheyman/roninflow/issues" -ForegroundColor DarkGray
Write-Host ""
