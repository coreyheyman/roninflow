# Allows phones/tablets on your home (Private) network to reach RoninFlow on port 5173.
# Usage: npm run phone:firewall   (asks for administrator approval once)
$RuleName = "Trade Journal (port 5173)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Asking for administrator permission to add a Windows Firewall rule..." -ForegroundColor Cyan
  try { Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" } catch { Write-Host "  X  Permission was declined - the rule wasn't added." -ForegroundColor Red; exit 1 }
} else {
  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private -Description "Lets devices on your home network open RoninFlow (PIN protected)." | Out-Null
  Write-Host "  OK Firewall rule added (Private networks only)." -ForegroundColor Green
  Start-Sleep -Seconds 2
  exit 0
}
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) { Write-Host "  OK Firewall rule '$RuleName' is in place (Private networks only)." -ForegroundColor Green }
$profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
foreach ($p in $profiles) {
  if ($p.NetworkCategory -eq 'Public') { Write-Host "  !  Your network '$($p.Name)' is set to Public. Change it to Private (Settings > Network & internet > Wi-Fi/Ethernet > your network > Private) or phones won't connect." -ForegroundColor Yellow }
  else { Write-Host "  OK Network '$($p.Name)' is $($p.NetworkCategory)." -ForegroundColor Green }
}
