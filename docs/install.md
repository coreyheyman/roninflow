# Installing RoninFlow

RoninFlow is a web app that runs on your own machine. Pick one way to run it.

## Windows (one-click installer)

1. Download `RoninFlow-Setup-<version>.exe` from the project's **Releases** page and run it.
   No administrator rights are needed; Node.js is included.
2. Leave **Start RoninFlow in the background when I sign in** ticked — live sync from your platform only
   works while the journal is running.
3. The journal opens in your browser at **http://localhost:5173** and walks you through setup.

- Your data: `%LOCALAPPDATA%\TradeJournal\data` (Start menu → RoninFlow → *Open data folder*). Updating or
  uninstalling never deletes it.
- Platform add-ons: Start menu → RoninFlow → *Install platform add-ons*.
- Update: click **Update now** when RoninFlow tells you a new version is out (or download and run the new installer).

## macOS and Linux

Paste this into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/coreyheyman/roninflow/main/install.sh | bash
```

No administrator rights are needed and Node.js is included. RoninFlow starts in the background whenever you log in
(launchd on macOS, a systemd user service on Linux) and opens in your browser at **http://localhost:5173**.

- Apple Silicon and Intel Macs; Linux on x64 and arm64 (Raspberry Pi 4/5 with a 64-bit OS, ARM servers).
- Your data: `~/Library/Application Support/RoninFlow/data` (macOS) or `~/.local/share/roninflow/data` (Linux).
  Updating or uninstalling never deletes it.
- The `roninflow` command: `roninflow open` · `status` · `logs` · `restart` · `update` · `uninstall` (add `--purge`
  to delete your data too).
- Update: click **Update now** in the app, or run `roninflow update`.
- **Headless Linux server** (e.g. a mini PC in a cupboard): install with `| bash -s -- --lan` so other devices can
  reach it, then open `http://<server>:5173` from another device and enter the setup code shown by `roninflow logs`.
  To keep it running when you're logged out, run `sudo loginctl enable-linger $USER` once (the installer tries this).
- Other options: `--port 8080`, `--no-service` (don't start at login).
- The platform add-ons (ATAS, NinjaTrader, Sierra Chart…) are Windows programs. On a Mac, use broker connections,
  file import, or run the platform in a Windows VM and point its add-on at this Mac's address.
- Every download is checked against the release's `SHA256SUMS.txt`. To read the script before running it, download
  [install.sh](../install.sh) first.


## Docker (home server, NAS, Raspberry Pi 4/5)

```bash
curl -O https://raw.githubusercontent.com/coreyheyman/roninflow/main/docker-compose.yml   # or copy it from the repo
docker compose up -d
docker compose logs roninflow     # shows the one-time setup code
```

Open `http://<server-ip>:5173`, enter the setup code, choose your password, and follow the setup.

- Data lives in the `tj-data` volume (`/data` in the container). Back it up like any volume; daily backups are
  also kept inside it under `backups/`.
- Set `TZ` in `docker-compose.yml` to your time zone.
- Update: `docker compose pull && docker compose up -d`.
- Platform add-ons run on your trading PC. Point them at `http://<server-ip>:5173` and paste the token from
  **Connections → Webhook / API** (ATAS and MetaTrader need the journal on the same PC — see Connections).

## From source (any OS)

Needs Node.js 20 or newer.

```bash
git clone https://github.com/coreyheyman/roninflow.git
cd roninflow
npm install
npm run build
npm start                    # http://localhost:5173
```

Windows: `npm run autostart:install` runs it hidden at every sign-in (`npm run autostart:remove` undoes it).
Environment variables: `PORT` (default 5173), `DATA_DIR` (default `./data`), `TJ_LAN=1` (allow other devices from
the first start), `TJ_SECRET_KEY` (encryption key for saved API keys instead of `data/secret.key`),
`TJ_UPDATE_REPO=owner/repo` (where to look for updates).

## First-run setup

1. **Welcome** — your name and language (English, Español, Português, Deutsch, Français, 中文, 日本語).
2. **Password** — required for other devices; optional on the computer running the journal (you can require it
   there too in Settings → Security & privacy).
3. **Platforms** — pick what you trade on; afterwards the Connections page shows how to connect each.
4. **Accounts** — add accounts with their prop-firm rules (profit target, max drawdown and its type, daily loss limit).
5. **Risk tiers** — keep, edit or turn off the risk tiers.
6. **AI coach** — built-in analytics (offline), Ollama on your own computer (free), or your OpenAI / Anthropic /
   Gemini / Ollama Cloud key (stored encrypted on the server). Optionally add demo trades to look around.

## Price data for the charts

Settings → Price data. In order of preference: bars sent by your platform add-on (ATAS), your own Databento key
(CME futures), your own Polygon key (stocks, crypto, forex), or — only if you turn it on — Yahoo Finance's unofficial
feed. Without any of these the diary still works; only the execution charts stay empty.

## Backups

A backup of the journal and your connections is made every day into `data/backups` (the last 30 days are kept —
change it in Settings → Backups & updates). Download any of them there, and restore with user menu → Restore backup.
Copy the data folder to another drive now and then.
