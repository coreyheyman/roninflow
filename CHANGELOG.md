# Changelog

Each release's notes on GitHub come from its section here (`## x.y.z`, newest first).

## Unreleased

- **GEX converts to futures prices around market holidays:** before the open on the day after a holiday (e.g. the Friday after Thanksgiving), the levels are matched to ES/NQ at the last real cash close instead of the holiday's, and the 1:00 PM early closes are known.
- **Reviews from the chart stick:** with several journal windows open (the chart's trade review, the journal over ATAS, a browser tab), a save another window beat to the server used to be dropped. Marking a trade reviewed from the chart often lost out to another window saving live account balances. Now your change is merged into the newer copy and saved again.
- **"Mark as reviewed" in the chart's trade review now saves before the window closes.** The journal waits 0.7 s after a change before saving, and closing the window cut that off. Closing with Esc or the window's X waits for the save the same way.
- **The chart's trade review opens the right trade when ATAS reuses a trade id:** it prefers the chart's account and the nearest time.
- **The chart's trade-review window no longer syncs ATAS itself, and no journal window syncs before your journal has loaded.** That's what produced a "2678 new trades synced" message.
- **GEX no longer goes blank just after the open:** for the first minutes after 9:30 ET, Cboe's delayed file lists the options without volatility or Greeks, which made every bar zero. RoninFlow now keeps the last complete numbers up, with a "Waiting for Cboe's opening Greeks" badge, until Cboe fills them in.
- **Your position and orders on the chart (ATAS Suite → Executions):**
  - Working orders are read against your open position. Orders on your side are scale-ins (`ADD 1 @ … · avg → …`, showing the new average if filled). Stops on the other side are the stop loss: `SL 3 @ … · −12.5 pts · −$750`, or `break-even` / `locked` once it's past your average. Limits beyond the average are targets, numbered from the nearest: `TP1 2 @ … · +25 pts · +$1,000 · RR 2.0`.
  - The position line shows the overall RR from your average price (`RR 3.5`), with targets weighted by size.
  - Separate colours for stop, target and scale-in lines. Dollars come from ATAS's tick value; switch R, dollars or the classification off in the settings.
  - The labels on these lines now sit on top of the line instead of across it.
  - **A scaled position shows one result:** its fills share a single P&L chip at the last exit, with the total. In points or ticks, that's the move from the average entry to the average exit. The connecting lines are coloured by the whole position's result.

## 2.2.3

- **Custom candles, rebuilt** (RoninFlow Suite for ATAS, Candles tab):
  - **24 templates**, each giving the whole look in one pick: Classic, Hollow up / filled down, Diagonal stripes, Shapes inside, Gradient body, Neon glow, Volume-weighted fill, Buy / sell split, Dot pattern, Rounded pills, Open / close ticks, Pattern highlights, Arrow bodies, Hex / gem, Corner brackets, Double border, Scanlines, Chevron fill, Capped wicks, Range ghost, Close-in-range fill, POC marker, Momentum heat and 3D extruded.
  - **Separate up and down candle styles and outlines.** Shape, wicks, markers and pattern highlights can each override the template too; "From template" keeps the template's choice.
  - **Colours:** body, border, wick and pattern colours for each side, plus doji, middle-close, inside-bar, engulfing-outline and POC-dot colours.
  - **Wicks never cross a body.**
  - **Backfill:** each native candle is painted over first, at ATAS's own position and full width plus an adjustable margin, so hollow bodies and non-square shapes never show it. Bodies and wicks have separate switches and colours; set them to your chart's background.
  - **Follows the zoom:** spacing, glow, depth and marker sizes scale with the candle. Detail steps down cleanly as candles shrink.
  - **Body fill behind the design:** each side can paint its body colour behind its stripes, dots, chevrons or hollow body, at any opacity, flat or fading from the close toward the open.
  - **Price scale tag:** the live price on the scale is painted in the candles' own colours (body, border or custom, with automatic black/white text), slightly taller than ATAS's native tag so it covers it.
  - **Real order flow:** the volume, buy / sell and POC styles use ATAS's volume, bid/ask and most-traded price for each bar.
- **News chips on the chart (ATAS Suite → News → Event markers):** a background colour for past-event chips as well as upcoming ones; raise the opacity for a solid chip. A new switch turns off the impact-colour tint, so the chip is exactly the colour you pick.

**Updating:** reinstall the ATAS add-on with ATAS closed (`npm run addon`). If you had the old "Hollow" body style, pick it again as a template or as an up/down style.

## 2.2.2

- **Contract Rolls (Macro → Tools):** for every market you trade (picked up from your journal; add others yourself), the contract to be in today, the next one, the roll date and the last trading / first notice day on a timeline, and the last session's volume of both contracts side by side. Covers stock indices and their micros, energy, metals, Treasuries, currencies, grains and CME crypto, with US exchange holidays.
- **Told when to switch, by where the volume is:** as soon as the next contract trades more than the current one (each session's volume per contract month, from Yahoo Finance), RoninFlow says switch — often a day or two before the calendar date for gold, crude or bonds. The exchange's roll date is the early warning (from 5 days out) and the backstop when volume data isn't available.
- **Roll reminder in the journal:** a one-line banner when a market you trade is about to roll, has just rolled, or your last trade was on the old contract. Dismiss it per roll, or turn it off on the Contract Rolls page.
- **Roll reminder on your chart (ATAS Suite → Account → Contract roll):** the account panel shows “Contract roll: switch to NQH7 in 3 days” and, once volume has moved, “Switch to NQH7 — it now trades more than NQZ6 (62% of volume)”, with a pop-up the morning it matters. Click it to open Contract Rolls.

**Updating:** restart RoninFlow; for the reminder on your chart, reinstall the ATAS add-on with ATAS closed (`npm run addon`).

## 2.2.1

- **Macro data no longer gives up when FRED says “slow down”:** a page that asks for many series at once (G10, International) pauses for a minute and carries on, instead of showing those series as failed for half an hour. The live demo's snapshot paces itself the same way, so its international and G10 data are real too.

## 2.2.0

- **Review trades from the chart (ATAS Suite → Executions):** click an execution marker and the trade's review from your journal opens in a window beside it — strategy, tags, edge blockers, rating, notes, screenshots, mark as reviewed. It's the journal itself (the ATAS trade is matched by its ATAS id, then by account, market and time), so whatever you change is saved to RoninFlow straight away and shows up in every open journal within a couple of seconds. Clicking another execution moves the same window to it; Esc closes it.
- **The whole journal over your chart (ATAS Suite → Account):** click “RoninFlow” at the top left of the account panel to open the full journal — side menu and all — in its own window over ATAS (it stays on top unless you switch that off, and remembers where you put it). Both windows have no Windows title bar: the journal's own top bar is where you drag them (double-click to maximise), with RoninFlow-styled buttons to keep them on top, minimise, maximise and close. Click back on your chart and they get out of the way (the journal minimises, a trade review hides); clicking “RoninFlow” brings the journal back on the page you left it on — even after restarting ATAS — and they keep native resizing, snapping, shadow and (Windows 11) rounded corners. They use the WebView2 browser that comes with ATAS X; you sign in once.
- Open journals now pick up changes made elsewhere every 1.5 seconds (was 4).
- **Macro, reorganised:** a bar of categories across the top of every Macro page — Daily Check, Calendar & News, Positioning, Liquidity, Credit & Risk, Economy and Tools. Click one for its pages; a category with a single page opens it straight away. Macro reopens on the last page you used.
- **Daily Check (new):** today’s macro regime — Crisis, Stagflation, Tightening, Slowdown, Reflation, Goldilocks, Liquidity-driven or Mixed — read from five forces (growth, inflation, liquidity, policy, stress), with a radar of today against last week, how many forces line up, and a read for stocks, gold, the dollar or oil. Below it: the playbook (if / then / ends when), the five forces with their 1-year range, the regime week by week, seven confirmation markets (credit spreads, the VIX, the dollar, the curve, copper, stocks, the 10-year) and whether they agree, and this week’s releases with what a hotter or cooler print would mean and a countdown to the next one. The regime also shows as a pill in the category bar.
- **Read the Daily Check for one market:** pick Stocks, Gold, Dollar or Oil and the whole page re-reads for it — a bullish / bearish / neutral read from how each force pushes that market (helps, hurts, steady), the radar redrawn as how hard each force is pushing it (the dotted middle ring = no effect), a playbook for that market (what's driving it, what to do, what would change it), its own seven confirmation markets (e.g. real yields, the dollar and breakevens for gold), and which way a hotter print of each release this week usually moves it. The choice is remembered.
- **The live demo stays current:** a returning visitor's made-up journal is moved up to today — rebuilt if they haven't changed it, or every date moved forward by whole weeks (their edits kept) if they have.
- **The live demo's Macro pages now show real data:** a snapshot of every FRED and New York Fed series, the economic calendar and the COT report, refreshed every 4 hours when the demo site rebuilds (sample data fills anything the snapshot couldn't get).
- **New data pages**, each with grouped cards (latest value, change, chart over 3M to MAX) and a full chart with the 1-year range on click: **Monetary Policy** (Fed balance sheet, net liquidity, reserves, reverse repo, the Treasury’s account, money supply, policy rates), **Primary Dealer Stats** (the New York Fed’s weekly dealer positions across Treasuries, TIPS, MBS and credit), **Credit & Markets** (spreads, stress and financial-conditions indexes, bank lending, delinquencies, markets), **Economy & Labor**, **Inflation** (CPI, PCE, PPI, sticky and shelter prices, expectations, with the 2% target marked), **Fixed Income & Rates** (with the Treasury yield curve against a month and a year ago) and **International** (foreign 10-year yields and the dollar against the majors).
- **Correlation Matrix (new):** rolling 30/60/180/252-day correlation of daily returns across the majors and US indices (add the dollar, the 10-year, the VIX, oil or the HY spread), the pairs moving most together and most opposite, and any pair’s rolling correlation over time.
- **G10 Indicators (new):** eight economies side by side — unemployment, inflation, policy rate, real policy rate and 10-year yield — coloured by whether conditions are easing, with each cell’s 5-year history and the latest prints.
- **Comparator (new):** overlay any series against any other — FRED data or CFTC net positioning — rebased to 100, as z-scores, min-max, or raw on two axes, with presets (10Y vs S&P 500, HY spread vs VIX, net liquidity vs S&P 500…) and each series’ change and correlation with the first.
- **Watch List (new):** pin any series with the ☆ on its card; several named lists, kept with your settings, with the latest value, the change on the week and a 60-observation sparkline.
- Data comes from FRED’s public downloads and the New York Fed’s API — no keys needed. RoninFlow caches each series and refreshes it in the background as often as it prints.

**Updating:** restart RoninFlow, then reinstall the ATAS add-on (Start menu → RoninFlow → Install platform add-ons → ATAS, or `npm run addon`) with ATAS closed, for the chart review and journal windows.

## 2.1.0

- **Risk enforcement in ATAS (Settings → Risk enforcement):** RoninFlow can now hold ATAS to your risk plan, account by account. Switch an account on and set its rules: the daily loss limit (follows its current risk tier unless you set your own), a trailing drawdown on the day's closed P&L (the same as the daily loss limit unless you change it), trading windows and days, trades per day, losing trades in a row, and contracts per position. The page shows the account's current tier and, live from ATAS, today's closed and open P&L, the day's high, where the trailing stop sits, trades taken and whether new orders are blocked.
- **How it's enforced:** the Journal Sync add-on joins ATAS's own pre-order check, so while a rule is broken that account is reduce-only — new positions are refused, closing still works. Hitting the loss limit or trailing drawdown also closes open positions; a window ending can too; positions over the contract limit are trimmed. It keeps each account's ATAS Risk Management in step (loss limit, max trades, losses in a row), lowering ATAS's loss limit as the trailing drawdown tightens. It works on every connected account, copy-trade followers included, whether or not a chart has them selected.
- **RoninFlow Suite for ATAS (new indicator, installed with Journal Sync):** one indicator with four parts, each switched on or off and placed anywhere (a corner or the middle, plus X and Y offsets) in its settings:
  - **Account panel** — the chart's account with chips for its RoninFlow risk tier and the gamma regime (positive · pinning, at the flip, negative · trending), today's open and closed P&L and trades, the buffer to the daily loss limit with the trailing stop and the day's high, trade stats, and the index's GEX and where the flip is. It shows when the account is blocked and why. Size it from 50% to 250% (fonts and spacing scale together); it narrows to fit small charts, moves its stats into two columns when narrow, and a click on the stats collapses them to one line.
  - **Open positions on every account** — a compact list under the account panel of each open position on any connected account (copy-trade followers included): masked account number, long or short, contracts, market and open P&L, with the total. The chart's account is highlighted; nothing shows when you're flat.
  - **Gamma levels** — call wall, put wall, zero gamma and the biggest other strikes in this market's futures prices, as lines or as zones of the width you choose, with your colours, optional regime shading above and below the flip, level names (left, middle or right) and price-axis tags.
  - **News feed** — today's events with countdowns and live headlines from News Flow, tagged with the markets they move; click its header to collapse it. Click a headline (or a news pop-up) for its own pop-up: the full headline, source and time, the story, the summary, actual / forecast / previous for releases, the markets it usually moves, and buttons to open the article or News Flow.
  - **News pop-ups** — new headlines, a warning a few minutes before events and releases with actual / forecast / previous, wherever you choose, with a preview switch that shows one in place while you set it up.
  - **Alerts** — a sound picked from ATAS's own sound list (with play buttons, your own sounds included) and a pop-up for trades entered, every fill (optional), winning and losing trades (optionally only above a size), hitting the daily loss limit (the tier's, or your own), a warning when a share of it is used, and hitting a daily profit target you set. Open P&L can count toward the limit and target.
  - Plus HIGH / MED / LOW markers for today's events on the time axis (hover for the numbers).
  - **Executions** — your trades on the chart: entry and exit markers (triangles, arrows or circles, any size, your buy and sell colours, with quantities), a line joining entry and exit in your win or loss colour (width and solid, dashed or dotted), the result at the exit in money, ticks or points, and the open position's average price. The chart's account only, or every account.
  - **DOM heatmap** — resting limit orders drawn like an order-book heatmap (palettes, log or linear scaling, contrast, glow, fade toward the live edge, size tags on the biggest levels), behind or over the candles, with an on/off button on the chart.
  - **Custom candles** — your own bull, bear and doji colours, hollow or filled bodies, borders and wick widths, drawn pixel-for-pixel over the native candles at every zoom, with the native body hidden underneath and an optional live price line.
  - **Settings in tabs** — General, Account, Executions, Gamma, News, Heatmap, Candles and Alerts, each with its own on/off switch and grouped sections.
  - **Faster alerts** — win, loss, daily loss limit and profit target alerts fire the moment ATAS closes the trade instead of waiting for the next refresh.
- **Flatten on the daily loss limit or profit target (Settings → Risk enforcement):** each account gets a daily profit target and two switches: flatten the account when its daily loss limit (or trailing drawdown) is hit — on by default; switched off, open positions are left to you and only new ones are blocked — and flatten it and stop for the day when its profit target is hit. Only that account is flattened. The target can count open P&L or closed P&L only.
- **Block trading for the day from the chart:** click the status marker at the top right of the RoninFlow Suite to block this account or every account until midnight, optionally closing open positions and cancelling orders at the same time. RoninFlow keeps the block through restarts, and Journal Sync's risk enforcement applies it (accounts RoninFlow doesn't otherwise enforce included).
- The Suite's "New orders blocked" banner is now sized to its text.
- **RoninFlow Suite on every platform:** the chart indicator (renamed from the HUD, since it's grown well past one) now also comes for NinjaTrader 8, Quantower (beta), cTrader, MetaTrader 5 / 4 and Sierra Chart, installed with each platform's add-on: the account panel with your risk tier and buffer to the profit target, your executions, gamma levels, news with pop-ups and today's events, alerts, and where the platform allows it a DOM heatmap and candle colours. Index CFDs (US500, NAS100, US2000…) get gamma levels in index prices. MetaTrader and Sierra Chart talk to RoninFlow through files, the rest over `/api/suite`. Written from each platform's documentation — the first real compile on each is still to come.
- **Webull connection (beta):** Connections → Webull. Enter the App Key and Secret from Webull's developer portal, press Connect and approve the request in the Webull app; filled stock, option and futures orders from every account then sync every 2 minutes (last 60 days first). Built from Webull's documentation and not yet tried on a real account.
- **Emergency unblock (Settings → Risk enforcement):** for a block caused by a glitch. Pick a blocked account (or all of them), type UNBLOCK and wait 10 seconds, and today's block is lifted — whether a rule or the Suite set it — optionally pausing that account's rules until midnight (with a button to turn them back on). Every unblock is logged; the Suite shows "rules paused" while they're off.
- **The Suite's buffer bar runs from your stop to the account's profit target**, with a marker for each (⏻ when hitting it flattens the account), and can move with closed + open P&L or closed P&L only (Account tab → Buffer bar moves with). The profit-target alert uses the account's target unless you set one in the Suite.
- **Scale-in and scale-out alerts (Suite, every platform):** the "added to a trade" alert now fires only when you add to an open position (a scale-in), never when a fill closes or flattens it. Scaling out plays the win or loss alert for the part you closed.
- **Order lines (ATAS Suite → Executions):** your working limit and stop orders on this market are drawn as lines with a label (BUY LMT 1 @ …), in buy and sell colours you choose, next to the average-price line.
- **Long and short colours for the average-price line**, now labelled with the side and size (LONG 2 avg …).
- **Start the heatmap off (ATAS Suite → Heatmap):** the DOM heatmap starts hidden on a new chart; the button on the chart turns it on.
- **Hide the distance to the flip (ATAS Suite → Account):** the live "x points from flip" under the gamma line is now off by default; switch it back on in the settings.
- **Background fill for upcoming event chips (ATAS Suite → News)**, so they stay readable over busy candles.
- **Default alert sounds:** each Suite alert now has its own default sound (order filled, added to a trade, win, loss, profit target, daily loss limit and its warning). Drop your own `.wav` files into the `sounds` folder before installing the ATAS add-on and they're copied into ATAS's sound list; any that are missing fall back to ATAS's built-in alerts. The defaults apply to newly added Suite indicators — an existing chart keeps the sounds you picked.
- **Daily diary on phones:** the day header, the Previous / Next buttons and the screenshot list wrap to fit, and the full-screen screenshot viewer keeps its close button, counter and tools on screen.
- **Journal Sync 1.6.0:** a new **Enforce RoninFlow risk rules** switch in the indicator's settings (off until you turn it on), and **Also keep ATAS Risk Management in step**.

**Updating:** restart RoninFlow, then reinstall the ATAS add-on (Start menu → RoninFlow → Install platform add-ons → ATAS) with ATAS closed. In ATAS, open Journal Sync's settings and switch on Enforce RoninFlow risk rules. Try it on a simulation account first.

## 2.0.0

RoninFlow 2.0 brings together everything from the 1.9 series. If you're coming from 1.8, here's what's new — each 1.9.x section below has the details.

- **Macro:** dealer gamma exposure (GEX) for SPX, NDX, RUT and more, with every level in ES / NQ / RTY prices and a *GEX levels* indicator on your charts. Also News Flow (live headlines traced to the markets you trade), the News Heat Map and News Agents with alerts.
- **Draw on screenshots:** pen, highlighter, lines, arrows, boxes, circles and text on any trade or diary screenshot, editable any time. Resize or move anything with whatever tool is picked, zoom while you draw, use a smooth pressure-sensitive pen for handwriting, set size with a slider, and handwriting groups into one note.
- **Draw on charts the same way:** a smooth brush that draws exactly where your pen goes, handwriting groups, resize and move with any tool, and size sliders. Drawings stay hidden during a replay until the bars they cover have played. Your tools, colours and sizes are remembered between sessions.
- **Screenshots, filed for you:** a watched folder files every new screenshot on the trade open when it was taken (or that day's diary). Bulk upload does the same, also when switching to RoninFlow, with a "Days only" switch. Screenshots are zoomable, and the chart camera saves straight to the trade or day.
- **Trading Coach context:** narrow the coach by strategy, market condition, tags and edge blockers. Tags and edge blockers are now your own to edit.
- **A more polished look:** gently rounded corners everywhere, calendars with spaced tiles and a phone layout with week totals, a weekends setting, a Sunday-to-Saturday weekly review, a heat map with week totals, slim scrollbars and sliders, and solid table headers.

**Updating:** nothing to reinstall. Restart RoninFlow after updating if you're coming from before 1.9.3, so the GEX fix and the screenshot folder watcher start.

## 1.9.10

- **Chart brush draws real curves:** freehand strokes on the chart were snapped to whole bars, so circles and handwriting came out as stair steps. Drawings now land exactly where the pointer is, between bars too — which also makes every other drawing tool follow the mouse precisely when the magnet is off.

**Updating:** nothing to reinstall.

## 1.9.9

- **Size slider:** one slider (1–40) in the screenshot editor sets line thickness and text size, instead of three fixed sizes.
- **Handwriting groups:** with the pen, strokes written close together — each within 5 seconds of the last — join into one note, and while you're writing the earlier strokes can't be grabbed or resized by accident. Pause and the whole note becomes a single drawing you can move, resize or erase. A faint outline shows the note that's still open. "Group" in the toolbar turns it off or sets the pause (1–15 s) and how close strokes need to be (close, normal, far).
- **Chart drawing, like the screenshot editor:** the chart's brush now draws smooth, pressure-aware strokes (great with a pen tablet), stays picked so you can keep writing, and groups handwriting into one note the same way. A brush bar shows its colours, a size slider (0.5–40) and the Group settings. Whatever tool is picked, drag a drawing's handles to resize it — brush notes and rectangles now have corner and edge handles, and a rectangle's edges stretch it — or its middle to move it (lines that run across the whole chart move with the cursor only, so you can draw over them). The thickness and text-size buttons are now sliders.
- **Drawings follow the replay:** while replaying, a drawing stays hidden until the bars it covers have played, so notes and levels from later in the day don't give the move away. Anything you draw during a replay stays visible from that point on.
- **Your drawing settings are remembered:** the screenshot editor reopens with the tool, colour, size and Group settings you used last; on the chart, the brush keeps its colour and size, and every other tool draws with the colour, thickness or text size you last gave one of its drawings — from one session to the next.
- **Sleeker sliders:** every slider in the journal has a slim track that fills up to the value and a round thumb.

**Updating:** nothing to reinstall.

## 1.9.8

- **Screenshot editor — resize and move anything:** whatever tool is picked, hover a drawing and drag its middle to move it, or a corner or edge handle to resize it — boxes, circles, pen and highlighter strokes, a line's or arrow's ends, and text (which scales its size). Shift keeps proportions.
- **Zoom while you draw:** scroll to zoom in where the pointer is (up to 10×), hold Space or the middle mouse button and drag to move around, 0 to fit — the zoom level shows in the toolbar.
- **Smoother pen for handwriting:** every sample a pen tablet sends is used, lightly smoothed and drawn as curves; with a Wacom or other pressure pen the line thickens and thins with how hard you press. Drawing is also faster on big screenshots.

**Updating:** nothing to reinstall.

## 1.9.7

- **Draw on your screenshots:** open any trade or diary screenshot and click **Draw** — pen, highlighter, line, arrow, box, circle and text, seven colours and three widths, plus move, eraser and undo/redo (Ctrl+Z / Ctrl+Shift+Z, Ctrl+S to save, letter keys for tools; Shift keeps lines straight and boxes square). The drawing is saved onto the screenshot everywhere it shows, and stays editable: reopen it with **Edit drawing** to move, change or remove anything — the original picture is kept underneath.

**Updating:** nothing to reinstall.

## 1.9.6

- **Tables:** the header row stays fully solid while you scroll — no more rows peeking through gaps between the header cells (Trading Journal, the daily view's trades and every other table).
- **Daily view checklists:** no frame around the pre- and post-session checklists; each item is its own gently rounded row.

**Updating:** nothing to reinstall.

## 1.9.5

- **Cleaner scrollbars:** slim, rounded handles with no track or arrow buttons throughout the app; the sidebar's only appears while you're over the menu.

**Updating:** nothing to reinstall.

## 1.9.4

- **A more polished look:** slightly rounded corners everywhere — cards, buttons, inputs, menus, pop-ups and badges (no more sharp edges) — and green, red and yellow cards are outlined in their own colour.
- **Calendars:** a hairline gap between gently rounded day tiles (and the same gap at the card's edge), no lines around the day names, and the weekly review's tiles in the same colours as the month calendars.
- **Calendars on a phone:** weekdays only when the weekend's empty, square filled tiles with the day's P&L and trade count, and the week's total in a column on the right.
- **Weekends in calendars (Settings → General):** Auto, Show or Hide — Hide shows Monday to Friday in every calendar (weekend trades still count in the week totals); Show adds Saturday and Sunday everywhere, the weekly review included.
- **Weekly review:** runs Sunday to Saturday, like the calendars' rows (a Sunday-evening session counts toward the week it opens); no outer frame around the day tiles.
- **Yearly review:** the heat map has a week column, shaded by each week's total — hover for the numbers, click to open that week.
- **Quarterly review:** the month cards fit properly with weekends hidden.
- Wrapped: round, see-through arrows and a rounded Wrapped button.
- Fix: screenshots in the viewer no longer get cut off at the bottom.

**Updating:** nothing to reinstall.

## 1.9.3

- **Screenshots — “Days only”:** a switch on screenshot uploads (Settings → Screenshots → Upload screenshots, and the trade import) and on the folder watcher puts every picture on its day's diary instead of on the trade open at the time — for daily recap screenshots.

**Updating:** nothing to reinstall. Restart RoninFlow after updating so the folder watcher picks up the new setting.

## 1.9.2

- **Automatic screenshot imports (Settings → Screenshots):** pick the folder your screenshots save to — Snipping Tool / Win+Shift+S, ShareX, your platform's screenshot folder, TradingView's downloads — and every new picture is filed by the time it was taken: on the trade that was open then (or closed within the last few minutes, 10 by default), otherwise on that day's diary with a market/timeframe caption. When several markets were open at once, the coach's AI (if set up) reads the instrument off the picture. A picture taken during a trade that hasn't synced yet waits for it. Pictures taken while RoninFlow was closed are filed when it opens.
- **Bring your screenshots when you switch:** the trade import has an “Also add my chart screenshots from these dates” option — choose a folder (or pictures) and every one is filed on its trade, or that day's diary. Settings → Screenshots → Upload screenshots does the same for any period. The time comes from the file name when it has one (Snipping Tool, macOS, TradingView, ShareX, Android), otherwise the file's date.
- **Zoomable screenshots:** open any screenshot (diary, trade or strategy) and click the picture to zoom in there, or use the mouse wheel, a pinch or + / − / 0; drag to look around. Clicking outside the picture closes it.
- **The chart camera saves to the right place:** in a trade's full-screen chart it adds the picture to that trade's screenshots; in a diary day's chart it adds it to that day's screenshots (captioned with the market and timeframe). Shift-click still downloads a PNG; backtests download as before.
- Macro → **Heat Map** is now called **News Heat Map**.
- **Economic calendar:** when ForexFactory's free feed says slow down (HTTP 429), RoninFlow backs off (10, 20, 40 minutes… up to 2 hours) and fetches next week's file only every few hours; while the saved copy is recent it shows a quiet "saved copy" note instead of a warning.
- Fix: GEX data stopped loading ("Cboe has no options") — Cboe moved its free option quotes to a new address behind a firewall; RoninFlow now asks there, the way Cboe's own quote pages do.
- Fix: pressing Esc in a full-screen chart closes only the chart, not the trade or diary behind it.

**Updating:** nothing to reinstall — add-ons stay as they are. Restart RoninFlow after updating so the GEX fix and the screenshot folder watcher start.

## 1.9.1

- **Trading Coach → Context:** narrow what the coach looks at by strategy, the day's market condition (from your Diary check-in), tags and edge blockers (any blocker, none — your disciplined trades — or specific ones), on top of account and period. The panel shows how many trades are in context, and the AI is told exactly which trades it's looking at.
- **Your own tags and edge blockers:** an Edit button next to them on every trade — add, rename, reorder or remove. A rename carries over onto your past trades; removing one leaves trades that already have it alone.
- Fix: the hover box on P&L charts (e.g. an account's chart near the right edge) stays inside the chart instead of being cut off.
- Fix: the coach's Context menu is no longer cut off — it opens on the side it fits (and scrolls on small screens).

## 1.9.0

- **Macro → GEX:** dealer gamma exposure for SPX, NDX, RUT, SPY, QQQ and IWM (or any optionable ticker) — call wall, put wall, gamma flip, gamma zone and total GEX, a GEX-by-strike chart (net cumulative and total-GEX-by-price lines, zoom and pan), vanna and charm for 0–45 and 46–180 days, and a plain-English summary from your Trading Coach. Every level is shown in ES / NQ / RTY prices too.
- **Data:** Cboe's free delayed quotes by default (no key); real time from Polygon (options plan) or Tradier (a free brokerage account's API token), chosen under the gear icon.
- **GEX levels on your charts:** during US market hours the levels are saved every 15 minutes, and the new *GEX levels* indicator in the full-screen chart draws the call wall, put wall and flip on ES, NQ and RTY — replays only show what was known at the replay's time.
- **Macro → News Flow:** live headlines from free feeds (the Fed, BLS, White House, Trump's posts, investingLive, FXStreet, CNBC, MarketWatch and more, plus your calendar's releases) sorted into stories and traced to the markets you trade — each line's tone, the steps from it to your market, the move in the 15 minutes after, repeats folded, contradictions flagged, and **Similar news** with what the market did next.
- **Macro → Heat Map:** every macro driver for one market on one screen — stories, the Fed, data surprises, the dollar and yields, oil, gold and the VIX — coloured by whether it helps or hurts, with a verdict and whether the 5m / 1h / 4h trend agrees.
- **Macro → News Agents:** Fed, Data, Trump, Geopolitics and per-market agents, or your own in a sentence (a position, a price move or keywords). Alerts land in the top-bar pill, which pulses until you click it.
- **Optional AI for news:** built-in rules read every headline for free; switch on AI to have your Trading Coach's provider read the important lines and your sentence agents (with an hourly cap).
- The news follows every market you've traded in the last 120 days, plus any you add.
- Live demo: the GEX page, the indicator and the news pages work with sample data.
- **Converting to your futures:** after the 4 PM cash close the index's price stays at its close while futures keep trading, so the levels are converted with the futures' price at the close (not an after-hours price) and the page shows where the index would be now from the futures' latest price. ES, NQ or RTY prices are requested from your platform's add-on even on days you didn't trade that market.
- **News alerts** can be dismissed one by one or all at once, and the top-bar pill marks today's events as high-impact scheduled releases.
- Fixes: the GEX data time showed 8 hours off (Cboe's time is UTC); the what-if time boxes fit AM/PM.

**Updating:** nothing to reinstall — the add-ons from 1.8.1 already fetch the extra futures prices.

## 1.8.1

- **Ticks around your trades, automatically:** your platform add-on now sends every tick from the hour before your first trade to the hour after your last, for the last 14 days, in the background — the way it sends 1-minute bars — so replays of those days go tick by tick straight away. A replay you're watching always comes first, and it never slows the platform while you trade. Switch it off in Settings → Price data.
- **Ticks take ~17× less space:** they're saved compressed (a busy ES hour: ~0.6 MB instead of ~10 MB — about 300 MB for a year of one market). Ticks you already have are compressed in the background after the update.
- **Shared links and snapshot files:** charts open full screen with replay — tick by tick where ticks are saved (a link reads them from your computer and never fetches any for a visitor; a snapshot file carries them inside — "Include saved tick data", on by default).
- **Fix — charts missing part of a day:** a day one source only had part of (e.g. from before the add-on was on your chart) is now filled from your other saved bars and history downloads, so the whole day shows and your executions sit on the right candles. ATAS is asked for its chart's history when a recent trade day has gaps, and the other add-ons notice a missing morning, not just a missing end of day.
- **Every add-on fills in for trades from anywhere:** NinjaTrader, Quantower, cTrader, MetaTrader 5 and Sierra Chart now fetch bars and ticks for days you traded through a broker connection, a file import or another platform too — named the way that platform names your other markets (NinjaTrader and Sierra Chart need no trades there at all).
- Live demo: the Ronin Score replaces Most Traded on layouts saved by older versions of the demo.

**Updating:** tick replay and the automatic ticks need this release's add-ons (ATAS: Journal Sync 1.5.1). If yours is older, reinstall it from the Start menu (*Install platform add-ons*) or `scripts\addons.ps1`, then restart the platform. Trade sync keeps working with older add-ons.

## 1.8.0

- **Backtesting** (new sidebar page), three ways:
  - **Replay sessions:** trade any day as if it were live in the full-screen chart. An order panel like your platform's — market, Buy Bid / Sell Ask, limit and stop orders, Cancel Bids / Asks / All, Reverse, Breakeven, Close, and SL / TP brackets in ticks. **Drag a Buy / Sell LMT or STP button onto the chart** to place the order where you drop it; drag order, stop and target tags to move them, × to cancel. Working orders fill where price reaches them (gaps at the open; a fill and its stop in the same bar count as stopped). Pick any date from the date at the top left, or **Start from a bar** — scroll back for earlier days and click where the replay should restart. Each session keeps its trades and stats, and sessions can be compared.
  - **What-if:** your real trades re-run with the rules you meant to follow — max trades or losing trades a day, daily loss limit or profit target, max loss per trade, a time window, weekdays, longs / shorts only, skipping strategies, symbols or tags — with the new equity curve next to the real one and what each rule changed.
  - **Automated:** strategies from a rule builder (or code) run over your platform's full 1-minute history. **Download history** asks the add-on for it a week at a time (ATAS sends its charts' history instead; an ES chart serves MES), joined and back-adjusted at contract rolls. Market, stop and limit entries, trailing stop, breakeven, risk-based position size, commission and slippage, entry window and flat-by time. Results: a TradingView-style performance summary (all / long / short), monthly table, drawdown chart, trades with MAE / MFE and CSV export (click one to see it on the chart). Against overfitting: a locked out-of-sample period, a parameter sweep that ranks settings by their neighbours (robust, not lucky), walk-forward, Monte Carlo, a +1-tick slippage test, a random-entry baseline and a luck test. Checked trade-for-trade against an independent backtester.
- **Tick-by-tick replay:** when a source has the ticks, replays move trade by trade — the bar builds up and orders fill at traded prices. Speeds are real time to 60×, plus a one-tick step. Ticks come from **ATAS** (Journal Sync 1.5: fetched from ATAS's trade history for the hour you're replaying), **NinjaTrader**, **Quantower**, **MetaTrader 5**, **cTrader**, **Sierra Chart** (update the add-on), **Databento** or **Polygon**. The Ticks button shows where they come from; without them the replay goes bar by bar.
- **Volume profile:** for the visible range or each session (Indicators), and a **fixed-range volume profile** drawing tool — one row per tick, buying / selling, value area, POC / VAH / VAL. It never uses bars past the replay position.
- **Charts:** scroll left to load earlier days; a nicer replay progress bar (day boundaries, your executions, hover time); symbols that don't fit above the execution chart go in a "+N" menu; days whose saved bars are hourly switch to 1-minute bars once your platform has them.
- **Sharing:** links and snapshot files include the execution charts (a link loads prices for its own trades' days, never from a paid source; a snapshot carries them inside).
- **Live demo:** backtesting (replay with ticks, what-if and automated), every chart, the Macro pages (adding COT markets, earlier releases of calendar events) and snapshot files now work in the demo too.
- **Price data:** micro and full-size contracts (MES / ES, MNQ / NQ…) count as one market for history downloads and day requests; a day with no prices says what to do for your platform instead of "no price source".
- Phones: pop-ups stay on screen, and the dashboard calendar sizes to its content. The home-server copy keeps working when public sharing (Funnel) is on, and reaching the private app over Funnel shows a friendly page instead of "Not found".

## 1.7.0

- **Full-screen charts:** the expand button on any execution chart opens it full screen with TradingView-style tools.
  - **Drawing tools:** trend line, ray, horizontal line and ray, vertical line, rectangle, Fibonacci retracement, measure, long / short position (target, stop, R:R), brush and text — text can be resized and rotated. A magnet that snaps to the candles, hide, undo and delete; drawings are saved per instrument.
  - **Indicators:** EMA, SMA, VWAP, Bollinger Bands, RSI and MACD, plus volume. Timeframes from 1m to 1d, your executions on or off, chart colours (the palette button) and a screenshot button.
- **Market replay:** press Replay in the full-screen chart to step through the session bar by bar — play at 1× to 60×, step forward or back, jump to your next execution — with your fills, position and P&L appearing as they happened. Start from the first bar, 30 minutes before your first trade, or a bar you pick on the chart.
- **Your own dashboards:** add, rename and delete dashboards from the dashboard picker; each one keeps its own layout.
- **Ronin Score widget:** one 0–100 score from six parts (win %, profit factor, avg win/loss, recovery factor, max drawdown, consistency) on a radar. Click the title for how it's worked out, or **Weakest:** for what your score says about your trading — each part with your number, what it means and what to work on. Shrink it to KPI-card size and it keeps the radar (labels on hover) and the score.
- **Custom Chart widgets** (three of them): pick what goes along the bottom (day of week, hour, symbol, strategy, tag, market condition, account, each day / week / month…) and up to three metrics (net P&L, win %, trade count, profit factor, average win / loss, hold time…) as bars or lines.
- **Cross Analysis widget:** P&L (or win %) by symbol across weekdays, weeks, months or quarters as a heat map.
- **New default dashboard** for new installs and the live demo: six KPI cards (with the Ronin Score), account progress, Net P&L, hold time, edge blockers, weekday / hour / symbols, average day / trade, streaks, risk, drawdown and the calendar.
- **Live demo:** execution charts, the full-screen chart and replay now work with made-up prices that pass through the demo trades.
- Pop-ups on dashboard cards are no longer cut off by the card edge.

## 1.6.2

- **Market conditions and strategy performance on monthly, quarterly and yearly reviews:** a card per market condition and per strategy with a small P&L curve, P&L, win rate and profit factor for that period (plus "No condition logged" / "No strategy" cards). Click one for its full stats — EV, Performance Ratio, ROMAD, the metric grid and the equity curve — with a condition's "How to spot it" or a strategy's rules on top.
- **Strategy page:** Trading strategies now match Market conditions — the same 30 days / 90 days / 1 year / All time range, a "best strategy" line, cards with the P&L curve, Net P&L, win rate, trades and EV per trade, and the stats pop-up on click (with a button to the strategy's page). Market condition cards look the same and open their stats too.
- A strategy's own page uses the same stats layout (EV / PR / ROMAD, metric grid, equity curve) above its checklist, notes and trades.
- The Strategy page now follows the account picker, like Market conditions (it used to count trades from every account).

## 1.6.1

- **Price data settings:** every source in Settings → Price data now has an on/off switch.
  - **Your platform add-on** is on by default. The badge shows when bars are coming in ("Receiving · 2 symbols", or "On · waiting for bars"). Off: charts don't use your platform's bars and the add-ons stop fetching them.
  - **Use bars from:** if you're connected to more than one platform, pick which one the charts use — or leave it on "Any platform" (the one with the most data for that day). Only the chosen platform's add-on fetches bars. Bars are now kept per platform; ones saved before this still fill in any day the chosen platform hasn't sent.
  - **Databento and Polygon** can be switched off without removing the key.

## 1.6.0

- **Price data from every platform add-on:** the NinjaTrader, Quantower, cTrader, MetaTrader 4/5 and Sierra Chart add-ons now load the 1-minute bars for each day you traded from the platform's own data connection and send them for the diary's execution charts — no Databento, Polygon or Yahoo needed. Past days (up to 45) fill in when the add-on starts, today's chart keeps up as you trade, and a day that's done isn't fetched again. (ATAS already sent the bars of the 1-minute chart it's on.)
  - **Update your add-on to get this:** reinstall it the same way you installed it (e.g. `npm run addon:nt`, then F5 in the NinjaScript Editor; recompile the Expert Advisor in MetaEditor; rebuild the Sierra Chart study or cTrader cBot). Older add-ons keep syncing trades but don't send bars.
  - Sierra Chart opens a hidden 1-minute chart of each contract to read its bars, building the symbol from your chart's (e.g. MNQZ25 + "_FUT_CME").
- Settings → Price data and each add-on's help explain where the bars come from.

## 1.5.1

- **About RoninFlow in shared journals:** clicking the RoninFlow name at the top left of a view-only link or snapshot file opens a short popup explaining what RoninFlow is, with buttons to the GitHub repository and the latest download.

## 1.5.0

- **Share your journal, view-only:** a Share button at the top makes a link anyone can open to see your whole journal or just the page you're on (a review, a diary day, the dashboard…). Nobody can change anything, account numbers are hidden and accounts show as "Account 1, 2…", and only your first name appears. Pick when a link expires, optionally hide dollar amounts, and turn off or remove links any time; each link shows how often it's been viewed.
  - **Live links** work from anywhere through Tailscale Funnel (turn it on from the dialog) or your own public address. A page link only includes that page's dates.
  - **Snapshot file:** download a single HTML file of the same view that opens offline, with no server needed — handy for sending in a chat or email.
- **Sync trade reviews across accounts** (Review page): notes, tags, strategy, edge blockers, rating, screenshots and "reviewed" you add to a trade are saved on the same trade on your other accounts — all of them or the ones you pick — so a breached account's journal isn't lost. "Copy existing reviews now" fills in what's missing on past trades and shows what it will copy.

## 1.4.0

- **Risk profiles:** save any set of risk rules as a named profile (e.g. "$2k eval") for a given max drawdown, then have accounts follow it. Edit the profile once and every account on it updates; "Give it its own copy" splits one account off.
  - A profile made for an account's max drawdown is suggested automatically — in Risk rules and in the Add / Edit account form, which now has a **Risk rules** dropdown that picks the matching profile for you.
  - "Use a profile" switches an account to a profile; on the default plan, "Copy from a profile" loads a profile's rules.
  - Profiles appear in the "Rules for" picker with how many accounts use them; rename, change the drawdown size, edit or delete them there (deleting puts their accounts back on the default plan). The Risk page shows which profile an account follows.
- **Days to ruin** on the Current risk card: how many full max-loss days the account can take before hitting its max drawdown, running your risk rules forward — tiers step down with losing streaks and drawdown thresholds, each day capped at the firm's daily loss limit, measured to the account's real max-loss floor. Click it for the day-by-day path. Stacks under the title on phones.

## 1.3.0

- **Risk rules per account:** Risk rules now has a "Rules for" picker — the default plan or any account. Accounts use the default plan until you give them their own, either as a copy of the default or scaled to the account's max drawdown (with daily loss limits capped at the firm's). The Risk page, sidebar risk box and diary follow the plan of the account you're viewing, and the Start/Peak switch only changes that plan.
- **Add, remove and reorder tiers**, and choose which tier is Normal. Tiers above Normal stay locked until unlocked; losing streaks step you down one tier at a time.
- **Each tier sets the drawdown it kicks in at**, right in its row (leave it empty for streak-only tiers). Your existing two thresholds carry over. The Risk page's drawdown bar shows every threshold, how much room is left before the next one, and what it takes to climb out.
- Warnings in the editor when a daily loss limit is above the firm's, when tiers or thresholds are out of order, and each threshold as a % of the firm's max drawdown.
- **Profit target and max-loss lines on account charts.** The max-loss line follows the account's drawdown type — flat for static, stepping up after each best close for EOD trailing, and with the highest point reached for intraday trailing — and stops at the starting balance if the account is set to. Hover a day for its floor and the room left; daily bars show the daily loss limit instead. A Limits button hides them.

## 1.2.2

- **Big numbers fit their boxes everywhere:** the calendars (dashboard, monthly and quarterly reviews), review stat tiles and the Average Trade / Average Day widget now show a number in full when it fits, switch to the short form ($143k) when it doesn't, and shrink only if needed, based on the space each box actually has rather than the window size. Large days and weeks no longer spill out or get cut off with "…".
- The line under "Disciplined trades" wraps instead of hiding the cost of flagged trades, and the month review's "7 trades · 29%" no longer breaks across lines.

## 1.2.1

- **Weekly review numbers fit their tiles:** each day's and the week's P&L shrinks just enough to fit, so five- and six-figure days no longer spill out on smaller screens. The week's "trades · WR" line no longer wraps.

## 1.2.0

- **Build your own dashboard:** click **Edit layout**, then drag widgets anywhere (the others move out of the way, and dropping on a widget the same size swaps them), drag a corner to resize, or use the arrow keys on a widget's handle (Shift + arrows resizes). Undo, reset, and changes save as you go. The editing bar stays at the top while you scroll.
- **Add widgets** from a library with search and categories (Charts, Tables, KPIs, Calendar) — 26 in all. Every KPI is now its own widget, plus new ones: Long vs Short, Total Payouts, Equity Chart (your balance from the starting balance), Max Drawdown, Performance by Hold Duration, Strategy Performance and Performance by Tag. Some have options (the "Performance by…" widgets show P&L, win rate or trade count).
- My Dashboard, Performance, Risk and Psychology each keep their own layout. Your current dashboard opens as it was, including any widgets you'd hidden.
- On a phone the widgets stack in one column; you can still add, remove and configure them there.
- **Account selector on the Daily Diary** — on the sessions list (with each account's session count) and on each day's page. If the chosen account didn't trade that day but another did, the day says so.
- **Macro:** switch between the Economic Calendar and the COT Report from the page title instead of the sidebar.
- A change made just before closing or reloading the page is no longer lost — it's saved when the page opens again.

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
