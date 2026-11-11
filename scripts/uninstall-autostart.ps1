# Stops the background RoninFlow and removes it from log-in startup. Your journal data is not touched.
$TaskName = "Trade Journal"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Trade Journal.url"
if (Test-Path $lnk) { Remove-Item $lnk -Force -ErrorAction SilentlyContinue }
Write-Host "  OK RoninFlow autostart removed. Use 'npm run dev' or 'npm run start' to run it manually." -ForegroundColor Green
