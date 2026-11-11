# Builds the RoninFlow Sync strategy (beta) into Quantower.
# Usage (from the journal folder):  npm run addon:qt            (or: ... -QuantowerPath "D:\Quantower")
# Needs the free .NET SDK (https://dotnet.microsoft.com/download) because Quantower runs compiled strategies.
param([string]$QuantowerPath = "")
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Host ""; Write-Host "  X  $m" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }

Write-Host ""
Write-Host "RoninFlow Sync - Quantower strategy installer (beta)" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Fail "The .NET SDK isn't installed. Get it from https://dotnet.microsoft.com/download (the SDK, not just the runtime), then run this again." }

# find Quantower: the folder that has TradingPlatform\v*\bin\TradingPlatform.BusinessLayer.dll
$roots = @($QuantowerPath, "C:\Quantower", "$env:USERPROFILE\Quantower", "$env:LOCALAPPDATA\Quantower", "$env:ProgramFiles\Quantower", "D:\Quantower") | Where-Object { $_ -and (Test-Path $_) }
$dll = $null
foreach ($r in $roots) {
  $dll = Get-ChildItem -Path (Join-Path $r "TradingPlatform") -Filter "TradingPlatform.BusinessLayer.dll" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq "bin" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($dll) { $root = $r; break }
}
if (-not $dll) { Fail "Couldn't find Quantower. Run again with its folder:  powershell -ExecutionPolicy Bypass -File quantower-addon\install.ps1 -QuantowerPath 'D:\Quantower'" }
$bin = $dll.Directory.FullName
Ok "Quantower: $bin"

# match Quantower's .NET version (read from its runtimeconfig; recent versions use .NET 8)
$fw = "net8.0-windows"
$rc = Get-ChildItem -Path $bin -Filter "*.runtimeconfig.json" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($rc) {
  try { $j = Get-Content $rc.FullName -Raw | ConvertFrom-Json; $t = $j.runtimeOptions.tfm; if ($t) { $fw = $t; if ($fw -notmatch "-windows") { $fw = "$fw-windows" } } } catch { }
} elseif (-not (Test-Path (Join-Path $bin "coreclr.dll")) -and (Get-ChildItem -Path $bin -Filter "*.exe.config" -ErrorAction SilentlyContinue)) { $fw = "net472" }  # older .NET Framework builds
Ok "Target framework: $fw"

$out = Join-Path $root "Settings\Scripts\Strategies\TradeJournalSync"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Push-Location $PSScriptRoot
try {
  & dotnet build "TradeJournalSync.csproj" -c Release -o "$out" "-p:QtBin=$bin" "-p:QtFramework=$fw" -nologo -v q
  if ($LASTEXITCODE -ne 0) { Fail "The build failed. Copy the errors above into an issue at https://github.com/coreyheyman/roninflow/issues" }
} finally { Pop-Location }
Ok "Built into $out"

Write-Host ""
Write-Host "Next, in Quantower:" -ForegroundColor Cyan
Write-Host "  1. Restart Quantower (it loads strategies at start)."
Write-Host "  2. Open Strategies Manager, pick 'RoninFlow Sync' and press Run."
Write-Host "  3. Its log shows '[RoninFlow] started'. Fills appear in the journal within ~15 seconds."
Write-Host "This connector is in beta - if something looks off, open an issue at https://github.com/coreyheyman/roninflow/issues with the strategy log" -ForegroundColor DarkGray
Write-Host ""
