# Copies the RoninFlow Sync Expert Advisors into every MetaTrader 4/5 installed for this Windows user.
# Usage (from the journal folder):  npm run addon:mt
$ErrorActionPreference = "Stop"
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }
Write-Host ""
Write-Host "RoninFlow Sync - MetaTrader 4/5 installer" -ForegroundColor Cyan
Write-Host ""
$base = Join-Path $env:APPDATA "MetaQuotes\Terminal"
if (-not (Test-Path $base)) { Write-Host "  X  No MetaTrader data folder found ($base). Start MetaTrader once, then run this again." -ForegroundColor Red; exit 1 }
$n = 0
Get-ChildItem $base -Directory | ForEach-Object {
  $mq5 = Join-Path $_.FullName "MQL5\Experts"
  $mq4 = Join-Path $_.FullName "MQL4\Experts"
  if (Test-Path $mq5) { Copy-Item (Join-Path $PSScriptRoot "TradeJournalSync.mq5") $mq5 -Force; Ok "MetaTrader 5: $mq5"; $n++ }
  if (Test-Path $mq4) { Copy-Item (Join-Path $PSScriptRoot "TradeJournalSync.mq4") $mq4 -Force; Ok "MetaTrader 4: $mq4"; $n++ }
}
New-Item -ItemType Directory -Force -Path (Join-Path $base "Common\Files\TradeJournal") | Out-Null
if ($n -eq 0) {
  Write-Host "  !  No MQL4/MQL5 folders found. In MetaTrader use File -> Open Data Folder, and copy the .mq4/.mq5 file into MQL4\Experts or MQL5\Experts yourself." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Next, in MetaTrader:" -ForegroundColor Cyan
Write-Host "  1. Navigator -> Expert Advisors -> right-click -> Refresh. (If it isn't listed: open it in MetaEditor and press F7.)"
Write-Host "  2. Drag 'TradeJournalSync' onto any chart and press OK. No 'Allow WebRequest' or algo trading is needed."
Write-Host "  3. The Experts tab shows '[RoninFlow] started'. Closed trades reach the journal within ~10 seconds."
Write-Host "  Keep that chart open; one chart per account (terminal) is enough."
Write-Host ""
