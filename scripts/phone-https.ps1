# Gives RoninFlow a secure https://<your-pc>.<tailnet>.ts.net address through Tailscale Serve,
# so phones can install it as an app. Run once:  npm run phone:https
# The setting is remembered by Tailscale (survives restarts). Undo with:  npm run phone:https -- -Off
param([switch]$Off)
$ErrorActionPreference = "Continue"
function Fail($m) { Write-Host ""; Write-Host "  X  $m" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }

$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { foreach ($p in "$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe") { if (Test-Path $p) { $ts = $p; break } } }
if (-not $ts) { Fail "Tailscale isn't installed on this PC. Install it from https://tailscale.com/download and sign in." }

$st = & $ts status --json 2>$null | ConvertFrom-Json
if (-not $st -or $st.BackendState -ne "Running") { Fail "Tailscale isn't connected. Open Tailscale from the system tray and sign in, then run this again." }
$dns = ($st.Self.DNSName).TrimEnd(".")
if (-not $dns) { Fail "Tailscale has no name for this PC. Turn on MagicDNS: https://login.tailscale.com/admin/dns" }

if ($Off) {
  & $ts serve --https=443 off 2>&1 | Out-Host
  Ok "Secure address turned off."
  exit 0
}

try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:5173/healthz" -TimeoutSec 3 } catch { $h = $null }
if (-not $h) { Write-Host "  !  The journal isn't running right now - that's fine, the address will work once it is (npm run autostart:restart)." -ForegroundColor Yellow }

Write-Host ""
Write-Host "Setting up https://$dns ..." -ForegroundColor Cyan
Write-Host "  (If Tailscale prints a link saying HTTPS or Serve isn't enabled, open it, click Enable, and this will continue.)" -ForegroundColor DarkGray
$out = & $ts serve --bg 5173 2>&1
$out | Out-Host
if ($LASTEXITCODE -ne 0) {
  if (($out | Out-String) -match "(?i)access|denied|permission|operator") {
    Write-Host "  .. Tailscale needs administrator permission - asking now." -ForegroundColor Cyan
    Start-Process -FilePath $ts -ArgumentList "serve --bg 5173" -Verb RunAs -Wait
  } else {
    Fail "Tailscale couldn't turn on the secure address. In the Tailscale admin page (https://login.tailscale.com/admin/dns) turn on MagicDNS and HTTPS Certificates, then run this again."
  }
}
Start-Sleep -Seconds 1
$sv = (& $ts serve status 2>&1 | Out-String)
if ($sv -notmatch "5173") { Fail "The secure address doesn't seem to be active. Run 'tailscale serve status' to see why." }

Write-Host ""
Ok "Secure address is on: https://$dns"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. In the journal on this PC: user menu > Phone & network access > set a PIN and turn on 'Allow devices on my home network'."
Write-Host "  2. On your phone: turn Tailscale on, open  https://$dns  and sign in with your PIN."
Write-Host "  3. Android Chrome: menu > Install app.   iPhone Safari: Share > Add to Home Screen."
Write-Host ""
Write-Host "Tailscale remembers this setting, so it keeps working after restarts."
