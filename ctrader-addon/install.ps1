# Copies the RoninFlow Sync cBot to the clipboard so you can paste it into cTrader.
# Usage (from the journal folder):  npm run addon:ctrader
$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "RoninFlow Sync + RoninFlow Suite - cTrader" -ForegroundColor Cyan
Write-Host ""
Get-Content (Join-Path $PSScriptRoot "TradeJournalSync.cs") -Raw | Set-Clipboard
Write-Host "  OK The cBot's code is on your clipboard." -ForegroundColor Green
Write-Host ""
Write-Host "Next, in cTrader (version 5 or newer):" -ForegroundColor Cyan
Write-Host "  1. Algo (left bar) -> cBots -> New -> name it TradeJournalSync."
Write-Host "  2. Select all the template code, paste over it (Ctrl+A, Ctrl+V), then Build (Ctrl+B)."
Write-Host "  3. Add an instance (any symbol), press Start. The log shows '[RoninFlow] started'."
Write-Host "  Run one instance for each account you want synced. It never places trades."
Write-Host ""
Read-Host "Press Enter when the cBot is built to copy the RoninFlow Suite indicator (or Ctrl+C to skip)" | Out-Null
Get-Content (Join-Path $PSScriptRoot "RoninFlowSuite.cs") -Raw | Set-Clipboard
Write-Host "  OK The RoninFlow Suite indicator's code is on your clipboard." -ForegroundColor Green
Write-Host "  1. Algo -> Indicators -> New -> name it RoninFlowSuite."
Write-Host "  2. Paste over the template (Ctrl+A, Ctrl+V), then Build (Ctrl+B)."
Write-Host "  3. On a chart: Indicators -> RoninFlowSuite (account panel, your trades, gamma, news, heatmap, alerts)."
Write-Host "If building shows errors, copy them into an issue at https://github.com/coreyheyman/roninflow/issues" -ForegroundColor DarkGray
Write-Host ""
