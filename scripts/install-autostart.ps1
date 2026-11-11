# RoninFlow - run in the background at every Windows log-in (no terminal window).
# Usage (from the RoninFlow folder):  npm run autostart:install
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Host ""; Write-Host "  X  $m" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }

$TaskName = "Trade Journal"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Url = "http://localhost:5173"
Write-Host ""
Write-Host "RoninFlow - background autostart setup" -ForegroundColor Cyan
Write-Host ""

# 1. Node
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail "Node.js not found. Install it from https://nodejs.org and run this again." }
Ok "Node found at $node"
if (-not (Test-Path (Join-Path $Root "node_modules\vite"))) { Fail "Dependencies missing. Run 'npm install' in $Root first." }

# 2. Port must be free (stop 'npm run dev' first) unless it's our own background server
$listening = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  $procIds = $listening | Select-Object -ExpandProperty OwningProcess -Unique
  $ours = $procIds | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$_" } | Where-Object { $_.CommandLine -like "*server.js*" }
  if ($ours) {
    Write-Host "  .. stopping the running background copy to update it"
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $ours | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
  } else {
    Fail "Port 5173 is in use - stop 'npm run dev' (press Ctrl+C in its terminal) and run this again."
  }
}

# 3. Build the app
Write-Host "  .. building the app (this takes a few seconds)"
Push-Location $Root
& $node (Join-Path $Root "node_modules\vite\bin\vite.js") build --logLevel warn
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "Build failed - copy the messages above and send them to Claude." }
Ok "App built to $Root\dist"

# 4. Hidden launcher (wscript keeps running while the server runs, so Windows can restart it if it crashes)
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
$vbs = Join-Path $Root "scripts\start-hidden.vbs"
$q = '""'
$cmd = "cmd /c cd /d $q$Root$q && $q$node$q server.js >> $q$Root\logs\server.log$q 2>&1"
$vbsBody = @"
' Starts the RoninFlow server with no window. Created by install-autostart.ps1
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("$cmd", 0, True)
WScript.Quit rc
"@
Set-Content -Path $vbs -Value $vbsBody -Encoding ASCII
Ok "Launcher written to $vbs"

# 5. Scheduled task: at log-on of this user, restart on failure, no time limit
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Runs the RoninFlow at http://localhost:5173 in the background." -Force | Out-Null
Ok "Scheduled task '$TaskName' registered (runs at every log-in)"

# 6. Start it now and check it answers
Start-ScheduledTask -TaskName $TaskName
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try { $r = Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if (-not $ok) { Fail "The server didn't start. See $Root\logs\server.log and send the last lines to Claude." }
Ok "RoninFlow is running at $Url"

# 7. Optional: allow phones on the home network through Windows Firewall
$ans = Read-Host "  ?  Use the journal on your phone over Wi-Fi? Adds a firewall rule (admin prompt) [y/N]"
if ($ans -match '^(y|yes)$') { & (Join-Path $Root "scripts\phone-firewall.ps1") } else { Write-Host "     Skipped - run 'npm run phone:firewall' any time later." }

# 8. Desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
Set-Content -Path (Join-Path $desktop "Trade Journal.url") -Value "[InternetShortcut]`r`nURL=$Url/`r`nIconIndex=0" -Encoding ASCII
Ok "Desktop shortcut 'RoninFlow' created"

Write-Host ""
Write-Host "Done. You can close this terminal - the journal keeps running and starts again every time you log in." -ForegroundColor Cyan
Write-Host "Open it with the desktop shortcut or $Url. Data: $Root\data  Logs: $Root\logs\server.log" -ForegroundColor Cyan
Write-Host "Phone access: in the journal open the user menu (bottom-left) > Phone & network access." -ForegroundColor Cyan
Write-Host "After code updates run 'npm run autostart:restart'. To remove: 'npm run autostart:remove'." -ForegroundColor Cyan
Write-Host ""
Start-Process $Url
