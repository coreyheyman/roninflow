#!/usr/bin/env bash
# Install or update RoninFlow on macOS or Linux — no admin rights needed.
#
#   curl -fsSL https://raw.githubusercontent.com/coreyheyman/roninflow/main/install.sh | bash
#
# Options (after `bash -s --`):  --lan        allow other devices on your network (headless home servers)
#                                --port N     use another port (default 5173)
#                                --no-service don't start RoninFlow at login
#                                --update     (used by `roninflow update`)
# Installs to ~/.local/share/roninflow (Linux) or ~/Library/Application Support/RoninFlow (macOS):
#   app/ (RoninFlow with its own Node.js)  data/ (your journal — never touched by updates)
# and adds the `roninflow` command to ~/.local/bin. Every download is checked against the release's SHA256SUMS.txt.
set -euo pipefail

REPO="${RONINFLOW_REPO:-coreyheyman/roninflow}"
API="${RONINFLOW_API:-https://api.github.com}"
DL="${RONINFLOW_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}"
VERSION="${RONINFLOW_VERSION:-}"
PORT=""; LAN=""; SERVICE=1; UPDATE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --lan) LAN=1 ;;
    --port) PORT="$2"; shift ;;
    --no-service) SERVICE=0 ;;
    --update) UPDATE=1 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

c_ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
step() { printf '\033[35m›\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- platform
case "$(uname -s)" in
  Linux) OS=linux; HOME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/roninflow" ;;
  Darwin) OS=macos; HOME_DIR="$HOME/Library/Application Support/RoninFlow" ;;
  *) die "This installer is for macOS and Linux. On Windows use the installer from https://github.com/$REPO/releases/latest" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) die "No RoninFlow build for $(uname -m) yet — use Docker instead: https://github.com/$REPO/blob/main/docs/install.md" ;;
esac
# Apple Silicon running this shell under Rosetta still gets the native build
[ "$OS" = macos ] && [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ] && ARCH=arm64
has curl || die "curl is needed."
has tar || die "tar is needed."
if has sha256sum; then SHA() { sha256sum "$1" | cut -d' ' -f1; }; elif has shasum; then SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }; else die "sha256sum or shasum is needed."; fi

# settings from an earlier install are kept unless you pass new ones
OLD_PORT=5173; OLD_LAN=0
if [ -f "$HOME_DIR/install.env" ]; then
  OLD_PORT="$(sed -n 's/^PORT=//p' "$HOME_DIR/install.env")"; OLD_LAN="$(sed -n 's/^LAN=//p' "$HOME_DIR/install.env")"
fi
PORT="${PORT:-${OLD_PORT:-5173}}"; LAN="${LAN:-${OLD_LAN:-0}}"

# ---------------------------------------------------------------- which version
if [ -z "$VERSION" ]; then
  step "Finding the latest RoninFlow…"
  VERSION="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$VERSION" ] || die "Couldn't reach GitHub to find the latest version."
fi
CURRENT=""
[ -f "$HOME_DIR/app/package.json" ] && CURRENT="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$HOME_DIR/app/package.json" | head -n1)"
if [ "$UPDATE" = 1 ] && [ "$CURRENT" = "$VERSION" ]; then c_ok "RoninFlow $VERSION is already the newest version."; exit 0; fi

# ---------------------------------------------------------------- download + verify
ASSET="RoninFlow-$VERSION-$OS-$ARCH.tar.gz"
mkdir -p "$HOME_DIR"
WORK="$(mktemp -d "$HOME_DIR/.install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
step "Downloading RoninFlow $VERSION for $OS ($ARCH)…"
curl -fSL --progress-bar -o "$WORK/$ASSET" "$DL/v$VERSION/$ASSET" || die "Download failed: $DL/v$VERSION/$ASSET"
curl -fsSL -o "$WORK/SHA256SUMS.txt" "$DL/v$VERSION/SHA256SUMS.txt" || die "Couldn't download SHA256SUMS.txt for $VERSION."
WANT="$(awk -v f="$ASSET" '{ n=$2; sub(/^\*/, "", n); if (n == f) print tolower($1) }' "$WORK/SHA256SUMS.txt")"
[ -n "$WANT" ] || die "SHA256SUMS.txt has no entry for $ASSET."
[ "$(SHA "$WORK/$ASSET")" = "$WANT" ] || die "The download doesn't match its checksum — nothing was installed."
c_ok "Download verified"
tar -xzf "$WORK/$ASSET" -C "$WORK"
[ -x "$WORK/roninflow/node/bin/node" ] && [ -f "$WORK/roninflow/server.js" ] || die "The download is missing files."

# ---------------------------------------------------------------- install
BIN="$WORK/roninflow/bin/roninflow"
if [ -d "$HOME_DIR/app" ]; then "$HOME_DIR/app/bin/roninflow" stop >/dev/null 2>&1 || true; fi
rm -rf "$HOME_DIR/app.old"
[ -d "$HOME_DIR/app" ] && mv "$HOME_DIR/app" "$HOME_DIR/app.old"
mv "$WORK/roninflow" "$HOME_DIR/app"
mkdir -p "$HOME_DIR/data" "$HOME_DIR/drop" "$HOME_DIR/logs" "$HOME/.local/bin"
printf 'PORT=%s\nLAN=%s\n' "$PORT" "$LAN" >"$HOME_DIR/install.env"
ln -sf "$HOME_DIR/app/bin/roninflow" "$HOME/.local/bin/roninflow"
c_ok "Installed RoninFlow $VERSION${CURRENT:+ (was $CURRENT)}"
RF="$HOME_DIR/app/bin/roninflow"

# ---------------------------------------------------------------- start at login
MANAGER=none
if [ "$SERVICE" = 1 ]; then
  if [ "$OS" = macos ]; then
    PLIST="$HOME/Library/LaunchAgents/com.roninflow.server.plist"
    mkdir -p "$(dirname "$PLIST")"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.roninflow.server</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$RF</string><string>run</string><string>--service</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/server.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/server.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/com.roninflow.server" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && MANAGER=launchd
  elif has systemctl && systemctl --user show-environment >/dev/null 2>&1; then
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR"
    cat >"$UNIT_DIR/roninflow.service" <<EOF
[Unit]
Description=RoninFlow trading journal
After=network-online.target

[Service]
ExecStart=/usr/bin/env bash "$RF" run --service
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable roninflow.service >/dev/null 2>&1 && systemctl --user restart roninflow.service && MANAGER=systemd
    # keep running after you log out (headless servers); may need your password on some systems
    if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo yes)" != yes ]; then
      loginctl enable-linger "$USER" >/dev/null 2>&1 || LINGER_HINT=1
    fi
  fi
fi
if [ "$MANAGER" = none ]; then "$RF" start >/dev/null 2>&1 || true; fi
for _ in $(seq 1 40); do curl -fsS -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.5; done

# ---------------------------------------------------------------- done
echo
if curl -fsS -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then c_ok "RoninFlow is running at http://localhost:$PORT"
else printf '\033[33m!\033[0m RoninFlow is installed but didn'\''t answer yet — check: roninflow logs\n'; fi
case "$MANAGER" in
  launchd) echo "  It starts by itself when you log in." ;;
  systemd) echo "  It starts by itself when you log in."; [ "${LINGER_HINT:-0}" = 1 ] && echo "  To keep it running after you log out (servers): sudo loginctl enable-linger $USER" ;;
  none) [ "$SERVICE" = 1 ] && echo "  Couldn't set it to start at login on this system — run 'roninflow start' after a reboot." ;;
esac
if [ "$LAN" = 1 ]; then echo "  Other devices on your network: open http://<this computer's address>:$PORT and use the setup code from 'roninflow logs'."; fi
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  Add ~/.local/bin to your PATH to use the 'roninflow' command (or run $HOME/.local/bin/roninflow)." ;; esac
echo "  Commands: roninflow open | status | logs | update | uninstall"
if [ "$UPDATE" = 0 ] && [ -z "$CURRENT" ]; then
  if [ "$OS" = macos ]; then open "http://localhost:$PORT" >/dev/null 2>&1 || true
  elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && has xdg-open; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true; fi
fi
