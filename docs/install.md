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
- Update: download and run the new installer. Settings → Backups & updates tells you when one is out.

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
