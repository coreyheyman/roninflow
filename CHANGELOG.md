# Changelog

Each release's notes on GitHub come from its section here (`## x.y.z`, newest first).

## 1.0.9

- **Mac and Linux setup steps for every platform add-on.** NinjaTrader, Quantower, Sierra Chart, MetaTrader, cTrader and ATAS now show the right steps for the computer RoninFlow runs on, with a Windows / Mac-Linux switch.
- **ATAS can send to a journal on another computer.** Journal Sync 1.3 has a Token setting, so ATAS on a Windows PC can send to RoninFlow on a Mac, Linux box or home server.
- **MetaTrader and Sierra Chart under Wine / CrossOver are found automatically**, including MetaQuotes' MT5 app for Mac.
- Windows steps now point installer users to Start menu → RoninFlow → Install platform add-ons.

## 1.0.8

- **Weekly review:** today is marked with a small violet dot after the day name instead of the word "Today", which made the header wrap onto two lines. Day headers now always stay on one line.
- Reviews say "1 trade" instead of "1 trades".

## 1.0.7

- **macOS and Linux:** RoninFlow now installs natively with one command — `curl -fsSL https://raw.githubusercontent.com/coreyheyman/roninflow/main/install.sh | bash`. No admin rights, Node.js included, starts at login (launchd / systemd), and the `roninflow` command manages it (`open`, `status`, `logs`, `update`, `uninstall`). Apple Silicon and Intel Macs; Linux x64 and arm64.
- **Update now** works on macOS and Linux too.
- Headless Linux servers: install with `--lan` and finish setup from another device.

## 1.0.6

- **One-click updates (Windows installer):** the "new version" notification now has an **Update now** button, also in Settings → Backups & updates. RoninFlow downloads the new installer from GitHub, checks it against the release's published SHA-256 checksum, backs up your journal, installs it and restarts itself — the page reloads on the new version. Docker and source installs get a **How to update** button with the exact commands.
- **Fixed:** updating with the Windows installer while RoninFlow was running could fail with a "file in use" error, because the installer no longer recognised the running app after the rename. It now stops the running copy reliably.
- Releases now include `SHA256SUMS.txt`, so you can verify any download yourself.

## 1.0.5

- **Weekly review:** removed the gaps that appeared between the day tiles on wide screens.
- **Dashboard calendar:** the daily P&L is now the same size as on the journal calendar instead of a small fixed size.
- **Review calendar on small phones:** amounts switch to a short form (+$1.3k) so they fit, like the dashboard calendar.

## 1.0.4

- **Calendars:** today is now marked with a violet outline around its tile and a violet date, instead of a circle around the date. The circle took up so much room on a phone that it pushed the day's P&L out of the tile.
- **Calendars on small phones:** day tiles can grow slightly taller than square when they need to, and the amounts shrink to fit, so every day's P&L stays readable even on the smallest iPhones.

## 1.0.3

- **Weekly review:** the Mon–Fri tiles now have the same square-ish shape as the calendar day tiles instead of being wide and short, and the Week total lines up with them. Between roughly 760 and 1000px wide they lay out three across, and two across on a phone, so they never turn into narrow slivers.

## 1.0.2

- **Calendars:** day tiles are square-ish everywhere instead of short and wide — the dashboard calendar in particular is no longer squished. The tiles keep their shape as the window narrows, all the way down to a phone, and stop growing past 200px tall on very wide monitors.

## 1.0.1

- **Charts:** turning Yahoo off in Settings → Price data now really stops Yahoo charts — days already saved from Yahoo are no longer shown.
- **Charts:** micro contracts (MES, MNQ, MCL…) now use the price bars your platform add-on sends for the full-size contract (ES, NQ, CL…), and the other way round.
- **Updates:** when a new version is out you now get a notification in the app (bell icon), with a link to download it.
- **Live demo:** try RoninFlow in your browser with made-up data — https://coreyheyman.github.io/roninflow/

## 1.0.0

First public release.
