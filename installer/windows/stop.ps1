# Stops the background RoninFlow server started by the installer's launcher: any node.exe running from this app's
# own node folder. The installer also runs this (from a temp copy, with -AppDir) before replacing files on an update.
param([string]$AppDir = $PSScriptRoot)
$node = Join-Path $AppDir 'node\node.exe'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $node) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# give Windows a moment to release node.exe so the installer can replace it
Start-Sleep -Milliseconds 800
