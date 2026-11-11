// The platforms the journal can take trades from, and how. Status: 'ready' (works today) or 'soon' (planned).
// Live add-ons and webhooks all feed the same connector inbox (connect.js); file imports use the Import dialog.

export const GROUPS = [
  { id: 'live', label: 'Live sync', sub: 'An add-on inside your trading platform sends every fill as it happens. Works with any broker or prop firm you use on that platform (Rithmic, Tradovate, CQG…).' },
  { id: 'api', label: 'Brokers & prop firms', sub: 'Connect straight to the account with your own API key. The journal checks for new trades on a schedule.' },
  { id: 'crypto', label: 'Crypto exchanges', sub: 'Use a read-only API key (never enable trading or withdrawals). Perpetual futures and spot trades are paired into round trips.' },
  { id: 'webhook', label: 'Webhook / API', sub: 'Anything that can send JSON — scripts, bots, automation services — can push fills or trades.' },
  { id: 'file', label: 'File import', sub: 'Export your history from the platform and drop the file in. The format is recognised automatically.' },
];

// Instructions shared by the platform add-ons. Windows-only platforms on a Mac / Linux journal run on a Windows PC (or VM)
// that sends to this computer over the network; file-based ones (MetaTrader, Sierra Chart) must run here under Wine.
const ADDON_WIN = (name, npm) => `Start menu → RoninFlow → Install platform add-ons, then choose ${name}. (Running from the source code? In the RoninFlow folder run  ${npm}.)`;
const OTHER_PC = (name) => `On the Windows PC, download RoninFlow-<version>.zip from the Releases page on GitHub, unzip it, right-click scripts\\addons.ps1 → Run with PowerShell, and choose ${name}.`;
const ADDON_FILE = (dir) => `it’s in the ${dir} folder of RoninFlow-<version>.zip on the Releases page, or of RoninFlow’s app folder on this computer`;
const NET_STEP = ['Let other devices reach this journal', 'Here: Settings → Security & privacy → Phone & network access → allow devices on your network. It shows this computer’s address, like http://192.168.1.20:5173. The token is under Connections → Webhook / API.'];
const VM_NOTE = 'Trading in a Windows virtual machine on this Mac (Parallels, VMware, UTM)? Same steps inside the VM, using the Mac’s address on the VM’s network.';

export const CONNECTORS = [
  // live add-ons
  { id: 'atas', name: 'ATAS', group: 'live', status: 'ready', blurb: 'Journal Sync indicator: live fills, account balances and open P&L.' },
  { id: 'ninjatrader', name: 'NinjaTrader 8', group: 'live', status: 'ready', blurb: 'NinjaScript add-on: live executions and balances from any NinjaTrader connection.',
    setup: [
      ['Install the add-on', `${ADDON_WIN('NinjaTrader 8', 'npm run addon:nt')} It copies the add-on into Documents\\NinjaTrader 8\\bin\\Custom\\AddOns and creates a settings file.`],
      ['Compile it in NinjaTrader', 'Control Center → New → NinjaScript Editor, then press F5. It starts by itself from then on, every time NinjaTrader opens.'],
      ['Check it’s running', 'New → NinjaScript Output should show “[RoninFlow] started”. This card turns green within 30 seconds.'],
      ['Trade', 'Every fill on every connected account (Sim101 included) is sent. Trades appear once the position is flat.'],
    ],
    notes: [
      'Journal on another computer (home server)? Edit Documents\\NinjaTrader 8\\journal-sync.txt: set url= to its address + /api/connect/ingest and token= to the token under Webhook / API.',
      'Only some accounts? Add  accounts=Sim101,APEX-123  to the same file.',
      'NinjaTrader set to a different time zone than Windows (Tools → Options → General)? Add  timezone=Eastern Standard Time  (the Windows zone name).',
      'Today’s executions are sent when it starts, so trades placed before installing still come in. Repeats are ignored.',
    ],
    unix: {
      setup: [
        ['NinjaTrader runs on a Windows PC', 'NinjaTrader 8 is a Windows program, so the add-on goes on the Windows PC (or Windows virtual machine) you trade on. It sends your fills over the network to this journal.'],
        NET_STEP,
        ['Install the add-on on the Windows PC', `${OTHER_PC('NinjaTrader 8')} Then in NinjaTrader: Control Center → New → NinjaScript Editor → F5.`],
        ['Point it at this journal', 'On the Windows PC edit Documents\\NinjaTrader 8\\journal-sync.txt: url=http://<this computer’s address>:5173/api/connect/ingest and token=<the token under Webhook / API>. NinjaScript Output shows “[RoninFlow] started” and this card turns green within 30 seconds.'],
      ],
      notes: [
        VM_NOTE,
        'Only some accounts? Add  accounts=Sim101,APEX-123  to journal-sync.txt. Different time zone in NinjaTrader than Windows? Add  timezone=Eastern Standard Time.',
        'If this computer is off while you trade, nothing is lost — today’s executions are sent again when NinjaTrader starts. Repeats are ignored.',
      ],
    } },
  { id: 'quantower', name: 'Quantower', group: 'live', status: 'ready', beta: true, blurb: 'Strategy that sends live fills and balances (Rithmic, CQG, dxFeed, Tradovate… connections).',
    setup: [
      ['Install the .NET SDK (once)', 'Quantower runs compiled strategies, so building this one needs Microsoft’s free .NET SDK: dotnet.microsoft.com/download → “.NET SDK” for Windows.'],
      ['Build it into Quantower', `${ADDON_WIN('Quantower', 'npm run addon:qt')} It finds Quantower, builds the strategy and puts it in Quantower\\Settings\\Scripts\\Strategies. If Quantower isn’t in C:\\Quantower it tells you how to point at it.`],
      ['Run it', 'Restart Quantower, open Strategies Manager, pick “RoninFlow Sync” and press Run. Its log shows “[RoninFlow] started”.'],
      ['Trade', 'Every fill on every connected account is sent; trades appear in the journal once the position is flat. This card turns green within 30 seconds.'],
    ],
    notes: [
      'Beta: built from Quantower’s published API but not yet tried on every connection type. If something looks off, open an issue on GitHub with the strategy log.',
      'Fills from the last 30 days are sent when it starts (change “Days of history” in the strategy settings). Repeats are ignored.',
      'Journal on another computer? In the strategy settings set Journal address to its address + /api/connect/ingest and paste the token from Token & endpoint.',
    ],
    unix: {
      setup: [
        ['Quantower runs on a Windows PC', 'Quantower is a Windows program, so the strategy goes on the Windows PC (or Windows virtual machine) you trade on. It sends your fills over the network to this journal.'],
        NET_STEP,
        ['Build it on the Windows PC', `Install Microsoft’s free .NET SDK there (dotnet.microsoft.com/download), then: ${OTHER_PC('Quantower')}`],
        ['Run it, pointed at this journal', 'Restart Quantower → Strategies Manager → “RoninFlow Sync”. In its settings set Journal address to http://<this computer’s address>:5173/api/connect/ingest and Token to the token under Webhook / API, then Run. This card turns green within 30 seconds.'],
      ],
      notes: [VM_NOTE, 'Fills from the last 30 days are sent when it starts, so nothing is lost if this computer was off. Repeats are ignored.'],
    } },
  { id: 'sierrachart', name: 'Sierra Chart', group: 'live', status: 'ready', blurb: 'Custom study that sends your fills from the charts you trade on.',
    setup: [
      ['Copy the study', `${ADDON_WIN('Sierra Chart', 'npm run addon:sierra')} It copies TradeJournalSync.cpp into C:\\SierraChart\\ACS_Source (it tells you how to point at another folder).`],
      ['Build it', 'In Sierra Chart: Analysis → Build Custom Studies DLL → select TradeJournalSync.cpp → Remote Build. Sierra Chart compiles it on their servers — nothing else to install.'],
      ['Add it to your trading chart', 'Analysis → Studies → Add Custom Study → RoninFlow Sync → Add → OK. The Message Log shows “RoninFlow Sync started”.'],
      ['Trade', 'Fills reach the journal within ~10 seconds and are paired into trades once you’re flat. This card turns green within ~15 seconds.'],
    ],
    notes: [
      'Sierra Chart only gives a study the fills for its own chart’s symbol and trade account — add the study to each symbol’s chart you trade (one per symbol/account is enough).',
      'Older fills come in too, as far back as the chart’s “Order Fills Start Date-Time” setting (Trade → Trade Activity Log settings). Repeats are ignored.',
      'Fill times are converted from Sierra Chart’s time zone setting to UTC. If trades show up shifted by hours, set the study input “Fill times are already UTC” to Yes.',
      'It writes to %LOCALAPPDATA%\\TradeJournal\\drop, which the journal on this PC reads — so the journal needs to run on the same PC.',
    ],
    unix: {
      setup: [
        ['Run Sierra Chart here with CrossOver or Wine', 'Sierra Chart is a Windows program. On a Mac or Linux computer it runs under CrossOver or Wine — install it that way on this same computer, because the study hands fills to the journal through a file.'],
        ['Copy the study into Sierra Chart', `Copy TradeJournalSync.cpp (${ADDON_FILE('sierrachart-addon')}) into the ACS_Source folder inside Sierra Chart’s install folder — in CrossOver, “Open C: Drive” and go to SierraChart\\ACS_Source.`],
        ['Build it', 'In Sierra Chart: Analysis → Build Custom Studies DLL → select TradeJournalSync.cpp → Remote Build. Sierra Chart compiles it on their servers, so it works the same under CrossOver / Wine.'],
        ['Add it to your trading chart', 'Analysis → Studies → Add Custom Study → RoninFlow Sync → Add → OK. The journal finds the CrossOver / Wine folder by itself; this card turns green within ~15 seconds.'],
      ],
      notes: [
        'Sierra Chart on a separate Windows PC can’t send to a journal on another computer (it passes fills through a file). Run RoninFlow on that PC too, or export the trades and use File import.',
        'The journal looks in CrossOver bottles, ~/.wine and the usual Wine / Bottles / PlayOnLinux / Lutris folders. Add the study to each symbol’s chart you trade, as on Windows.',
        'If trades show up shifted by hours, set the study input “Fill times are already UTC” to Yes.',
      ],
    } },
  { id: 'metatrader', name: 'MetaTrader 4 / 5', group: 'live', status: 'ready', blurb: 'Expert Advisor that sends every closed trade and the account balance.',
    setup: [
      ['Install the Expert Advisor', `${ADDON_WIN('MetaTrader 4 / 5', 'npm run addon:mt')} It copies TradeJournalSync into every MetaTrader 4 and 5 on this PC.`],
      ['Load it on a chart', 'In MetaTrader: Navigator → Expert Advisors → right-click → Refresh, then drag “TradeJournalSync” onto any chart and press OK. (Not listed? Open it in MetaEditor and press F7 to compile.)'],
      ['Check it’s running', 'The Experts tab shows “[RoninFlow] started”. This card turns green within ~15 seconds.'],
      ['Trade', 'Closed trades reach the journal within ~10 seconds, with P&L including commission and swap.'],
    ],
    notes: [
      'No “Allow WebRequest” setting and no algo-trading permission is needed — it only reads history and never trades.',
      'It writes to MetaTrader’s shared folder (Common\\Files\\TradeJournal), which the journal on this PC reads. So it works with the journal on the same PC; for a journal on another computer use the webhook from a script instead.',
      'MetaTrader 4 only shares the history shown in its Account History tab — right-click there and pick All History (or Last 3 Months) so older trades come in.',
      'One chart per terminal is enough. Several terminals / accounts each get their own file, so they don’t clash.',
      'The last 30 days are sent when it starts (BackfillDays input). Partly closed MT5 positions are sent once they’re fully closed.',
      'Times are converted from the broker’s server time to UTC using the server’s current offset.',
    ],
    unix: {
      setup: [
        ['Use MetaTrader on this computer', 'On a Mac use MetaQuotes’ MetaTrader 5 (or 4) app for macOS; on Linux, MetaQuotes’ install script or Wine. It needs to be on the same computer as the journal, because the Expert Advisor hands trades over through a file.'],
        ['Copy the Expert Advisor in', `In MetaTrader: File → Open Data Folder → MQL5 → Experts (MQL4 → Experts for MetaTrader 4), and copy TradeJournalSync.mq5 (or .mq4) there — ${ADDON_FILE('metatrader-addon')}.`],
        ['Load it on a chart', 'Navigator → Expert Advisors → right-click → Refresh, then drag “TradeJournalSync” onto any chart and press OK. (Not listed? Open it in MetaEditor and press F7.)'],
        ['Check it’s running', 'The Experts tab shows “[RoninFlow] started”. The journal finds MetaTrader’s folder by itself; this card turns green within ~15 seconds.'],
      ],
      notes: [
        'It only reads history and never trades — no WebRequest or algo-trading permission is needed.',
        'The journal looks in MetaQuotes’ Mac app, ~/.mt5, ~/.wine, CrossOver bottles and the usual Wine / Bottles / PlayOnLinux / Lutris folders. Elsewhere? Start RoninFlow with MT_COMMON_DIR set to MetaTrader’s Common\\Files folder.',
        'MetaTrader on a separate Windows PC can’t send to a journal on another computer (it passes trades through a file). Run RoninFlow on that PC too, or use File import.',
        'MetaTrader 4 only shares the history in its Account History tab — right-click there and pick All History so older trades come in.',
      ],
    } },
  { id: 'ctrader', name: 'cTrader', group: 'live', status: 'ready', blurb: 'cBot that sends every closed trade and the account balance.',
    setup: [
      ['Copy the cBot', `${ADDON_WIN('cTrader', 'npm run addon:ctrader')} It puts the cBot’s code on your clipboard (or open ctrader-addon\\TradeJournalSync.cs and copy it).`],
      ['Create it in cTrader', 'cTrader 5 or newer: Algo → cBots → New, name it TradeJournalSync, select all the template code and paste over it, then Build (Ctrl+B).'],
      ['Start it', 'Add an instance on any symbol and press Start. The log shows “[RoninFlow] started”; this card turns green within 30 seconds.'],
      ['Trade', 'Closed trades reach the journal within seconds. A partial close is its own trade with its own P&L.'],
    ],
    notes: [
      'Run one instance per account you want synced. It never places, changes or closes orders.',
      'It sends to the journal over the network and also saves the same trades in Documents\\cAlgo\\Data\\cBots, which the journal on this PC reads — so trades still arrive if cTrader blocks the web request.',
      'Journal on another computer? In the instance parameters set Journal address to its address + /api/connect/ingest and paste the token from Token & endpoint.',
      'P&L is cTrader’s net profit (after commission and swap). The last 30 days are sent when it starts.',
    ],
    unix: {
      setup: [
        ['Where cTrader runs', 'Use cTrader on a Windows PC, or cTrader for Mac if your version has the Algo section (cBots). The cBot sends trades over the network, so it can be on this computer or another one.'],
        ['Copy the cBot’s code', `Open TradeJournalSync.cs (${ADDON_FILE('ctrader-addon')}) and copy all of it.`],
        ['Create it in cTrader', 'Algo → cBots → New, name it TradeJournalSync, select all the template code and paste over it, then Build.'],
        ['Start it, pointed at this journal', 'Add an instance on any symbol. Same computer: leave Journal address as it is. Another computer: turn on network access here (Settings → Security & privacy), set Journal address to http://<this computer’s address>:5173/api/connect/ingest and paste the token from Token & endpoint. Press Start — this card turns green within 30 seconds.'],
      ],
      notes: [
        'Run one instance per account you want synced. It never places, changes or closes orders.',
        VM_NOTE,
        'The last 30 days are sent when it starts, so nothing is lost if this computer was off.',
      ],
    } },
  // direct APIs
  { id: 'ibkr', name: 'Interactive Brokers', group: 'api', status: 'ready', blurb: 'Flex Web Service — free and read-only. Checks every 30 minutes.',
    fields: [
      { key: 'token', label: 'Flex Web Service token', secret: true, placeholder: 'e.g. 12345678901234567890' },
      { key: 'queryId', label: 'Flex Query ID', placeholder: 'e.g. 987654' },
      { key: 'tz', label: 'Time zone of the report', placeholder: 'America/New_York', help: 'Leave as is unless you changed the time zone in the query’s settings.' },
    ],
    setup: [
      ['Create a Flex Query', 'Client Portal → Performance & Reports → Flex Queries → Activity Flex Query “+”. Name it, tick the Trades section and choose Executions (select all fields). Format XML, Period “Last 30 Calendar Days”. Save and note the Query ID.'],
      ['Get a token', 'On the same page open Flex Web Service Configuration, enable it and generate a token (pick the longest validity).'],
      ['Connect', 'Paste both below and press Connect. IBKR can take a minute to build the first statement.'],
    ],
    notes: ['Flex statements update after each trade with a short delay, so trades show up within ~30–60 minutes — not instantly.', 'The token expires after the validity you chose; generate a new one and paste it here when that happens.'] },
  { id: 'projectx', name: 'TopstepX / ProjectX', group: 'api', status: 'ready', blurb: 'ProjectX API key (subscription from the firm). Checks every minute.',
    fields: [
      { key: 'userName', label: 'Username', placeholder: 'your TopstepX login' },
      { key: 'apiKey', label: 'API key', secret: true },
      { key: 'baseUrl', label: 'API address (other ProjectX firms)', placeholder: 'https://api.topstepx.com', help: 'Only change this for another firm on ProjectX — use the API address they give you.' },
    ],
    setup: [
      ['Get API access', 'In TopstepX: Settings → API. Subscribe to ProjectX API access and generate an API key.'],
      ['Connect', 'Enter your username and the key below and press Connect. The last 30 days of trades come in first.'],
    ],
    notes: ['Every account on the login is synced, with its balance. Accounts are named as in TopstepX.', 'Read-only: the journal only searches accounts and trades — it never places orders.'] },
  { id: 'tradovate', name: 'Tradovate', group: 'api', status: 'ready', blurb: 'Tradovate API (needs a funded account and their API access add-on). Checks every minute.',
    fields: [
      { key: 'env', label: 'Environment', options: [{ value: 'live', label: 'Live' }, { value: 'demo', label: 'Demo / sim' }] },
      { key: 'name', label: 'Username' },
      { key: 'password', label: 'Password', secret: true },
      { key: 'cid', label: 'API key ID (cid)', placeholder: 'number' },
      { key: 'sec', label: 'API secret (sec)', secret: true },
      { key: 'appId', label: 'App name (optional)', placeholder: 'TradeJournal' },
    ],
    setup: [
      ['Turn on API access', 'In Tradovate: Application Settings → API Access. Subscribe to the API add-on, then generate an API key — copy the key ID (cid) and the secret (sec) right away.'],
      ['Connect', 'Pick live or demo, enter your login and the key below and press Connect.'],
    ],
    notes: ['Tradovate’s API lists recent fills, so trades come in from about the day you connect — import older history with the Tradovate file import.', 'Prop-firm accounts that run on Tradovate usually can’t get API keys — use the NinjaTrader add-on or the Tradovate file import for those.', 'If a login fails, syncing pauses so Tradovate doesn’t lock you out for repeated attempts.', 'Fills are paired into trades per account and contract.'] },
  { id: 'alpaca', name: 'Alpaca', group: 'api', status: 'ready', blurb: 'Stocks, options and crypto fills with your API key. Checks every minute.',
    fields: [
      { key: 'env', label: 'Account', options: [{ value: 'paper', label: 'Paper' }, { value: 'live', label: 'Live' }] },
      { key: 'keyId', label: 'API key ID' },
      { key: 'secretKey', label: 'Secret key', secret: true },
    ],
    setup: [['Create an API key', 'Alpaca dashboard → (Paper or Live) → API Keys → Generate. Paper and live keys are separate — pick the matching account below.'], ['Connect', 'Paste the key ID and secret and press Connect. The last 90 days come in first.']],
    notes: ['Option contracts use the 100× multiplier. Crypto pairs are treated as spot (no shorts).', 'Alpaca charges no commission, so fees show as 0 (regulatory fees aren’t in the fill data).'] },
  { id: 'oanda', name: 'OANDA', group: 'api', status: 'ready', blurb: 'Forex & CFD closed trades with an API token. Checks every minute.',
    fields: [
      { key: 'env', label: 'Account', options: [{ value: 'live', label: 'Live (fxTrade)' }, { value: 'practice', label: 'Practice (demo)' }] },
      { key: 'token', label: 'Personal access token', secret: true },
      { key: 'accountId', label: 'Account ID(s) (optional)', placeholder: 'all accounts', help: 'Leave empty to sync every account on the token, or list some: 001-001-1234567-001' },
    ],
    setup: [['Generate a token', 'OANDA hub → My Account → Manage API Access → Generate (practice and live tokens are separate).'], ['Connect', 'Paste the token and press Connect.']],
    notes: ['Each closed OANDA trade becomes one journal trade; P&L includes financing (swap). Size is in units (10,000 = 0.1 lot).', 'Partly closed trades come in once they’re fully closed.'] },
  { id: 'tastytrade', name: 'tastytrade', group: 'api', status: 'ready', blurb: 'Stocks, options and futures via tastytrade’s OAuth API. Checks every 2 minutes.',
    fields: [
      { key: 'clientSecret', label: 'Client secret', secret: true },
      { key: 'refreshToken', label: 'Refresh token', secret: true },
    ],
    setup: [
      ['Create an OAuth app', 'my.tastytrade.com → Manage → My Profile → API → OAuth Applications → create one (any name; scopes: read). Copy the client secret — it’s shown once.'],
      ['Create a grant', 'Click Manage on the app → Create Grant. Copy the refresh token it shows (it doesn’t expire).'],
      ['Connect', 'Paste both below and press Connect.'],
    ],
    notes: ['Equity options use the 100× multiplier and futures use the contract’s point value; futures options are flagged so you can set the multiplier.', 'Fees include commission, clearing and regulatory fees.'] },
  { id: 'schwab', name: 'Charles Schwab', group: 'api', status: 'ready', blurb: 'Stocks, options and futures via Schwab’s Trader API (sign in again weekly). Checks every 2 minutes.',
    authorize: (f) => `https://api.schwabapi.com/v1/oauth/authorize?client_id=${encodeURIComponent(f.appKey || '')}&redirect_uri=${encodeURIComponent(f.callbackUrl || 'https://127.0.0.1')}`,
    fields: [
      { key: 'appKey', label: 'App key' },
      { key: 'appSecret', label: 'Secret', secret: true },
      { key: 'callbackUrl', label: 'Callback URL', placeholder: 'https://127.0.0.1', help: 'Exactly as entered in your Schwab app.' },
      { key: '_signin', signin: true, label: 'Sign in', need: ['appKey'] },
      { key: 'redirectUrl', label: 'Address after signing in', wide: true, placeholder: 'https://127.0.0.1/?code=…', help: 'After you approve, the browser goes to your callback address (the page won’t load — that’s expected). Copy the whole address from the address bar, paste it here and press Connect within 30 seconds.' },
    ],
    setup: [
      ['Create a Schwab app (once)', 'developer.schwab.com → sign up → Dashboard → Create App → API product “Accounts and Trading Production”, callback URL https://127.0.0.1. Wait until its status is “Ready For Use” (Schwab approves it, usually within a few days), then copy the App Key and Secret.'],
      ['Open the Schwab sign-in', 'Enter the key, secret and callback below, then use “Open Schwab sign-in”. Log in with your normal Schwab login and tick the accounts to share.'],
      ['Paste the address and connect', 'Copy the address the browser lands on, paste it below and press Connect straight away (the code expires in ~30 seconds).'],
    ],
    notes: ['Schwab makes everyone sign in again every 7 days. When it lapses this card shows “Paused” — repeat steps 2–3 (takes a minute); nothing is lost.', 'Options use the 100× multiplier, futures their contract point value. Fees include commission and regulatory fees.'] },
  { id: 'tradestation', name: 'TradeStation', group: 'api', status: 'ready', blurb: 'Stocks, options and futures via TradeStation’s API. Checks every 2 minutes.',
    authorize: (f) => `https://signin.tradestation.com/authorize?response_type=code&client_id=${encodeURIComponent(f.apiKey || '')}&audience=${encodeURIComponent('https://api.tradestation.com')}&redirect_uri=${encodeURIComponent(f.callbackUrl || 'http://localhost:3000')}&scope=${encodeURIComponent('openid offline_access profile ReadAccount')}&state=tradejournal`,
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'API secret', secret: true },
      { key: 'callbackUrl', label: 'Callback URL', placeholder: 'http://localhost:3000', help: 'Leave the default unless TradeStation set up a different one for your key.' },
      { key: '_signin', signin: true, label: 'Sign in', need: ['apiKey'] },
      { key: 'redirectUrl', label: 'Address after signing in', wide: true, placeholder: 'http://localhost:3000/?code=…', help: 'After you approve, the browser goes to localhost (the page won’t load — that’s expected). Copy the whole address, paste it here and press Connect.' },
    ],
    setup: [
      ['Get an API key (once)', 'TradeStation issues API keys on request: TradeStation Client Center → request API access (or email ClientExperience@tradestation.com asking for an API key for personal use).'],
      ['Open the TradeStation sign-in', 'Enter the key and secret below, then use “Open TradeStation sign-in” and log in.'],
      ['Paste the address and connect', 'Copy the address the browser lands on, paste it below and press Connect.'],
    ],
    notes: ['You only sign in once — TradeStation’s refresh tokens don’t expire unless your key was set up to rotate them.', 'Fills are taken per order (average fill price at the order’s close time). The last 90 days come in first.'] },
  // crypto
  { id: 'bybit', name: 'Bybit', group: 'crypto', status: 'ready', blurb: 'USDT/USDC perpetuals and spot. Checks every 2 minutes.',
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'API secret', secret: true },
      { key: 'baseUrl', label: 'API address (regional sites)', placeholder: 'https://api.bybit.com', help: 'Only change for a regional Bybit (e.g. https://api.bybit.eu, https://api.bybit.tr).' },
    ],
    setup: [['Create a read-only key', 'Bybit → Account → API → Create New Key → System-generated → permissions: Read-Only. (IP restriction is optional.)'], ['Connect', 'Paste the key and secret and press Connect. The last 30 days come in first.']],
    notes: ['Unified Trading accounts also show the wallet balance. Inverse (coin-margined) contracts aren’t included.', 'Hedge mode (long and short at once on one symbol) isn’t supported — one-way mode is.'] },
  { id: 'binance', name: 'Binance', group: 'crypto', status: 'ready', blurb: 'USDT-M futures, plus the spot pairs you list. Checks every 3 minutes.',
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'Secret key', secret: true },
      { key: 'spotSymbols', label: 'Spot pairs (optional)', placeholder: 'BTCUSDT, ETHUSDT', help: 'Binance can’t list which spot pairs you traded — name them here to include spot.' },
    ],
    setup: [['Create a read-only key', 'Binance → Account → API Management → Create API → System generated. Leave only “Enable Reading” ticked.'], ['Connect', 'Paste the key and secret and press Connect. The last 30 days come in first (Binance keeps 3 months).']],
    notes: ['Futures symbols are found automatically. Hedge-mode long and short positions are kept separate.', 'Fees paid in BNB aren’t converted to dollars (they show as 0).', 'Binance.US isn’t supported yet.'] },
  { id: 'okx', name: 'OKX', group: 'crypto', status: 'ready', blurb: 'Closed perpetual / futures positions with P&L. Checks every 2 minutes.',
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'Secret key', secret: true },
      { key: 'passphrase', label: 'Passphrase', secret: true },
      { key: 'baseUrl', label: 'API address (regional sites)', placeholder: 'https://www.okx.com', help: 'EEA accounts: https://my.okx.com · US: https://us.okx.com' },
    ],
    setup: [['Create a read-only key', 'OKX → Profile → API → Create API key → permission: Read. Note the passphrase you choose.'], ['Connect', 'Paste the key, secret and passphrase and press Connect. Up to 3 months come in first.']],
    notes: ['Each closed position is one trade with OKX’s realized P&L (after fees and funding). Size is in contracts.', 'Coin-margined positions and spot trades aren’t included yet.'] },
  { id: 'hyperliquid', name: 'Hyperliquid', group: 'crypto', status: 'ready', blurb: 'Perpetuals from your wallet address — no API key needed. Checks every minute.',
    fields: [{ key: 'address', label: 'Wallet address', placeholder: '0x…' }],
    setup: [['Copy your address', 'The 0x… address you trade with on Hyperliquid (the master account, not an API wallet).'], ['Connect', 'Paste it and press Connect. Up to 90 days (Hyperliquid keeps your latest 10,000 fills).']],
    notes: ['Hyperliquid data is public, so only the address is needed and nothing secret is stored.', 'Spot trades aren’t included yet.'] },
  { id: 'coinbase', name: 'Coinbase', group: 'crypto', status: 'ready', blurb: 'Coinbase Advanced spot (and derivatives) fills. Checks every 2 minutes.',
    fields: [
      { key: 'keyName', label: 'API key name', placeholder: 'organizations/…/apiKeys/…' },
      { key: 'privateKey', label: 'Private key', secret: true, multiline: true, placeholder: '-----BEGIN EC PRIVATE KEY-----…' },
    ],
    setup: [['Create an API key', 'portal.cdp.coinbase.com → API Keys → Create API key → Advanced Trade, permission View, signature algorithm ECDSA (not Ed25519). Download the key file.'], ['Connect', 'Paste the key name and the whole private key (with the BEGIN/END lines) and press Connect.']],
    notes: ['Spot fills are paired buy → sell; coins bought before the last 90 days aren’t matched, so their sales are skipped.', 'Derivatives other than INTX perpetuals are flagged so you can set the contract multiplier.'] },
  { id: 'kraken', name: 'Kraken', group: 'crypto', status: 'ready', blurb: 'Spot and margin trades. Checks every 5 minutes.',
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'Private key', secret: true },
    ],
    setup: [['Create a key', 'Kraken → Settings → API → Create API key → permission “Query closed orders & trades” only.'], ['Connect', 'Paste the key and private key and press Connect. The first import of a long history is slow — Kraken limits how fast it can be read.']],
    notes: ['Spot fills are paired buy → sell; margin trades can be short. Kraken Futures isn’t included yet.'] },
  { id: 'bitget', name: 'Bitget', group: 'crypto', status: 'ready', blurb: 'Closed USDT/USDC futures positions with P&L. Checks every 2 minutes.',
    fields: [
      { key: 'apiKey', label: 'API key' },
      { key: 'apiSecret', label: 'Secret key', secret: true },
      { key: 'passphrase', label: 'Passphrase', secret: true },
    ],
    setup: [['Create a read-only key', 'Bitget → Profile → API Management → Create API → System-generated → permissions: Read-only. Note the passphrase you choose.'], ['Connect', 'Paste the key, secret and passphrase and press Connect. Up to 90 days come in first.']],
    notes: ['Works with classic and Unified Trading accounts. Each closed position is one trade with Bitget’s net profit (after fees and funding).', 'Coin-margined futures and spot trades aren’t included yet.'] },
  // webhook
  { id: 'webhook', name: 'Webhook / API', group: 'webhook', status: 'ready', blurb: 'POST fills or trades as JSON with your token.' },
  // file imports
  { id: 'file-atas', name: 'ATAS statistics', group: 'file', status: 'ready', blurb: 'Statistics → export (.xlsx) with Journal + Executions.', steps: ['Open Statistics from the ATAS main window.', 'Click History, choose the date range and all accounts, then Load.', 'Go to the Executions tab → gear icon → Export Statistics.', 'Drop the saved file here.'] },
  { id: 'file-tradingview', name: 'TradingView', group: 'file', status: 'ready', blurb: 'Trading Panel history (filled orders are paired into trades).', steps: ['Open the Trading Panel under your chart and go to the History tab.', 'Use the export / download button to save the history as CSV.', 'Drop the CSV here — cancelled orders are ignored.'] },
  { id: 'file-deepcharts', name: 'DeepCharts', group: 'file', status: 'ready', blurb: 'Strategy Report → Trade List (semicolon CSV).', steps: ['In DeepCharts open Trading → Strategy Report.', 'Choose the broker, account, dates and symbols, then generate the report.', 'In the Trade List section export the list as CSV and drop it here.'] },
  { id: 'file-ninjatrader', name: 'NinjaTrader 8', group: 'file', status: 'ready', blurb: 'Trade Performance → Executions or Trades export.', steps: ['Control Center → New → Trade Performance, pick the account and dates, Generate.', 'Open the Executions (or Trades) tab, right-click → Export, save as CSV.', 'Drop the CSV here.'] },
  { id: 'file-tradovate', name: 'Tradovate', group: 'file', status: 'ready', blurb: 'Account Reports → Performance CSV.', steps: ['In Tradovate open Account Reports → Performance.', 'Pick the dates and download the CSV.', 'Drop the CSV here.'] },
  { id: 'file-rithmic', name: 'R | Trader Pro (Rithmic)', group: 'file', status: 'ready', blurb: 'Order history export (filled orders are paired into trades).', steps: ['Open the order history (Recent Orders) window in R | Trader Pro.', 'Export it to CSV.', 'Drop the CSV here — only filled orders are used.'] },
  { id: 'file-topstepx', name: 'TopstepX', group: 'file', status: 'ready', blurb: 'Trades / orders export from the platform.', steps: ['In TopstepX open the Trades (or Orders) tab for the account.', 'Export it to CSV.', 'Drop the CSV here.'] },
  { id: 'file-generic', name: 'Any CSV / Excel', group: 'file', status: 'ready', blurb: 'Fills or closed trades from anywhere — map the columns if needed.', steps: ['Export executions or closed trades from your platform as CSV or .xlsx.', 'Drop it here; check the column mapping if the preview looks off.'] },
];

const NAMES = { atas: 'ATAS', webhook: 'Webhook' };
/** Display name for a source id (connector inbox sources are free-form, e.g. "ninjatrader", "my-bot"). */
export function platformName(source) {
  const c = CONNECTORS.find((x) => x.id === source);
  if (c) return c.name;
  if (NAMES[source]) return NAMES[source];
  return String(source || 'Webhook').replace(/[-_.]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
