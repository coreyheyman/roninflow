# Builds the Journal Sync add-on and installs it into ATAS X.
# Usage: Start menu -> RoninFlow -> Install platform add-ons -> ATAS   (from the source code: npm run addon)
#    or:  powershell -ExecutionPolicy Bypass -File atas-addon\install.ps1 [-AtasDir "D:\ATAS X"]
param([string]$AtasDir = "")

$ErrorActionPreference = "Stop"
function Fail($msg) { Write-Host ""; Write-Host "  X  $msg" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($msg) { Write-Host "  OK $msg" -ForegroundColor Green }

Write-Host ""
Write-Host "Journal Sync - ATAS X add-on installer" -ForegroundColor Cyan
Write-Host ""

# 1. Find ATAS X: the folder with ATAS.Indicators.dll
function Has-Dll($dir) { $dir -and (Test-Path -LiteralPath (Join-Path $dir "ATAS.Indicators.dll")) }
# a folder, an ATAS .exe or a shortcut -> the folder holding ATAS.Indicators.dll (looks a few levels down too)
function Resolve-Atas($p) {
  if (-not $p) { return $null }
  $p = $p.Trim().Trim('"')
  if ($p -like "*.lnk" -and (Test-Path -LiteralPath $p)) { try { $p = (New-Object -ComObject WScript.Shell).CreateShortcut($p).TargetPath } catch { return $null } }
  if (Test-Path -LiteralPath $p -PathType Leaf) { $p = Split-Path $p -Parent }
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { return $null }
  if (Has-Dll $p) { return (Resolve-Path -LiteralPath $p).Path }
  $f = Get-ChildItem -LiteralPath $p -Filter "ATAS.Indicators.dll" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { return $f.DirectoryName }
  return $null
}
function Find-Atas {
  $c = New-Object System.Collections.Generic.List[string]
  foreach ($x in @($AtasDir, $env:ATAS_X_DIR)) { if ($x) { $c.Add($x) } }
  # ATAS running right now
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "ATAS*" } | ForEach-Object { try { if ($_.Path) { $c.Add((Split-Path $_.Path -Parent)) } } catch {} }
  # installed programs (Apps & features)
  $keys = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*ATAS*" } | ForEach-Object {
    if ($_.InstallLocation) { $c.Add($_.InstallLocation) }
    if ($_.DisplayIcon) { $c.Add(($_.DisplayIcon -split ',')[0]) }
  }
  # Start menu and desktop shortcuts
  $menus = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath("Desktop"), "$env:PUBLIC\Desktop"
  Get-ChildItem $menus -Filter "*ATAS*.lnk" -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object { $c.Add($_.FullName) }
  # the usual places, on every drive
  $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root -match '^[A-Z]:\\$' -and $_.Used -gt 0 } | ForEach-Object { $_.Root }
  foreach ($d in $drives) { foreach ($sub in "Program Files\ATAS X", "Program Files (x86)\ATAS X", "ATAS X", "Program Files\ATAS", "ATAS") { $c.Add((Join-Path $d $sub)) } }
  $c.Add("$env:LOCALAPPDATA\Programs\ATAS X"); $c.Add("$env:LOCALAPPDATA\ATAS X")
  foreach ($x in $c) { $r = Resolve-Atas $x; if ($r) { return $r } }
  # last resort: any folder with "ATAS" in its name in the program folders of every drive
  $roots = @("$env:LOCALAPPDATA\Programs", "$env:LOCALAPPDATA") + ($drives | ForEach-Object { $_; (Join-Path $_ "Program Files"); (Join-Path $_ "Program Files (x86)") })
  foreach ($root in $roots) {
    foreach ($dir in @(Get-ChildItem -LiteralPath $root -Directory -Filter "*ATAS*" -ErrorAction SilentlyContinue)) { $r = Resolve-Atas $dir.FullName; if ($r) { return $r } }
  }
  return $null
}
Write-Host "  .. looking for ATAS X"
$atas = Find-Atas
while (-not $atas) {
  Write-Host ""
  Write-Host "  !  Couldn't find ATAS X on this PC automatically." -ForegroundColor Yellow
  Write-Host "     To find its folder: right-click the ATAS X shortcut (Start menu or desktop) -> Open file location."
  Write-Host "     (If that opens the Start menu folder, right-click the shortcut there -> Open file location again.)"
  Write-Host "     Then click the address bar, copy the path and paste it here. A shortcut or ATAS .exe works too."
  if (-not [Environment]::UserInteractive) { Fail "Run this again with the folder:  -AtasDir `"<your ATAS X folder>`"" }
  $answer = Read-Host "     ATAS X folder (Enter to cancel)"
  if (-not $answer) { Fail "Cancelled - nothing was installed." }
  $atas = Resolve-Atas $answer
  if (-not $atas) { Write-Host "     No ATAS.Indicators.dll in or under `"$answer`"." -ForegroundColor Red }
}
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
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Copy the error lines above into an issue at https://github.com/coreyheyman/roninflow/issues" }
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
Write-Host "Keep RoninFlow running and watch for the 'ATAS live' badge at the top of the journal." -ForegroundColor Cyan
Write-Host ""
