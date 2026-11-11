# Changelog

Each release's notes on GitHub come from its section here (`## x.y.z`, newest first).

## 1.1.5

- **The update notice lists everything you'd get:** if you're several versions behind, it shows the notes of every release since yours (newest first), not just the latest — one update still installs them all.

## 1.1.4

- **The session score explains itself:** click it (diary, day pages, calendars) to see how it's worked out and your session's breakdown — base 33, win-rate points, profit-factor points and the +12 for a green day — plus where the remaining points are.

## 1.1.3

- **Every stat explains itself:** click a stat's name (dotted underline) on the dashboard, reviews, diary or strategies for what it means, how it's worked out, the usual benchmarks, and what *your* number says — e.g. your win rate compared with the win rate you need to break even at your average win and loss. Small samples are flagged.
- **Week tiles open that week's review** in a pop-up from every calendar (dashboard, journal, diary, monthly / quarterly reviews), with ‹ › to step through weeks.
- **2m and 3m** timeframes on the execution chart.

## 1.1.2

- **Timeframes on the execution chart:** click the timeframe (1m) for 1m, 5m, 10m, 15m, 30m, 1h, 4h or 1d. Bigger candles are built from your 1-minute data and count from the 6 PM ET futures session open, like TradingView; 1h, 4h and 1d also load the days before so there's enough history. Your choice is remembered. Timeframes finer than your price source provides are greyed out.
- **P&L by trade** in the review charts: a third option next to the equity curve and P&L by day, with one bar per trade in the order you took them.

## 1.1.1

- **New: Macro section** in the sidebar.
  - **Economic Calendar** — every release in your time zone as a list (today / this week / next week), a week or a month. Impact and currency filters, search, a live countdown to the next release and to the next high-impact event, actuals coloured better / worse than expected, and earlier releases of each event. Uses ForexFactory's public weekly feed (this week and next, kept as it arrives so history builds up). Actual figures, and the weeks ForexFactory hasn't published yet, come from TradingView's public calendar feed (can be switched off at the bottom of the page); official Fed and BLS dates are the fallback.
  - **COT Report** — the CFTC's weekly Commitments of Traders for about 30 futures markets (indices, rates, FX, metals, energy, crypto, grains): large speculators' net position and weekly change, % long, a COT index over 6 months / 1 year / 3 years with crowded long / short flags, commercials and open interest. Click a market for a 3-year chart and recent weeks, or add any other market in the report.
  - Both are fetched by RoninFlow's server (and by the home-server copy while your PC is off) and saved in `data/macro/`.
- **Market & bank holidays** in the calendar, months ahead: US (NYSE / CME closures, early closes, bond-market and bank holidays), UK, eurozone & Germany, Japan, Canada, Australia, New Zealand and Switzerland, with each country's weekend-substitute rules. Each says what it means for trading — markets closed, early close or banks only. Shown by default (Holiday filter).
- **Today's market events in the top bar:** a small note at the top right shows the next high-impact release today with a countdown (it turns red 15 minutes before), or a market holiday. Click it for today's list; hide it until tomorrow from there, or switch it off at the bottom of the Economic Calendar. It follows the calendar's currency filter.
- **ATAS add-on installer finds ATAS X in more places:** any drive, renamed or versioned folders, per-user installs, the Apps list, Start-menu shortcuts or a running ATAS. If it still can't, it asks you to paste the folder (with directions to find it) instead of stopping with a command meant for source-code installs.
- Add-on installers point to GitHub issues for build errors.
- A page opened from the sidebar now starts at the top instead of at the depth the previous page was scrolled to.

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
