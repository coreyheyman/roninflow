#!/usr/bin/env bash
# Trade Journal — home-server standby copy: install / update (EndeavourOS / Arch; works on most systemd distros).
# You don't run this yourself: "npm run server:deploy" on the PC copies the files here and runs it.
#   - installs Node.js if needed
#   - runs replica.js as a systemd user service that starts at boot (even before you log in)
#   - opens port 5173 in firewalld / ufw if one is active
#   - gives the server a secure https://<server>.<tailnet>.ts.net address (Tailscale Serve) for the phone app
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
PORT="${PORT:-5173}"
SERVICE=trade-journal
say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }

say "Your Linux password may be asked once (for installing Node.js and starting at boot)"
sudo -v

# ---------- Node.js ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 18 ] && need_node=0 || warn "Node $(node -v) is too old (need 18+)."
fi
if [ "$need_node" = 1 ]; then
  say "Installing Node.js"
  if command -v pacman >/dev/null 2>&1; then sudo pacman -S --needed --noconfirm nodejs
  elif command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs
  else echo "Please install Node.js 18+ and run this again."; exit 1; fi
fi
NODE="$(command -v node)"
say "Node $(node -v)"
mkdir -p data logs dist

# ---------- systemd user service ----------
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$SERVICE.service" <<UNIT
[Unit]
Description=Trade Journal (standby copy of the PC journal)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/replica.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
Restart=always
RestartSec=3
StandardOutput=append:$DIR/logs/journal.log
StandardError=append:$DIR/logs/journal.log

[Install]
WantedBy=default.target
UNIT

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  say "Letting the journal start at boot without logging in"
  sudo loginctl enable-linger "$USER"
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null 2>&1
systemctl --user restart "$SERVICE"

# ---------- firewall ----------
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  if ! sudo firewall-cmd --list-ports | grep -qw "$PORT/tcp"; then
    say "Opening port $PORT in firewalld"
    sudo firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null && sudo firewall-cmd --reload >/dev/null
  fi
elif command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  say "Opening port $PORT in ufw"
  sudo ufw allow "$PORT/tcp" >/dev/null
fi

# ---------- check it's up ----------
ok=0
for _ in $(seq 1 20); do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
done
if [ "$ok" != 1 ]; then
  warn "The journal didn't start. Last log lines:"
  tail -n 20 "$DIR/logs/journal.log" || true
  exit 1
fi
pc=$(curl -fsS "http://127.0.0.1:$PORT/healthz" | grep -o '"pcOnline":[a-z]*' | cut -d: -f2)

# ---------- secure address for the phone app ----------
HTTPS_URL=""
if command -v tailscale >/dev/null 2>&1; then
  DNS=$(tailscale status --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')
  current=$(sudo tailscale serve status 2>&1 || true)
  if echo "$current" | grep -q "127.0.0.1:$PORT"; then
    HTTPS_URL="https://$DNS"
  elif echo "$current" | grep -qi "no serve config"; then
    say "Setting up https://$DNS (Tailscale Serve)"
    if sudo tailscale serve --bg "$PORT" >/dev/null 2>&1; then HTTPS_URL="https://$DNS"
    else warn "Tailscale couldn't turn on HTTPS for this server - the http address below still works."; fi
  else
    warn "Tailscale Serve is already used for something else on this server, so I left it alone."
  fi
fi
IP=$(tailscale ip -4 2>/dev/null | head -n1 || true)

say "Trade Journal standby copy is running"
[ -n "$HTTPS_URL" ] && echo "   Phone app / browser:  $HTTPS_URL"
[ -n "$IP" ] && echo "   Also:                 http://$IP:$PORT"
if [ "$pc" = "true" ]; then echo "   Your PC is online - the server forwards to it and keeps a copy for when it's off."
else warn "The server can't reach your PC yet. Check that the journal is running on the PC and Tailscale is on."; fi
echo "   Logs: $DIR/logs/journal.log"
