# Restarts the background RoninFlow (rebuilds automatically if the code changed).
$TaskName = "Trade Journal"
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { Write-Host "Autostart isn't installed. Run 'npm run autostart:install' first." -ForegroundColor Yellow; exit 1 }
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $TaskName
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try { if ((Invoke-WebRequest -Uri "http://localhost:5173/healthz" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Write-Host "  OK RoninFlow restarted at http://localhost:5173" -ForegroundColor Green; exit 0 } } catch {}
}
Write-Host "  X  It didn't come back up - check logs\server.log" -ForegroundColor Red
exit 1
