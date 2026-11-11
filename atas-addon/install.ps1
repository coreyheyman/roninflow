# Builds the Journal Sync add-on and installs it into ATAS X.
# Usage (from the RoninFlow folder):  npm run addon
#    or:  powershell -ExecutionPolicy Bypass -File atas-addon\install.ps1 [-AtasDir "C:\Program Files\ATAS X"]
param([string]$AtasDir = "")

$ErrorActionPreference = "Stop"
function Fail($msg) { Write-Host ""; Write-Host "  X  $msg" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($msg) { Write-Host "  OK $msg" -ForegroundColor Green }

Write-Host ""
Write-Host "Journal Sync - ATAS X add-on installer" -ForegroundColor Cyan
Write-Host ""

# 1. Find ATAS X
$candidates = @($AtasDir, $env:ATAS_X_DIR, "C:\Program Files\ATAS X", "${env:LOCALAPPDATA}\Programs\ATAS X", "C:\Program Files (x86)\ATAS X") | Where-Object { $_ }
$atas = $candidates | Where-Object { Test-Path (Join-Path $_ "ATAS.Indicators.dll") } | Select-Object -First 1
if (-not $atas) {
  $found = Get-ChildItem -Path "C:\Program Files", "${env:LOCALAPPDATA}\Programs" -Filter "ATAS.Indicators.dll" -Recurse -ErrorAction SilentlyContinue -Depth 2 | Select-Object -First 1
  if ($found) { $atas = $found.DirectoryName }
}
if (-not $atas) { Fail "Couldn't find ATAS X (ATAS.Indicators.dll). Run again with:  npm run addon -- -AtasDir `"<your ATAS X folder>`"" }
Ok "ATAS X found at $atas"

# 2. .NET 10 SDK
$sdks = (& dotnet --list-sdks 2>$null) -join "`n"
if (-not ($sdks -match "(?m)^10\.")) { Fail ".NET 10 SDK not found. Install it from https://dotnet.microsoft.com/download/dotnet/10.0 (Windows x64 SDK), then run this again." }
Ok ".NET 10 SDK found"

# 3. Build
$proj = Join-Path $PSScriptRoot "JournalSync.csproj"
Write-Host "  .. building"
Remove-Item (Join-Path $PSScriptRoot "obj") -Recurse -Force -ErrorAction SilentlyContinue  # stale restore files from the old project name
& dotnet build $proj -c Release -nologo -v quiet "-p:ATAS_BASE=$atas"
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Copy the error lines above and send them to Claude." }
$dll = Get-ChildItem (Join-Path $PSScriptRoot "bin\Release") -Recurse -Filter "JournalSync.dll" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $dll) { Fail "Build succeeded but JournalSync.dll wasn't found." }
Ok "Built $($dll.FullName)"

# 4. Install into ATAS X
$dest = Join-Path $env:APPDATA "ATAS X\Indicators"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
if (Get-Process -Name "ATAS*" -ErrorAction SilentlyContinue) {
  Write-Host "  !  ATAS X is running. Close it, then press Enter to install (or Ctrl+C to cancel)." -ForegroundColor Yellow
  Read-Host | Out-Null
}
Copy-Item $dll.FullName $dest -Force
Ok "Installed to $dest\JournalSync.dll"
# remove the add-on's old name so ATAS doesn't list it twice
$old = Join-Path $dest "IQJournalSync.dll"
if (Test-Path $old) { Remove-Item $old -Force; Ok "Removed the old IQJournalSync.dll" }

Write-Host ""
Write-Host "Next: start ATAS X, open any chart -> Indicators -> add 'Journal Sync'." -ForegroundColor Cyan
Write-Host "Keep 'npm run dev' running and watch the 'ATAS live' badge in the journal." -ForegroundColor Cyan
Write-Host ""
