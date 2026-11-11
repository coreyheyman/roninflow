# Sets up (or updates) the always-on standby copy of RoninFlow on your home server.
#   npm run server:deploy                                  (uses the server saved in scripts\home-server.json)
#   npm run server:deploy -- -Target you@your-server       (first time, or to change it)
# Your PC stays the home of the journal. The server forwards to it while it's on, keeps a copy,
# and takes over (saving your edits) while the PC is off - they sync back when the PC returns.
param([string]$Target)
$ErrorActionPreference = "Continue"  # native tools (ssh, tar) write to stderr; we check $LASTEXITCODE instead
$root = Split-Path -Parent $PSScriptRoot
$cfgFile = Join-Path $PSScriptRoot "home-server.json"
function Fail($m) { Write-Host ""; Write-Host "  X  $m" -ForegroundColor Red; Write-Host ""; exit 1 }
function Ok($m) { Write-Host "  OK $m" -ForegroundColor Green }
function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }

# ---------- which server ----------
$saved = if (Test-Path $cfgFile) { Get-Content $cfgFile -Raw | ConvertFrom-Json } else { $null }
if (-not $Target) { $Target = $saved.target }
if (-not $Target) { Fail "Tell it which server to use the first time: npm run server:deploy -- -Target you@your-server (SSH user @ address)." }
@{ target = $Target } | ConvertTo-Json | Set-Content -Encoding UTF8 $cfgFile
$sshOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=8")

foreach ($c in "ssh", "scp", "tar") { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Fail "'$c' isn't available. Turn on 'OpenSSH Client' in Windows Settings > System > Optional features." } }

# ---------- passwordless SSH (asks for the Linux password once) ----------
Step "Connecting to $Target"
$keyFile = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
if (-not (Test-Path $keyFile)) {
  New-Item -ItemType Directory -Force (Split-Path $keyFile) | Out-Null
  & ssh-keygen -t ed25519 -N '""' -f $keyFile -q | Out-Null
  if (-not (Test-Path $keyFile)) { & ssh-keygen -t ed25519 -N "" -f $keyFile -q | Out-Null }
}
& ssh @sshOpts -n -o BatchMode=yes -o LogLevel=QUIET $Target "true"
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Enter your Linux password for $Target (only needed this once):" -ForegroundColor Yellow
  Get-Content "$keyFile.pub" | & ssh @sshOpts $Target "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  if ($LASTEXITCODE -ne 0) {
    Fail "Couldn't sign in to $Target. On the server run:  sudo systemctl enable --now sshd   and check the username (whoami)."
  }
  & ssh @sshOpts -n -o BatchMode=yes -o LogLevel=QUIET $Target "true"
  if ($LASTEXITCODE -ne 0) { Fail "Password worked but key sign-in didn't. Check ~/.ssh permissions on the server." }
}
Ok "Signed in to the server"

# ---------- make sure the PC journal runs the latest code ----------
Step "Restarting the journal on this PC"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "restart-journal.ps1")
if ($LASTEXITCODE -ne 0) { Fail "The journal on this PC isn't running. Run 'npm run autostart:install' first." }
$key = (Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5173/api/replica/key" -TimeoutSec 5).key
if (-not $key) { Fail "Couldn't get the sync key from the journal on this PC." }

# ---------- how the server reaches this PC (over Tailscale) ----------
$upstreams = @()
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts -and (Test-Path "$env:ProgramFiles\Tailscale\tailscale.exe")) { $ts = "$env:ProgramFiles\Tailscale\tailscale.exe" }
if (-not $ts) { Fail "Tailscale isn't installed on this PC." }
$st = & $ts status --json 2>$null | ConvertFrom-Json
if (-not $st -or $st.BackendState -ne "Running") { Fail "Tailscale isn't connected on this PC." }
$dns = ($st.Self.DNSName).TrimEnd(".")
$ip = @($st.Self.TailscaleIPs | Where-Object { $_ -match '^\d+\.' })[0]
$serving = (& $ts serve status 2>&1 | Out-String) -match "5173"
if (-not $serving) {
  Write-Host "  .. Turning on this PC's secure Tailscale address (the server uses it to reach the journal)" -ForegroundColor Cyan
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "phone-https.ps1") | Out-Null
  $serving = (& $ts serve status 2>&1 | Out-String) -match "5173"
}
if ($serving -and $dns) { $upstreams += "https://$dns" }
if ($ip) { $upstreams += "http://${ip}:5173" }
Ok ("Server will reach this PC at " + ($upstreams -join " or "))
if (-not $serving) { Write-Host "  !  Without the secure address the server needs 'Allow devices on my home network' on (Phone & network access) and port 5173 open (npm run phone:firewall)." -ForegroundColor Yellow }

# ---------- package and copy ----------
Step "Copying the journal app to the server"
$tmp = Join-Path $env:TEMP "tj-replica"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
@{ upstreams = $upstreams; key = $key; port = 5173 } | ConvertTo-Json | Set-Content -Encoding ASCII (Join-Path $tmp "replica.json")
$pkg = Join-Path $tmp "tj-replica.tgz"
& tar -czf $pkg -C $root replica.js local-api.js ai-proxy.js candles.js connect.js connect-apis.js connect-markets.js secrets.js system.js updater.js src/lib/pairing.js package.json dist scripts/server-setup.sh -C $tmp replica.json
if ($LASTEXITCODE -ne 0) { Fail "Packaging failed." }
& scp @sshOpts -q $pkg "${Target}:tj-replica.tgz"
if ($LASTEXITCODE -ne 0) { Fail "Copying to the server failed." }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

# ---------- install on the server ----------
Step "Installing on the server"
& ssh @sshOpts -t $Target "mkdir -p ~/trade-journal && tar -xzf ~/tj-replica.tgz -C ~/trade-journal --overwrite && rm -f ~/tj-replica.tgz && sed -i 's/\r$//' ~/trade-journal/scripts/server-setup.sh && bash ~/trade-journal/scripts/server-setup.sh"
if ($LASTEXITCODE -ne 0) { Fail "Setup on the server didn't finish - see the messages above." }

Write-Host ""
Ok "Done. Use the server's address (above) on your phone and other devices from now on - it works whether this PC is on or off."
Write-Host "   App updates made on this PC reach the server by themselves within a minute while both are on." -ForegroundColor DarkGray
