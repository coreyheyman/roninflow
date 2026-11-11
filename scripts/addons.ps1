# Menu for installing the platform add-ons (used by the Windows installer's Start menu entry).
$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
$items = @(
  @("ATAS", "atas-addon\install.ps1"),
  @("NinjaTrader 8", "ninjatrader-addon\install.ps1"),
  @("MetaTrader 4 / 5", "metatrader-addon\install.ps1"),
  @("cTrader", "ctrader-addon\install.ps1"),
  @("Quantower (beta, needs the .NET SDK)", "quantower-addon\install.ps1"),
  @("Sierra Chart", "sierrachart-addon\install.ps1")
)
while ($true) {
  Write-Host ""
  Write-Host "RoninFlow - install a platform add-on" -ForegroundColor Cyan
  for ($i = 0; $i -lt $items.Count; $i++) { Write-Host ("  {0}. {1}" -f ($i + 1), $items[$i][0]) }
  Write-Host "  Q. Quit"
  $c = Read-Host "Choose"
  if ($c -match '^[qQ]') { break }
  $n = 0; if (-not [int]::TryParse($c, [ref]$n) -or $n -lt 1 -or $n -gt $items.Count) { continue }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root $items[$n - 1][1])
}
