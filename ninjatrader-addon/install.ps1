# Installs the RoninFlow Sync add-on into NinjaTrader 8.
# Usage (from the journal folder):  npm run addon:nt
# NinjaTrader compiles NinjaScript itself, so no SDK is needed — after this, press F5 in the NinjaScript Editor.
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Host ""; Write-Host "  X  $m" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }

Write-Host ""
Write-Host "RoninFlow Sync - NinjaTrader 8 add-on installer" -ForegroundColor Cyan
Write-Host ""

$docs = [Environment]::GetFolderPath("MyDocuments")   # follows OneDrive-redirected Documents too
$nt = Join-Path $docs "NinjaTrader 8"
if (-not (Test-Path (Join-Path $nt "bin\Custom"))) { Fail "Couldn't find '$nt\bin\Custom'. Is NinjaTrader 8 installed and has it been started at least once?" }
Ok "NinjaTrader 8 user folder: $nt"

$dest = Join-Path $nt "bin\Custom\AddOns"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $PSScriptRoot "JournalSync.cs") (Join-Path $dest "TradeJournalSync.cs") -Force
Ok "Copied the add-on to $dest\TradeJournalSync.cs"

$cfg = Join-Path $nt "journal-sync.txt"
if (-not (Test-Path $cfg)) {
@"
# RoninFlow Sync settings (lines starting with # are ignored)
# Where to send executions. The default is the journal on this PC (no token needed).
url=http://127.0.0.1:5173/api/connect/ingest
# If the journal runs on another computer, use its address and paste the token from Connections -> Webhook / API:
# url=https://my-journal.example.ts.net/api/connect/ingest
# token=
# Only send these accounts (comma separated). Leave out to send all except Backtest/Playback:
# accounts=Sim101
# Only if NinjaTrader's time zone (Tools > Options > General) differs from this PC's, e.g.:
# timezone=Eastern Standard Time
"@ | Set-Content -Encoding UTF8 $cfg
  Ok "Created settings file $cfg"
} else { Ok "Kept your settings in $cfg" }

Write-Host ""
Write-Host "Next, in NinjaTrader 8:" -ForegroundColor Cyan
Write-Host "  1. Control Center -> New -> NinjaScript Editor, then press F5 (compile)."
Write-Host "  2. Open New -> NinjaScript Output to see '[RoninFlow] started'."
Write-Host "  3. Place a trade (Sim101 is fine) - it shows up in the journal within ~15 seconds."
Write-Host "If compiling shows errors, copy them and send them to Claude." -ForegroundColor DarkGray
Write-Host ""
