// RoninFlow HUD — one indicator with four parts, each switched on or off and placed in its settings:
//   * Account panel: the chart's account — its RoninFlow risk tier, the gamma regime, today's P&L, the buffer to the
//     daily loss limit (with the trailing stop and the day's high), trade stats and the index's GEX.
//   * Gamma levels: call wall, put wall, zero gamma (the flip) and the biggest other strikes, as lines or zones, in
//     this market's futures prices, with optional regime shading, labels and price-axis tags.
//   * News feed: today's economic events (with countdowns) and live headlines from RoninFlow's News Flow, tagged with
//     the markets they move; collapsible with a click on its header.
//   * News pop-ups: new headlines, events a few minutes out and releases (actual / forecast / previous), wherever
//     you choose — with a preview switch that shows one where they'll appear.
// Plus markers for today's events on the time axis. Everything comes from RoninFlow in one request every few seconds
// (GET /api/atas/hud); the account numbers come from ATAS itself.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

using ATAS.DataFeedsCore;
using ATAS.DataFeedsCore.Statistics;
using ATAS.Indicators;

using OFT.Rendering;
using OFT.Rendering.Context;
using OFT.Rendering.Control;
using OFT.Rendering.Tools;

namespace TradeJournal
{
    [DisplayName("RoninFlow HUD")]
    [Description("RoninFlow on your chart: account panel with risk tier and gamma regime, gamma levels, the news feed and news pop-ups. Each part can be switched on or off and placed in the settings.")]
    public class RoninFlowHud : Indicator
    {
        public enum Placement { TopLeft, TopCenter, TopRight, MiddleLeft, Center, MiddleRight, BottomLeft, BottomCenter, BottomRight }
        public enum GammaDrawing { Lines, Zones }
        public enum LabelSide { Left, Middle, Right }
        public enum NewsLevel { AllNews, ImportantOnly, HighImpactOnly }
        public enum EventLevel { AllEvents, MediumAndHigh, HighOnly }

        // ---------- data from RoninFlow ----------
        private sealed class Tag { public string M = ""; public int Dir; }
        private sealed class NewsItem { public string Id = "", Title = "", Src = ""; public long T; public int Importance, Dir; public List<Tag> Tags = new(); }
        private sealed class EventItem { public string Id = "", Title = "", Ccy = "", Impact = "", Actual = "", Forecast = "", Previous = ""; public long T; }
        private sealed class Level { public decimal Price; public string Kind = ""; }
        private sealed class Gex { public string Index = "", Zone = "", Error = ""; public decimal Total; public decimal? Flip, CallWall, PutWall; public List<Level> Pos = new(), Neg = new(); public bool Delayed; public long At; }
        private sealed class AccountInfo { public string TierName = "", TierColor = ""; public int Level, Of; public decimal DailyLoss, Trail; public int MaxTrades; public bool Enforced, Enforcing, Blocked, Windowed, InWindow = true; public string Reason = ""; public int? WindowMin; }
        private sealed class Snapshot { public long DayStartUtc; public string Market = ""; public AccountInfo? Account; public Gex? Gex; public List<EventItem> Events = new(); public List<NewsItem> News = new(); public string Error = ""; public DateTime At; }
        private sealed class DayStats { public decimal Realised, Peak, AvgWin, AvgLoss, Best, Worst, GrossWin, GrossLoss; public int Trades, Wins, Losses; }
        private sealed class Popup { public string Key = "", Kind = "news", Meta = "", Title = "", Impact = ""; public List<Tag> Tags = new(); public string[]? Nums; public DateTime Shown; }

        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };

        private volatile Snapshot? _snap;
        private volatile DayStats _day = new();
        private readonly object _popLock = new();
        private readonly List<Popup> _popups = new();
        private readonly HashSet<string> _seen = new();
        private bool _primed;
        private CancellationTokenSource? _cts;
        private bool _newsCollapsed;
        private bool _statsCollapsed;
        private bool _collapseInit;
        private Rectangle _statsRect = Rectangle.Empty;
        private float _k = 1f; // the account panel's size while it's drawn (chip padding follows it)
        private string _aKey = "";
        private RenderFont _aFont = new("Consolas", 9), _aBold = new("Consolas", 9, FontStyle.Bold), _aSmall = new("Consolas", 8), _aBig = new("Consolas", 11, FontStyle.Bold);
        private Rectangle _newsHeader = Rectangle.Empty;
        private readonly List<(Rectangle Box, string Key)> _closeBoxes = new();

        private RenderFont _font = new("Consolas", 9);
        private RenderFont _bold = new("Consolas", 9, FontStyle.Bold);
        private RenderFont _small = new("Consolas", 8);
        private RenderFont _big = new("Consolas", 11, FontStyle.Bold);
        private string _fontName = "Consolas";
        private float _fontSize = 9;

        #region Settings — connection

        [Display(Name = "RoninFlow address", GroupName = "1. Connection", Order = 10)]
        public string JournalUrl { get; set; } = "http://localhost:5173";

        [Display(Name = "Token (RoninFlow on another computer only)", GroupName = "1. Connection", Order = 11)]
        public string Token { get; set; } = "";

        #endregion

        #region Settings — account panel

        [Display(Name = "Show the account panel", GroupName = "2. Account panel", Order = 20)]
        public bool ShowAccount { get; set; } = true;

        [Display(Name = "Placement", GroupName = "2. Account panel", Order = 21)]
        public Placement AccountPlacement { get; set; } = Placement.TopRight;

        [Display(Name = "X offset", GroupName = "2. Account panel", Order = 22)]
        [Range(-3000, 3000)]
        public int AccountX { get; set; } = 16;

        [Display(Name = "Y offset", GroupName = "2. Account panel", Order = 23)]
        [Range(-3000, 3000)]
        public int AccountY { get; set; } = 16;

        [Display(Name = "Width", GroupName = "2. Account panel", Order = 24)]
        [Range(220, 700)]
        public int AccountWidth { get; set; } = 330;

        [Display(Name = "Size (%)", GroupName = "2. Account panel", Order = 24)]
        [Range(50, 250)]
        public int AccountScale { get; set; } = 100;

        [Display(Name = "Shrink to fit narrow charts", GroupName = "2. Account panel", Order = 24)]
        public bool AccountFit { get; set; } = true;

        [Display(Name = "Start with the stats collapsed", GroupName = "2. Account panel", Order = 29)]
        public bool StatsStartCollapsed { get; set; } = false;

        [Display(Name = "Risk tier chip", GroupName = "2. Account panel", Order = 25)]
        public bool ShowTierChip { get; set; } = true;

        [Display(Name = "Gamma regime chip", GroupName = "2. Account panel", Order = 26)]
        public bool ShowGammaChip { get; set; } = true;

        [Display(Name = "P&L tiles", GroupName = "2. Account panel", Order = 27)]
        public bool ShowPnlTiles { get; set; } = true;

        [Display(Name = "Buffer to daily loss limit", GroupName = "2. Account panel", Order = 28)]
        public bool ShowBuffer { get; set; } = true;

        [Display(Name = "Trade stats", GroupName = "2. Account panel", Order = 29)]
        public bool ShowStats { get; set; } = true;

        [Display(Name = "GEX line", GroupName = "2. Account panel", Order = 30)]
        public bool ShowGexLine { get; set; } = true;

        [Display(Name = "\"At the flip\" within (points)", GroupName = "2. Account panel", Order = 31)]
        [Range(0, 1000)]
        public decimal FlipNear { get; set; } = 10m;

        #endregion

        #region Settings — gamma levels

        [Display(Name = "Show gamma levels", GroupName = "3. Gamma levels", Order = 40)]
        public bool ShowGamma { get; set; } = true;

        [Display(Name = "Draw as", GroupName = "3. Gamma levels", Order = 41)]
        public GammaDrawing GammaStyle { get; set; } = GammaDrawing.Lines;

        [Display(Name = "Zone width (points)", GroupName = "3. Gamma levels", Order = 42)]
        [Range(0.25, 500)]
        public decimal ZoneWidth { get; set; } = 6m;

        [Display(Name = "Zone opacity (%)", GroupName = "3. Gamma levels", Order = 43)]
        [Range(3, 100)]
        public int ZoneOpacity { get; set; } = 18;

        [Display(Name = "Line width", GroupName = "3. Gamma levels", Order = 44)]
        [Range(1, 6)]
        public int LineWidth { get; set; } = 2;

        [Display(Name = "Call wall", GroupName = "3. Gamma levels", Order = 45)]
        public bool ShowCallWall { get; set; } = true;

        [Display(Name = "Put wall", GroupName = "3. Gamma levels", Order = 46)]
        public bool ShowPutWall { get; set; } = true;

        [Display(Name = "Zero gamma (flip)", GroupName = "3. Gamma levels", Order = 47)]
        public bool ShowFlip { get; set; } = true;

        [Display(Name = "Other big strikes (+GEX / −GEX)", GroupName = "3. Gamma levels", Order = 48)]
        public bool ShowMajors { get; set; } = true;

        [Display(Name = "Shade the regime (above / below the flip)", GroupName = "3. Gamma levels", Order = 49)]
        public bool ShowShading { get; set; } = true;

        [Display(Name = "Level names on the chart", GroupName = "3. Gamma levels", Order = 50)]
        public bool ShowLevelNames { get; set; } = true;

        [Display(Name = "Level names: where", GroupName = "3. Gamma levels", Order = 50)]
        public LabelSide LevelNameSide { get; set; } = LabelSide.Left;

        [Display(Name = "Level names: X offset", GroupName = "3. Gamma levels", Order = 50)]
        [Range(-2000, 2000)]
        public int LevelNameX { get; set; } = 8;

        [Display(Name = "Price tags on the price axis", GroupName = "3. Gamma levels", Order = 51)]
        public bool ShowAxisTags { get; set; } = true;

        [Display(Name = "Call wall colour", GroupName = "3. Gamma levels", Order = 52)]
        public Color CallWallColor { get; set; } = Color.FromArgb(255, 43, 196, 138);

        [Display(Name = "Put wall colour", GroupName = "3. Gamma levels", Order = 53)]
        public Color PutWallColor { get; set; } = Color.FromArgb(255, 229, 72, 77);

        [Display(Name = "Flip colour", GroupName = "3. Gamma levels", Order = 54)]
        public Color FlipColor { get; set; } = Color.FromArgb(255, 232, 176, 67);

        [Display(Name = "+GEX strike colour", GroupName = "3. Gamma levels", Order = 55)]
        public Color PosGexColor { get; set; } = Color.FromArgb(160, 43, 196, 138);

        [Display(Name = "−GEX strike colour", GroupName = "3. Gamma levels", Order = 56)]
        public Color NegGexColor { get; set; } = Color.FromArgb(160, 229, 72, 77);

        #endregion

        #region Settings — news feed

        [Display(Name = "Show the news feed", GroupName = "4. News feed", Order = 60)]
        public bool ShowNews { get; set; } = true;

        [Display(Name = "Placement", GroupName = "4. News feed", Order = 61)]
        public Placement NewsPlacement { get; set; } = Placement.BottomLeft;

        [Display(Name = "X offset", GroupName = "4. News feed", Order = 62)]
        [Range(-3000, 3000)]
        public int NewsX { get; set; } = 16;

        [Display(Name = "Y offset", GroupName = "4. News feed", Order = 63)]
        [Range(-3000, 3000)]
        public int NewsY { get; set; } = 40;

        [Display(Name = "Width", GroupName = "4. News feed", Order = 64)]
        [Range(240, 800)]
        public int NewsWidth { get; set; } = 380;

        [Display(Name = "Start collapsed", GroupName = "4. News feed", Order = 65)]
        public bool NewsStartCollapsed { get; set; } = false;

        [Display(Name = "Headlines shown", GroupName = "4. News feed", Order = 66)]
        [Range(0, 30)]
        public int NewsLines { get; set; } = 6;

        [Display(Name = "Today's events", GroupName = "4. News feed", Order = 67)]
        public bool ShowEvents { get; set; } = true;

        [Display(Name = "Events shown", GroupName = "4. News feed", Order = 68)]
        public EventLevel EventFilter { get; set; } = EventLevel.MediumAndHigh;

        [Display(Name = "Headlines shown", GroupName = "4. News feed", Order = 69)]
        public NewsLevel NewsFilter { get; set; } = NewsLevel.AllNews;

        [Display(Name = "Only news that moves this market", GroupName = "4. News feed", Order = 70)]
        public bool OnlyThisMarket { get; set; } = false;

        #endregion

        #region Settings — pop-ups

        [Display(Name = "Show news pop-ups", GroupName = "5. News pop-ups", Order = 80)]
        public bool ShowPopups { get; set; } = true;

        [Display(Name = "Where they pop up", GroupName = "5. News pop-ups", Order = 81)]
        public Placement PopupPlacement { get; set; } = Placement.TopCenter;

        [Display(Name = "X offset", GroupName = "5. News pop-ups", Order = 82)]
        [Range(-3000, 3000)]
        public int PopupX { get; set; } = 0;

        [Display(Name = "Y offset", GroupName = "5. News pop-ups", Order = 83)]
        [Range(-3000, 3000)]
        public int PopupY { get; set; } = 16;

        [Display(Name = "Preview: show a sample where they pop up", GroupName = "5. News pop-ups", Order = 84)]
        public bool PreviewPopup { get; set; } = false;

        [Display(Name = "Seconds on screen", GroupName = "5. News pop-ups", Order = 85)]
        [Range(3, 120)]
        public int PopupSeconds { get; set; } = 12;

        [Display(Name = "Headlines that pop up", GroupName = "5. News pop-ups", Order = 86)]
        public NewsLevel PopupFilter { get; set; } = NewsLevel.ImportantOnly;

        [Display(Name = "Only news that moves this market", GroupName = "5. News pop-ups", Order = 87)]
        public bool PopupThisMarket { get; set; } = true;

        [Display(Name = "Warn before events (minutes, 0 = off)", GroupName = "5. News pop-ups", Order = 88)]
        [Range(0, 120)]
        public int EventWarnMinutes { get; set; } = 5;

        [Display(Name = "Pop up releases (actual vs forecast)", GroupName = "5. News pop-ups", Order = 89)]
        public bool PopupReleases { get; set; } = true;

        [Display(Name = "Events that pop up", GroupName = "5. News pop-ups", Order = 90)]
        public EventLevel PopupEventFilter { get; set; } = EventLevel.MediumAndHigh;

        [Display(Name = "Pop-up width", GroupName = "5. News pop-ups", Order = 91)]
        [Range(240, 800)]
        public int PopupWidth { get; set; } = 400;

        #endregion

        #region Settings — event markers

        [Display(Name = "Mark today's events on the time axis", GroupName = "6. Event markers", Order = 100)]
        public bool ShowMarkers { get; set; } = true;

        [Display(Name = "Events marked", GroupName = "6. Event markers", Order = 101)]
        public EventLevel MarkerFilter { get; set; } = EventLevel.AllEvents;

        [Display(Name = "Dashed line up the chart", GroupName = "6. Event markers", Order = 102)]
        public bool MarkerLines { get; set; } = true;

        #endregion

        #region Settings — colours

        [Display(Name = "Panel background", GroupName = "7. Colours and text", Order = 120)]
        public Color Background { get; set; } = Color.FromArgb(235, 10, 10, 10);

        [Display(Name = "Panel border", GroupName = "7. Colours and text", Order = 121)]
        public Color BorderColor { get; set; } = Color.FromArgb(255, 42, 42, 42);

        [Display(Name = "Tile background", GroupName = "7. Colours and text", Order = 122)]
        public Color TileColor { get; set; } = Color.FromArgb(255, 15, 15, 15);

        [Display(Name = "Text", GroupName = "7. Colours and text", Order = 123)]
        public Color TextColor { get; set; } = Color.FromArgb(255, 244, 244, 245);

        [Display(Name = "Muted text", GroupName = "7. Colours and text", Order = 124)]
        public Color MutedColor { get; set; } = Color.FromArgb(255, 139, 139, 143);

        [Display(Name = "Accent", GroupName = "7. Colours and text", Order = 125)]
        public Color AccentColor { get; set; } = Color.FromArgb(255, 139, 109, 255);

        [Display(Name = "Positive", GroupName = "7. Colours and text", Order = 126)]
        public Color PositiveColor { get; set; } = Color.FromArgb(255, 43, 196, 138);

        [Display(Name = "Negative", GroupName = "7. Colours and text", Order = 127)]
        public Color NegativeColor { get; set; } = Color.FromArgb(255, 229, 72, 77);

        [Display(Name = "Warning", GroupName = "7. Colours and text", Order = 128)]
        public Color WarningColor { get; set; } = Color.FromArgb(255, 232, 176, 67);

        [Display(Name = "Font", GroupName = "7. Colours and text", Order = 129)]
        public string FontName { get; set; } = "Consolas";

        [Display(Name = "Font size", GroupName = "7. Colours and text", Order = 130)]
        [Range(6, 24)]
        public float FontSize { get; set; } = 9;

        [Display(Name = "Corner radius", GroupName = "7. Colours and text", Order = 131)]
        [Range(0, 16)]
        public int Radius { get; set; } = 6;

        #endregion

        public RoninFlowHud() : base(true)
        {
            DenyToChangePanel = true;
            EnableCustomDrawing = true;
            SubscribeToDrawingEvents(DrawingLayouts.Final);
            DrawAbovePrice = true;
            DataSeries[0].IsHidden = true;
            ((ValueDataSeries)DataSeries[0]).VisualType = VisualMode.Hide;
        }

        protected override void OnInitialize()
        {
            _cts?.Cancel();
            _cts = new CancellationTokenSource();
            var token = _cts.Token;
            Task.Run(() => Loop(token), token);
            SubscribeToTimer(TimeSpan.FromSeconds(1), Tick);
        }

        protected override void OnDispose()
        {
            _cts?.Cancel();
            try { UnsubscribeFromTimer(TimeSpan.FromSeconds(1), Tick); }
            catch { }
        }

        protected override void OnCalculate(int bar, decimal value)
        {
        }

        private void Tick()
        {
            // countdowns, pop-up timers
            lock (_popLock)
                _popups.RemoveAll(p => (DateTime.UtcNow - p.Shown).TotalSeconds > PopupSeconds);
            RedrawChart();
        }

        // ---------- fetching ----------

        private async Task Loop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await Fetch(token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception e)
                {
                    var s = _snap;
                    _snap = new Snapshot { Error = e.Message, At = DateTime.UtcNow, DayStartUtc = s?.DayStartUtc ?? 0, Market = s?.Market ?? "", Account = s?.Account, Gex = s?.Gex, Events = s?.Events ?? new(), News = s?.News ?? new() };
                }
                try { ComputeDay(); }
                catch { }
                try { await Task.Delay(3000, token); }
                catch (OperationCanceledException) { return; }
            }
        }

        private string Root()
        {
            var r = (JournalUrl ?? "").Trim().TrimEnd('/');
            var i = r.IndexOf("/api/", StringComparison.OrdinalIgnoreCase);
            if (i >= 0) r = r.Substring(0, i);
            return r.Length > 0 ? r : "http://localhost:5173";
        }

        private async Task Fetch(CancellationToken token)
        {
            var symbol = InstrumentInfo?.Instrument ?? "";
            var account = TradingManager?.Portfolio?.AccountID ?? "";
            var url = $"{Root()}/api/atas/hud?symbol={Uri.EscapeDataString(symbol)}&account={Uri.EscapeDataString(account)}";
            using var ask = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrWhiteSpace(Token))
                ask.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
            using var reply = await Http.SendAsync(ask, token);
            reply.EnsureSuccessStatusCode();
            var text = await reply.Content.ReadAsStringAsync(token);
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var snap = new Snapshot { At = DateTime.UtcNow, DayStartUtc = Long(root, "dayStartUtc"), Market = Str(root, "market") };
            if (root.TryGetProperty("account", out var a) && a.ValueKind == JsonValueKind.Object)
            {
                var ai = new AccountInfo
                {
                    DailyLoss = Dec(a, "dailyLoss"), Trail = Dec(a, "trail"), MaxTrades = (int)Dec(a, "maxTrades"),
                    Enforced = Bool(a, "enforced"), Enforcing = Bool(a, "enforcing"), Blocked = Bool(a, "blocked"), Reason = Str(a, "reason"),
                    Windowed = Bool(a, "windowed"), InWindow = !a.TryGetProperty("inWindow", out var iw) || iw.ValueKind != JsonValueKind.False,
                    WindowMin = a.TryGetProperty("windowChangeMin", out var wm) && wm.ValueKind == JsonValueKind.Number ? wm.GetInt32() : null,
                };
                if (a.TryGetProperty("tier", out var t) && t.ValueKind == JsonValueKind.Object)
                {
                    ai.TierName = Str(t, "name"); ai.TierColor = Str(t, "color"); ai.Level = (int)Dec(t, "level"); ai.Of = (int)Dec(t, "of");
                }
                snap.Account = ai;
            }
            if (root.TryGetProperty("gex", out var g) && g.ValueKind == JsonValueKind.Object)
            {
                var gx = new Gex { Index = Str(g, "index"), Zone = Str(g, "zone"), Error = Str(g, "error"), Total = Dec(g, "total"), Delayed = Bool(g, "delayed"), At = Long(g, "at") };
                gx.Flip = NDec(g, "flip"); gx.CallWall = NDec(g, "callWall"); gx.PutWall = NDec(g, "putWall");
                foreach (var (name, list) in new[] { ("pos", gx.Pos), ("neg", gx.Neg) })
                    if (g.TryGetProperty(name, out var arr) && arr.ValueKind == JsonValueKind.Array)
                        foreach (var l in arr.EnumerateArray())
                        {
                            var p = NDec(l, "price");
                            if (p != null) list.Add(new Level { Price = p.Value, Kind = name });
                        }
                snap.Gex = gx;
            }
            if (root.TryGetProperty("events", out var ev) && ev.ValueKind == JsonValueKind.Array)
                foreach (var e in ev.EnumerateArray())
                    snap.Events.Add(new EventItem { Id = Str(e, "id"), T = Long(e, "t"), Title = Str(e, "title"), Ccy = Str(e, "ccy"), Impact = Str(e, "impact"), Actual = Str(e, "actual"), Forecast = Str(e, "forecast"), Previous = Str(e, "previous") });
            if (root.TryGetProperty("news", out var nw) && nw.ValueKind == JsonValueKind.Array)
                foreach (var n in nw.EnumerateArray())
                {
                    var item = new NewsItem { Id = Str(n, "id"), T = Long(n, "t"), Title = Str(n, "title"), Src = Str(n, "src"), Importance = (int)Dec(n, "importance"), Dir = (int)Dec(n, "dir") };
                    if (n.TryGetProperty("tags", out var tg) && tg.ValueKind == JsonValueKind.Array)
                        foreach (var x in tg.EnumerateArray())
                            item.Tags.Add(new Tag { M = Str(x, "m"), Dir = (int)Dec(x, "dir") });
                    snap.News.Add(item);
                }
            _snap = snap;
            QueuePopups(snap);
        }

        private static string Str(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out var v)) return "";
            return v.ValueKind switch { JsonValueKind.String => v.GetString() ?? "", JsonValueKind.Number => v.GetRawText(), _ => "" };
        }
        private static bool Bool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
        private static long Long(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var l) ? l : 0;
        private static decimal Dec(JsonElement e, string name) => NDec(e, name) ?? 0m;
        private static decimal? NDec(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number) return null;
            try { return v.GetDecimal(); }
            catch { return null; }
        }

        // ---------- today's numbers for the chart's account (from ATAS) ----------

        private void ComputeDay()
        {
            var account = TradingManager?.Portfolio?.AccountID;
            var stats = TradingStatisticsProvider?.RawStatistics;
            if (string.IsNullOrEmpty(account) || stats == null)
                return;
            var snap = _snap;
            var dayStart = snap != null && snap.DayStartUtc > 0
                ? DateTimeOffset.FromUnixTimeMilliseconds(snap.DayStartUtc).UtcDateTime
                : DateTime.SpecifyKind(DateTime.Now.Date, DateTimeKind.Local).ToUniversalTime();
            List<HistoryMyTrade> list;
            try { list = stats.HistoryMyTrades.ToList(); }
            catch { return; }
            var today = list
                .Where(t => t.IsComplete && string.Equals(t.AccountID ?? t.Portfolio?.AccountID, account, StringComparison.OrdinalIgnoreCase)
                    && DateTime.SpecifyKind(t.CloseTime, DateTimeKind.Utc) >= dayStart)
                .OrderBy(t => t.CloseTime)
                .ToList();
            var d = new DayStats();
            decimal run = 0;
            foreach (var t in today)
            {
                var net = t.PnL - Math.Abs(t.Commission ?? 0m);
                run += net;
                if (run > d.Peak) d.Peak = run;
                d.Trades++;
                if (net > 0) { d.Wins++; d.GrossWin += net; }
                else if (net < 0) { d.Losses++; d.GrossLoss += -net; }
                if (d.Trades == 1 || net > d.Best) d.Best = net;
                if (d.Trades == 1 || net < d.Worst) d.Worst = net;
            }
            d.Realised = run;
            d.AvgWin = d.Wins > 0 ? d.GrossWin / d.Wins : 0;
            d.AvgLoss = d.Losses > 0 ? d.GrossLoss / d.Losses : 0;
            _day = d;
        }

        // ---------- pop-ups ----------

        private static bool Passes(EventLevel level, string impact) => level switch
        {
            EventLevel.HighOnly => impact == "high",
            EventLevel.MediumAndHigh => impact == "high" || impact == "medium",
            _ => true,
        };

        private static bool Passes(NewsLevel level, int importance) => level switch
        {
            NewsLevel.HighImpactOnly => importance >= 3,
            NewsLevel.ImportantOnly => importance >= 2,
            _ => true,
        };

        private void QueuePopups(Snapshot s)
        {
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var add = new List<Popup>();
            lock (_popLock)
            {
                foreach (var n in s.News.OrderBy(x => x.T))
                {
                    var key = "n:" + n.Id;
                    if (!_seen.Add(key) || !_primed) continue;
                    if (nowMs - n.T > 15 * 60_000) continue;
                    if (!Passes(PopupFilter, n.Importance)) continue;
                    if (PopupThisMarket && s.Market.Length > 0 && !n.Tags.Any(t => t.M == s.Market)) continue;
                    add.Add(new Popup { Key = key, Kind = n.Importance >= 3 ? "high" : "news", Title = n.Title, Meta = $"{Pretty(n.Src)} · {Clock(n.T)}{(n.Importance >= 3 ? " · High impact" : "")}", Tags = n.Tags });
                }
                foreach (var e in s.Events)
                {
                    if (EventWarnMinutes > 0 && Passes(PopupEventFilter, e.Impact) && e.T > nowMs && e.T - nowMs <= EventWarnMinutes * 60_000L)
                    {
                        var key = "w:" + e.Id;
                        if (_seen.Add(key))
                        {
                            var mins = Math.Max(1, (int)Math.Round((e.T - nowMs) / 60000.0));
                            add.Add(new Popup { Key = key, Kind = "soon", Impact = e.Impact, Title = $"{e.Ccy} {e.Title} at {Clock(e.T)}", Meta = $"Economic calendar · in {mins} min · {Cap(e.Impact)} impact" });
                        }
                    }
                    if (PopupReleases && Passes(PopupEventFilter, e.Impact) && e.Actual.Length > 0 && e.T <= nowMs)
                    {
                        var key = "r:" + e.Id;
                        if (_seen.Add(key) && _primed && nowMs - e.T < 30 * 60_000)
                            add.Add(new Popup
                            {
                                Key = key, Kind = e.Impact == "high" ? "high" : "release", Impact = e.Impact,
                                Title = $"{e.Ccy} {e.Title}", Meta = $"Economic calendar · {Clock(e.T)} · {Cap(e.Impact)} impact · released",
                                Nums = new[] { e.Actual, e.Forecast.Length > 0 ? e.Forecast : "—", e.Previous.Length > 0 ? e.Previous : "—" },
                            });
                    }
                }
                _primed = true; // what was already there when the chart opened doesn't pop up
                foreach (var p in add)
                {
                    p.Shown = DateTime.UtcNow;
                    _popups.Add(p);
                }
                while (_popups.Count > 4)
                    _popups.RemoveAt(0);
                if (_seen.Count > 4000)
                    _seen.Clear();
            }
        }

        private static string Pretty(string src) => src switch
        {
            "" => "News",
            "calendar" => "Economic calendar",
            _ => char.ToUpperInvariant(src[0]) + src.Substring(1),
        };
        private static string Cap(string s) => string.IsNullOrEmpty(s) ? "" : char.ToUpperInvariant(s[0]) + s.Substring(1);
        private static string Clock(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture);

        // ---------- mouse: collapse the feed, close a pop-up ----------

        public override bool ProcessMouseDown(RenderControlMouseEventArgs e)
        {
            if (ShowNews && _newsHeader.Contains(e.Location))
            {
                _newsCollapsed = !_newsCollapsed;
                RedrawChart();
                return true;
            }
            if (ShowAccount && ShowStats && _statsRect.Contains(e.Location))
            {
                _statsCollapsed = !_statsCollapsed;
                RedrawChart();
                return true;
            }
            foreach (var (box, key) in _closeBoxes.ToList())
            {
                if (!box.Contains(e.Location)) continue;
                lock (_popLock) _popups.RemoveAll(p => p.Key == key);
                if (key == "preview") PreviewPopup = false;
                RedrawChart();
                return true;
            }
            return base.ProcessMouseDown(e);
        }

        public override StdCursor GetCursor(RenderControlMouseEventArgs e)
        {
            if ((ShowNews && _newsHeader.Contains(e.Location)) || (ShowAccount && ShowStats && _statsRect.Contains(e.Location)) || _closeBoxes.Any(b => b.Box.Contains(e.Location)))
                return StdCursor.Hand;
            return base.GetCursor(e);
        }

        // ---------- drawing ----------

        private void Fonts()
        {
            var name = string.IsNullOrWhiteSpace(FontName) ? "Consolas" : FontName.Trim();
            if (name == _fontName && Math.Abs(FontSize - _fontSize) < 0.01f) return;
            _fontName = name;
            _fontSize = FontSize;
            _font = new RenderFont(name, FontSize);
            _bold = new RenderFont(name, FontSize, FontStyle.Bold);
            _small = new RenderFont(name, Math.Max(6, FontSize - 1));
            _big = new RenderFont(name, FontSize + 2, FontStyle.Bold);
        }

        private static Color A(Color c, int alpha) => Color.FromArgb(Math.Max(0, Math.Min(255, alpha * c.A / 255)), c.R, c.G, c.B);

        private static Color Parse(string hex, Color fallback)
        {
            try
            {
                var h = (hex ?? "").Trim().TrimStart('#');
                if (h.Length == 6)
                    return Color.FromArgb(255, Convert.ToInt32(h.Substring(0, 2), 16), Convert.ToInt32(h.Substring(2, 2), 16), Convert.ToInt32(h.Substring(4, 2), 16));
            }
            catch { }
            return fallback;
        }

        private Point Place(Placement p, int w, int h, int ox, int oy)
        {
            var r = Container.Region;
            int x = p switch
            {
                Placement.TopLeft or Placement.MiddleLeft or Placement.BottomLeft => r.Left + ox,
                Placement.TopCenter or Placement.Center or Placement.BottomCenter => r.Left + (r.Width - w) / 2 + ox,
                _ => r.Right - w - ox,
            };
            int y = p switch
            {
                Placement.TopLeft or Placement.TopCenter or Placement.TopRight => r.Top + oy,
                Placement.MiddleLeft or Placement.Center or Placement.MiddleRight => r.Top + (r.Height - h) / 2 + oy,
                _ => r.Bottom - h - oy,
            };
            return new Point(x, y);
        }

        private void Panel(RenderContext g, Rectangle r)
        {
            g.FillRectangle(Background, r, Radius);
            g.DrawRectangle(new RenderPen(BorderColor, 1), r, Radius);
        }

        private int Txt(RenderContext g, string s, RenderFont f, Color c, int x, int y)
        {
            g.DrawString(s, f, c, x, y);
            return g.MeasureString(s, f).Width;
        }

        private string Fit(RenderContext g, string s, RenderFont f, int width)
        {
            if (width <= 0 || g.MeasureString(s, f).Width <= width) return s;
            var lo = 0;
            var hi = s.Length;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) / 2;
                if (g.MeasureString(s.Substring(0, mid) + "…", f).Width <= width) lo = mid; else hi = mid - 1;
            }
            return s.Substring(0, lo).TrimEnd() + "…";
        }

        private List<string> Wrap(RenderContext g, string s, RenderFont f, int width, int maxLines)
        {
            var lines = new List<string>();
            var cur = "";
            foreach (var word in (s ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var next = cur.Length == 0 ? word : cur + " " + word;
                if (g.MeasureString(next, f).Width <= width || cur.Length == 0) { cur = next; continue; }
                lines.Add(cur);
                cur = word;
                if (lines.Count == maxLines) break;
            }
            if (lines.Count < maxLines && cur.Length > 0) lines.Add(cur);
            if (lines.Count == maxLines)
            {
                var used = string.Join(" ", lines);
                if (used.Length < (s ?? "").Trim().Length) lines[maxLines - 1] = Fit(g, lines[maxLines - 1] + " …", f, width);
            }
            return lines;
        }

        /// <summary>A chip: tinted background, coloured border and text. Returns its width.</summary>
        private int Chip(RenderContext g, string text, Color c, int x, int y, int h, bool bold = false)
        {
            var f = bold ? _bold : _small;
            var padX = (int)Math.Round(7 * _k);
            var w = g.MeasureString(text, f).Width + padX * 2;
            var r = new Rectangle(x, y, w, h);
            g.FillRectangle(A(c, 28), r, Math.Min(Radius, 4));
            g.DrawRectangle(new RenderPen(A(c, 110), 1), r, Math.Min(Radius, 4));
            var th = g.MeasureString(text, f).Height;
            g.DrawString(text, f, c, x + padX, y + (h - th) / 2);
            return w;
        }

        private static string Money(decimal v, bool sign = false) => (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.Abs(v).ToString("N2", CultureInfo.InvariantCulture);
        private static string Num(decimal v, bool sign = false) => (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.Abs(v).ToString("N2", CultureInfo.InvariantCulture);
        private string Px(decimal v) => v.ToString(InstrumentInfo != null && InstrumentInfo.TickSize < 1 ? "N2" : "N0", CultureInfo.InvariantCulture);

        private decimal LastPrice()
        {
            try
            {
                var last = CurrentBar - 1;
                return last >= 0 ? GetCandle(last).Close : 0m;
            }
            catch { return 0m; }
        }

        protected override void OnRender(RenderContext g, DrawingLayouts layout)
        {
            if (ChartInfo == null || Container == null)
                return;
            Fonts();
            if (!_collapseInit) { _newsCollapsed = NewsStartCollapsed; _statsCollapsed = StatsStartCollapsed; _collapseInit = true; }
            _closeBoxes.Clear();
            var snap = _snap;
            try { if (ShowGamma && snap?.Gex != null) DrawGamma(g, snap.Gex); } catch { }
            try { if (ShowMarkers && snap != null) DrawMarkers(g, snap); } catch { }
            try { if (ShowNews) DrawNews(g, snap); else _newsHeader = Rectangle.Empty; } catch { }
            try { if (ShowAccount) DrawAccount(g, snap); } catch { }
            try { if (ShowPopups || PreviewPopup) DrawPopups(g, snap); } catch { }
        }

        // ---------- gamma levels ----------

        private void DrawGamma(RenderContext g, Gex gx)
        {
            var r = Container.Region;
            var levels = new List<(decimal Price, string Name, Color Color, bool Major)>();
            if (ShowCallWall && gx.CallWall != null) levels.Add((gx.CallWall.Value, "Call wall", CallWallColor, true));
            if (ShowPutWall && gx.PutWall != null) levels.Add((gx.PutWall.Value, "Put wall", PutWallColor, true));
            if (ShowFlip && gx.Flip != null) levels.Add((gx.Flip.Value, "Zero gamma (flip)", FlipColor, true));
            if (ShowMajors)
            {
                foreach (var l in gx.Pos) levels.Add((l.Price, "+GEX", PosGexColor, false));
                foreach (var l in gx.Neg) levels.Add((l.Price, "−GEX", NegGexColor, false));
            }

            if (ShowShading && gx.Flip != null)
            {
                var yf = ChartInfo.GetYByPrice(gx.Flip.Value, false);
                var top = Math.Max(r.Top, Math.Min(r.Bottom, yf));
                if (top > r.Top) g.FillRectangle(A(PositiveColor, 10), A(PositiveColor, 0), new Rectangle(r.Left, r.Top, r.Width, top - r.Top), true);
                if (top < r.Bottom) g.FillRectangle(A(NegativeColor, 0), A(NegativeColor, 14), new Rectangle(r.Left, top, r.Width, r.Bottom - top), true);
            }

            foreach (var (price, name, color, major) in levels)
            {
                var y = ChartInfo.GetYByPrice(price, false);
                if (y < r.Top - 40 || y > r.Bottom + 40) continue;
                if (GammaStyle == GammaDrawing.Zones)
                {
                    var half = ZoneWidth / 2;
                    var y1 = ChartInfo.GetYByPrice(price + half, false);
                    var y2 = ChartInfo.GetYByPrice(price - half, false);
                    var zr = new Rectangle(r.Left, Math.Min(y1, y2), r.Width, Math.Max(2, Math.Abs(y2 - y1)));
                    g.FillRectangle(A(color, ZoneOpacity * 255 / 100), zr);
                    var edge = new RenderPen(A(color, 140), 1);
                    g.DrawLine(edge, r.Left, zr.Top, r.Right, zr.Top);
                    g.DrawLine(edge, r.Left, zr.Bottom, r.Right, zr.Bottom);
                }
                else
                {
                    var pen = new RenderPen(color, major ? LineWidth : Math.Max(1, LineWidth - 1), name.StartsWith("Zero") ? System.Drawing.Drawing2D.DashStyle.Dash : major ? System.Drawing.Drawing2D.DashStyle.Solid : System.Drawing.Drawing2D.DashStyle.Dot);
                    g.DrawLine(pen, r.Left, y, r.Right, y);
                }
                if (ShowLevelNames)
                {
                    var label = name == "+GEX" || name == "−GEX" ? name : name;
                    var size = g.MeasureString(label, _small);
                    var lw = size.Width + 12;
                    var lx = LevelNameSide switch
                    {
                        LabelSide.Middle => r.Left + (r.Width - lw) / 2 + LevelNameX,
                        LabelSide.Right => r.Right - lw - LevelNameX,
                        _ => r.Left + LevelNameX,
                    };
                    var lr = new Rectangle(lx, y - size.Height - 4, lw, size.Height + 4);
                    g.FillRectangle(Color.FromArgb(200, 0, 0, 0), lr, 3);
                    g.DrawRectangle(new RenderPen(A(color, 120), 1), lr, 3);
                    g.DrawString(label, _small, color, lr.X + 6, lr.Y + 2);
                }
                if (ShowAxisTags)
                    AxisTag(g, price, color);
            }
        }

        private void AxisTag(RenderContext g, decimal price, Color color)
        {
            var bounds = g.ClipBounds;
            g.ResetClip();
            try
            {
                var font = ChartInfo.PriceAxisFont;
                var text = ChartInfo.GetPriceString(price);
                var size = g.MeasureString(text, font);
                var x = ChartInfo.PriceChartContainer.Region.Right;
                var right = ChartInfo.ChartContainer.Region.Right;
                var y = ChartInfo.GetYByPrice(price, false);
                var h = size.Height / 2 + 1;
                var pts = new[] { new Point(x, y), new Point(x + h, y - h), new Point(right, y - h), new Point(right, y + h), new Point(x + h, y + h) };
                g.FillPolygon(color, pts);
                var ink = color.R * 0.299 + color.G * 0.587 + color.B * 0.114 > 150 ? Color.Black : Color.White;
                g.DrawString(text, font, ink, x + h + 2, y - size.Height / 2);
            }
            finally
            {
                g.SetClip(bounds);
            }
        }

        // ---------- event markers ----------

        private void DrawMarkers(RenderContext g, Snapshot s)
        {
            if (s.Events.Count == 0 || CurrentBar < 2) return;
            var r = Container.Region;
            var first = Math.Max(0, FirstVisibleBarNumber);
            var last = Math.Min(CurrentBar - 1, LastVisibleBarNumber);
            var mouse = MouseLocationInfo?.LastPosition ?? Point.Empty;
            EventItem? hover = null;
            var hoverX = 0;
            foreach (var e in s.Events.Where(e => Passes(MarkerFilter, e.Impact)))
            {
                var at = DateTimeOffset.FromUnixTimeMilliseconds(e.T).UtcDateTime;
                int bar = -1;
                for (var b = last; b >= first; b--)
                {
                    if (GetCandle(b).Time <= at) { bar = b; break; }
                }
                if (bar < 0) continue;
                if (bar == last && at > GetCandle(last).LastTime) continue; // still to come
                var x = ChartInfo.GetXByBar(bar) + (int)(ChartInfo.PriceChartContainer.BarsWidth / 2);
                var c = e.Impact == "high" ? NegativeColor : e.Impact == "medium" ? WarningColor : MutedColor;
                var label = e.Impact == "high" ? "HIGH" : e.Impact == "medium" ? "MED" : "LOW";
                var size = g.MeasureString(label, _small);
                var box = new Rectangle(x - size.Width / 2 - 5, r.Bottom - size.Height - 10, size.Width + 10, size.Height + 4);
                if (MarkerLines)
                    g.DrawLine(new RenderPen(A(c, 90), 1, System.Drawing.Drawing2D.DashStyle.Dash), x, r.Top, x, box.Top);
                g.FillRectangle(A(c, 40), box, 3);
                g.DrawRectangle(new RenderPen(A(c, 140), 1), box, 3);
                g.DrawString(label, _small, c, box.X + 5, box.Y + 2);
                if (box.Contains(mouse)) { hover = e; hoverX = x; }
            }
            if (hover != null)
            {
                var lines = new List<(string, Color)> { ($"{Clock(hover.T)} · {hover.Ccy} {hover.Title}", TextColor) };
                if (hover.Actual.Length > 0 || hover.Forecast.Length > 0)
                    lines.Add(($"Actual {(hover.Actual.Length > 0 ? hover.Actual : "—")}   Forecast {(hover.Forecast.Length > 0 ? hover.Forecast : "—")}   Prev {(hover.Previous.Length > 0 ? hover.Previous : "—")}", MutedColor));
                var lh = g.MeasureString("Ag", _font).Height + 3;
                var w = lines.Max(l => g.MeasureString(l.Item1, _font).Width) + 20;
                var rect = new Rectangle(Math.Max(r.Left + 4, Math.Min(r.Right - w - 4, hoverX - w / 2)), r.Bottom - 40 - lines.Count * lh - 12, w, lines.Count * lh + 12);
                Panel(g, rect);
                var y = rect.Y + 6;
                foreach (var (t, c) in lines) { g.DrawString(t, _font, c, rect.X + 10, y); y += lh; }
            }
        }

        // ---------- account panel ----------

        private void DrawAccount(RenderContext g, Snapshot? s)
        {
            // its own size: fonts and spacing scale together, and it narrows to fit the chart
            var k = Math.Max(0.5f, Math.Min(2.5f, AccountScale / 100f));
            var key = $"{_fontName}|{_fontSize}|{k}";
            if (key != _aKey)
            {
                _aKey = key;
                _aFont = new RenderFont(_fontName, _fontSize * k);
                _aBold = new RenderFont(_fontName, _fontSize * k, FontStyle.Bold);
                _aSmall = new RenderFont(_fontName, Math.Max(5, (_fontSize - 1) * k));
                _aBig = new RenderFont(_fontName, (_fontSize + 2) * k, FontStyle.Bold);
            }
            var (f0, f1, f2, f3) = (_font, _bold, _small, _big);
            (_font, _bold, _small, _big, _k) = (_aFont, _aBold, _aSmall, _aBig, k);
            try { DrawAccountBody(g, s, k); }
            finally { (_font, _bold, _small, _big, _k) = (f0, f1, f2, f3, 1f); }
        }

        private void DrawAccountBody(RenderContext g, Snapshot? s, float k)
        {
            var portfolio = TradingManager?.Portfolio;
            var acct = s?.Account;
            var day = _day;
            var w = (int)Math.Round(AccountWidth * k);
            if (AccountFit)
                w = Math.Min(w, Container.Region.Width - 2 * Math.Max(4, Math.Abs(AccountX)));
            w = Math.Max(w, (int)(170 * k));
            var pad = (int)Math.Round(10 * k);
            var lh = g.MeasureString("Ag", _font).Height;
            var sh = g.MeasureString("Ag", _small).Height;
            var chipH = sh + (int)Math.Round(8 * k);
            var cols = w >= 270 * k ? 4 : 2; // stats in two columns on a narrow panel
            var statRowH = sh + lh + (int)Math.Round(10 * k);
            var gx = s?.Gex;
            var price = LastPrice();

            // gamma regime
            string? gammaText = null;
            var gammaColor = MutedColor;
            if (gx != null && gx.Error.Length == 0)
            {
                if (gx.Flip != null && price > 0)
                {
                    var dist = price - gx.Flip.Value;
                    if (Math.Abs(dist) <= FlipNear) { gammaText = $"γ≈ At the flip · {Math.Abs(dist):0.#} pts"; gammaColor = WarningColor; }
                    else if (dist > 0) { gammaText = "γ+ Positive gamma · pinning"; gammaColor = PositiveColor; }
                    else { gammaText = "γ− Negative gamma · trending"; gammaColor = NegativeColor; }
                }
                else if (gx.Zone.Length > 0)
                {
                    gammaText = gx.Zone == "positive" ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending";
                    gammaColor = gx.Zone == "positive" ? PositiveColor : NegativeColor;
                }
            }

            // height first
            var h = pad + lh + pad; // header
            var chips = (ShowTierChip && acct != null && acct.TierName.Length > 0) || (ShowGammaChip && gammaText != null);
            if (chips) h += chipH + 8;
            var blocked = acct != null && acct.Blocked;
            if (blocked) h += lh * 2 + 14;
            var tileH = sh + lh + (int)Math.Round(14 * k);
            if (ShowPnlTiles) h += tileH + 8;
            var dll = acct?.DailyLoss ?? 0;
            if (ShowBuffer && dll > 0) h += sh + 10 + 6 + sh + 10;
            if (ShowStats && day.Trades > 0) h += _statsCollapsed ? sh + (int)Math.Round(12 * k) : statRowH * (8 / cols) + 2;
            else _statsRect = Rectangle.Empty;
            if (ShowGexLine && gx != null) h += lh + 12;

            var p = Place(AccountPlacement, w, h, AccountX, AccountY);
            var rect = new Rectangle(p.X, p.Y, w, h);
            Panel(g, rect);
            var x = p.X + pad;
            var y = p.Y + pad;

            // header
            var cx = x + Txt(g, "Ronin", _bold, TextColor, x, y);
            cx += Txt(g, "Flow", _bold, AccentColor, cx, y) + 8;
            var id = portfolio?.AccountID ?? "no account";
            Txt(g, id.Length > 9 ? id.Substring(0, 4) + "•••" + id.Substring(id.Length - 3) : id, _font, MutedColor, cx, y);
            var state = s == null || (DateTime.UtcNow - s.At).TotalSeconds > 20 ? "offline" : blocked ? "blocked" : acct?.Enforcing == true ? "enforcing" : "live";
            var stateColor = state == "offline" ? MutedColor : state == "blocked" ? NegativeColor : PositiveColor;
            var sw = g.MeasureString(state, _small).Width;
            g.DrawString(state, _small, MutedColor, rect.Right - pad - sw, y + (lh - sh) / 2);
            g.FillEllipse(stateColor, new Rectangle(rect.Right - pad - sw - 12, y + lh / 2 - 3, 6, 6));
            y += lh + pad;
            g.DrawLine(new RenderPen(A(BorderColor, 255), 1), rect.Left + 1, y - pad / 2, rect.Right - 1, y - pad / 2);

            // chips
            if (chips)
            {
                var chipX = x;
                if (ShowTierChip && acct != null && acct.TierName.Length > 0)
                    chipX += Chip(g, $"● Tier {acct.TierName} {acct.Level + 1}/{Math.Max(1, acct.Of)}", Parse(acct.TierColor, AccentColor), chipX, y, chipH) + 6;
                if (ShowGammaChip && gammaText != null)
                {
                    var gw = g.MeasureString(gammaText, _small).Width + 14;
                    if (chipX + gw > rect.Right - pad && chipX > x) { /* no room: keep it on this row, trimmed */ gammaText = Fit(g, gammaText, _small, rect.Right - pad - chipX - 14); }
                    Chip(g, gammaText, gammaColor, chipX, y, chipH);
                }
                y += chipH + 8;
            }

            if (blocked)
            {
                var br = new Rectangle(x, y, w - pad * 2, lh * 2 + 8);
                g.FillRectangle(A(NegativeColor, 22), br, 4);
                g.DrawRectangle(new RenderPen(A(NegativeColor, 110), 1), br, 4);
                var lines = Wrap(g, "New orders blocked — " + (acct!.Reason.Length > 0 ? acct.Reason : "a risk rule is broken"), _small, br.Width - 14, 2);
                var ty = br.Y + 4;
                foreach (var l in lines) { g.DrawString(l, _small, NegativeColor, br.X + 7, ty); ty += lh; }
                y += br.Height + 6;
            }

            // tiles
            if (ShowPnlTiles)
            {
                var open = portfolio?.OpenPnL ?? 0m;
                var tw = (w - pad * 2 - 12) / 3;
                var tiles = new (string Label, string Value, Color Color, int Tone)[]
                {
                    ("OPEN", Num(open, true), open > 0 ? PositiveColor : open < 0 ? NegativeColor : MutedColor, Math.Sign(open)),
                    ("CLOSED", Num(day.Realised, true), day.Realised > 0 ? PositiveColor : day.Realised < 0 ? NegativeColor : MutedColor, Math.Sign(day.Realised)),
                    ("TRADES", acct?.MaxTrades > 0 ? $"{day.Trades} / {acct.MaxTrades}" : day.Trades.ToString(CultureInfo.InvariantCulture), TextColor, 0),
                };
                for (var i = 0; i < 3; i++)
                {
                    var tr = new Rectangle(x + i * (tw + 6), y, tw, tileH);
                    var tone = tiles[i].Tone > 0 ? PositiveColor : tiles[i].Tone < 0 ? NegativeColor : Color.Empty;
                    g.FillRectangle(tone.IsEmpty ? TileColor : A(tone, 22), tr, Math.Min(Radius, 5));
                    g.DrawRectangle(new RenderPen(tone.IsEmpty ? BorderColor : A(tone, 90), 1), tr, Math.Min(Radius, 5));
                    g.DrawString(tiles[i].Label, _small, MutedColor, tr.X + 8, tr.Y + 5);
                    g.DrawString(tiles[i].Value, _big, tiles[i].Color, tr.X + 8, tr.Y + 5 + sh + 2);
                }
                y += tileH + 8;
            }

            // buffer to the daily loss limit
            if (ShowBuffer && dll > 0)
            {
                var open = portfolio?.OpenPnL ?? 0m;
                var now = day.Realised + open;
                var buffer = dll + now;
                var trail = acct?.Trail ?? 0;
                var stop = trail > 0 ? Math.Max(-dll, day.Peak - trail) : -dll; // the tighter of the two
                var room = now - stop;
                Txt(g, "Buffer to loss limit", _small, MutedColor, x, y);
                var right = $"{Money(Math.Max(0, room))} of {Money(dll)}";
                var rw = g.MeasureString(right, _small).Width;
                g.DrawString(right, _small, room <= dll * 0.25m ? NegativeColor : TextColor, rect.Right - pad - rw, y);
                y += sh + 6;
                var bar = new Rectangle(x, y, w - pad * 2, 6);
                var lo = -dll;
                var hi = Math.Max(Math.Max(day.Peak, now), dll * 0.5m);
                int Xof(decimal v) => bar.X + (int)Math.Round((double)((Math.Max(lo, Math.Min(hi, v)) - lo) / (hi - lo)) * bar.Width);
                g.FillRectangle(A(NegativeColor, 80), A(PositiveColor, 80), bar, false);
                var sx = Xof(stop);
                g.FillRectangle(NegativeColor, new Rectangle(sx - 1, bar.Y - 2, 2, bar.Height + 4));
                var nx = Xof(now);
                g.FillRectangle(Color.White, new Rectangle(nx - 1, bar.Y - 3, 3, bar.Height + 6));
                y += 6 + 4;
                var l1 = $"stop {Num(stop, true)}";
                var l2 = $"day high {Num(day.Peak, true)}";
                g.DrawString(l1, _small, MutedColor, x, y);
                var l2w = g.MeasureString(l2, _small).Width;
                g.DrawString(l2, _small, MutedColor, rect.Right - pad - l2w, y);
                y += sh + 10;
            }

            // stats (click to collapse / expand)
            if (ShowStats && day.Trades > 0)
            {
                var winRate = (decimal)day.Wins / day.Trades * 100;
                var pf = day.GrossLoss > 0 ? day.GrossWin / day.GrossLoss : (day.GrossWin > 0 ? 99m : 0m);
                var ev = day.Realised / day.Trades;
                // Edge = the journal's Performance Ratio: win rate × average win ÷ average loss (0.75+ good, under 0.5 poor)
                var edge = day.AvgLoss > 0 ? winRate / 100 * day.AvgWin / day.AvgLoss : (day.AvgWin > 0 ? 99m : 0m);
                var edgeText = edge >= 99 ? "∞" : edge.ToString("0.00", CultureInfo.InvariantCulture);
                var edgeColor = edge >= 0.75m ? PositiveColor : edge >= 0.5m ? WarningColor : NegativeColor;
                var top = y;
                var line = new RenderPen(BorderColor, 1);
                g.DrawLine(line, rect.Left + 1, y, rect.Right - 1, y);
                if (_statsCollapsed)
                {
                    var rowH = sh + (int)Math.Round(12 * k);
                    var summary = $"Stats · {winRate:0}% win · PF {(pf >= 99 ? "∞" : pf.ToString("0.00", CultureInfo.InvariantCulture))} · Edge {edgeText} · EV {Num(ev, true)}";
                    g.DrawString(Fit(g, summary, _small, w - pad * 2 - 16), _small, MutedColor, x, y + (rowH - sh) / 2);
                    var aw = g.MeasureString("▸", _small).Width;
                    g.DrawString("▸", _small, MutedColor, rect.Right - pad - aw, y + (rowH - sh) / 2);
                    y += rowH;
                }
                else
                {
                    var items = new (string, string, Color)[]
                    {
                        ("Win rate", $"{winRate:0}%", TextColor), ("Profit f.", pf >= 99 ? "∞" : pf.ToString("0.00", CultureInfo.InvariantCulture), pf >= 1 ? PositiveColor : NegativeColor),
                        ("EV", Num(ev, true), ev >= 0 ? PositiveColor : NegativeColor), ("Edge", edgeText, edgeColor),
                        ("Avg win", Num(day.AvgWin), TextColor), ("Avg loss", Num(day.AvgLoss), TextColor),
                        ("Best", Num(day.Best, true), day.Best >= 0 ? PositiveColor : NegativeColor), ("Worst", Num(day.Worst, true), day.Worst >= 0 ? PositiveColor : NegativeColor),
                    };
                    var cw = (w - 2) / cols;
                    var ip = (int)Math.Round(8 * k);
                    for (var r0 = 0; r0 < items.Length; r0 += cols)
                    {
                        if (r0 > 0) g.DrawLine(line, rect.Left + 1, y, rect.Right - 1, y);
                        for (var i = 0; i < cols; i++)
                        {
                            var it = items[r0 + i];
                            var cxx = rect.Left + 1 + i * cw;
                            if (i > 0) g.DrawLine(line, cxx, y, cxx, y + statRowH);
                            g.DrawString(it.Item1, _small, MutedColor, cxx + ip, y + ip / 2);
                            g.DrawString(Fit(g, it.Item2, _bold, cw - ip * 2), _bold, it.Item3, cxx + ip, y + ip / 2 + sh + 2);
                        }
                        y += statRowH;
                    }
                    var aw = g.MeasureString("▾", _small).Width;
                    g.DrawString("▾", _small, A(MutedColor, 170), rect.Right - pad / 2 - aw, top + 3);
                    y += 2;
                }
                _statsRect = new Rectangle(rect.Left, top, rect.Width, y - top);
            }

            // GEX line
            if (ShowGexLine && gx != null)
            {
                g.DrawLine(new RenderPen(BorderColor, 1), rect.Left + 1, y, rect.Right - 1, y);
                y += 6;
                if (gx.Error.Length > 0)
                {
                    g.DrawString(Fit(g, $"{gx.Index} GEX: {gx.Error}", _small, w - pad * 2), _small, MutedColor, x, y + (lh - sh) / 2);
                }
                else
                {
                    var gxX = x + Txt(g, $"{gx.Index} GEX ", _small, MutedColor, x, y + (lh - sh) / 2);
                    var bn = gx.Total / 1_000_000_000m;
                    gxX += Txt(g, (bn >= 0 ? "+" : "−") + "$" + Math.Abs(bn).ToString("0.00", CultureInfo.InvariantCulture) + "B", _bold, bn >= 0 ? PositiveColor : NegativeColor, gxX, y) + 10;
                    if (gx.Flip != null)
                    {
                        gxX += Txt(g, "flip ", _small, MutedColor, gxX, y + (lh - sh) / 2);
                        gxX += Txt(g, Px(gx.Flip.Value), _bold, TextColor, gxX, y) + 8;
                        if (price > 0)
                        {
                            var d = price - gx.Flip.Value;
                            Txt(g, Fit(g, $"{Math.Abs(d):0.#} pts {(d >= 0 ? "below" : "above")}", _small, rect.Right - pad - gxX), _small, MutedColor, gxX, y + (lh - sh) / 2);
                        }
                    }
                }
            }
        }

        // ---------- news feed ----------

        private void DrawNews(RenderContext g, Snapshot? s)
        {
            var w = NewsWidth;
            var pad = 10;
            var lh = g.MeasureString("Ag", _font).Height;
            var sh = g.MeasureString("Ag", _small).Height;
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var market = s?.Market ?? "";
            var events = s == null ? new List<EventItem>() : s.Events.Where(e => Passes(EventFilter, e.Impact)).ToList();
            var news = s == null ? new List<NewsItem>() : s.News
                .Where(n => Passes(NewsFilter, n.Importance) && (!OnlyThisMarket || market.Length == 0 || n.Tags.Any(t => t.M == market)))
                .Take(NewsLines).ToList();
            // keep the next few events: the last two that have passed and everything still to come
            if (events.Count > 6)
            {
                var past = events.Where(e => e.T <= nowMs).TakeLast(2);
                events = past.Concat(events.Where(e => e.T > nowMs)).Take(6).ToList();
            }

            var headerH = lh + pad;
            var rowH = lh + 6;
            var h = headerH;
            if (!_newsCollapsed)
            {
                if (ShowEvents) h += sh + 10 + Math.Max(1, events.Count) * rowH;
                if (NewsLines > 0) h += sh + 10 + Math.Max(1, news.Count) * rowH;
                h += 6;
            }
            var p = Place(NewsPlacement, w, h, NewsX, NewsY);
            var rect = new Rectangle(p.X, p.Y, w, h);
            Panel(g, rect);
            var x = p.X + pad;
            var y = p.Y + pad / 2 + 1;

            // header (click to collapse)
            _newsHeader = new Rectangle(rect.X, rect.Y, rect.Width, headerH);
            var hx = x + Txt(g, "Ronin", _bold, TextColor, x, y);
            hx += Txt(g, "Flow", _bold, AccentColor, hx, y) + 8;
            hx += Txt(g, "NEWS", _small, MutedColor, hx, y + (lh - sh) / 2) + 8;
            if (market.Length > 0) Chip(g, market, MutedColor, hx, y, lh);
            var arrow = _newsCollapsed ? "▸" : "▾";
            var newest = s?.News.FirstOrDefault();
            if (_newsCollapsed && newest != null)
            {
                var info = $"{Clock(newest.T)}  {newest.Title}";
                var avail = rect.Right - pad - 20 - (hx + 46);
                if (avail > 40) g.DrawString(Fit(g, info, _small, avail), _small, MutedColor, hx + 46, y + (lh - sh) / 2);
            }
            var aw = g.MeasureString(arrow, _font).Width;
            g.DrawString(arrow, _font, MutedColor, rect.Right - pad - aw, y);
            if (_newsCollapsed) return;
            y = rect.Y + headerH;
            g.DrawLine(new RenderPen(BorderColor, 1), rect.Left + 1, y, rect.Right - 1, y);

            if (ShowEvents)
            {
                y += 5;
                g.DrawString("TODAY'S EVENTS", _small, A(MutedColor, 170), x, y);
                y += sh + 5;
                if (events.Count == 0) { g.DrawString(s == null ? "Waiting for RoninFlow…" : "Nothing scheduled", _font, MutedColor, x, y + 2); y += rowH; }
                foreach (var e in events)
                {
                    var done = e.T <= nowMs;
                    var c = e.Impact == "high" ? NegativeColor : e.Impact == "medium" ? WarningColor : MutedColor;
                    g.FillEllipse(done ? A(c, 110) : c, new Rectangle(x, y + lh / 2 - 2, 6, 6));
                    var ex = x + 12 + Txt(g, Clock(e.T), _font, MutedColor, x + 12, y + 2) + 10;
                    var right = "";
                    var rightColor = WarningColor;
                    if (!done)
                    {
                        var mins = (e.T - nowMs) / 60000.0;
                        right = mins < 60 ? $"in {Math.Max(1, (int)Math.Ceiling(mins))}m" : "";
                    }
                    var rw = right.Length > 0 ? g.MeasureString(right, _small).Width + 12 : 0;
                    var title = $"{e.Ccy} {e.Title}" + (done && e.Actual.Length > 0 ? $" · {e.Actual} vs {(e.Forecast.Length > 0 ? e.Forecast : "—")}" : "");
                    g.DrawString(Fit(g, title, _font, rect.Right - pad - ex - rw - 4), _font, done ? MutedColor : TextColor, ex, y + 2);
                    if (right.Length > 0)
                    {
                        var rr = new Rectangle(rect.Right - pad - rw + 2, y + 1, rw - 2, lh);
                        g.FillRectangle(A(rightColor, 22), rr, 3);
                        g.DrawRectangle(new RenderPen(A(rightColor, 100), 1), rr, 3);
                        g.DrawString(right, _small, rightColor, rr.X + 5, rr.Y + (lh - sh) / 2);
                    }
                    y += rowH;
                }
            }

            if (NewsLines > 0)
            {
                g.DrawLine(new RenderPen(BorderColor, 1), rect.Left + 1, y + 2, rect.Right - 1, y + 2);
                y += 7;
                g.DrawString("LIVE NEWS", _small, A(MutedColor, 170), x, y);
                if (s != null)
                {
                    var upd = $"updated {s.At.ToLocalTime():HH:mm:ss}";
                    var uw = g.MeasureString(upd, _small).Width;
                    g.DrawString(upd, _small, A(MutedColor, 170), rect.Right - pad - uw, y);
                }
                y += sh + 5;
                if (news.Count == 0) { g.DrawString(s == null ? "Waiting for RoninFlow…" : "No headlines yet", _font, MutedColor, x, y + 2); y += rowH; }
                foreach (var n in news)
                {
                    var fresh = nowMs - n.T < 10 * 60_000;
                    if (fresh)
                    {
                        g.FillRectangle(A(AccentColor, 30), A(AccentColor, 0), new Rectangle(rect.Left + 1, y, rect.Width - 2, rowH), false);
                        g.FillRectangle(AccentColor, new Rectangle(rect.Left + 1, y, 2, rowH));
                    }
                    var nx = x + Txt(g, Clock(n.T), _font, MutedColor, x, y + 2) + 10;
                    var tag = n.Tags.FirstOrDefault(t => t.M == market) ?? n.Tags.FirstOrDefault();
                    var tagText = tag == null ? "" : tag.M + (tag.Dir > 0 ? " ↑" : tag.Dir < 0 ? " ↓" : "");
                    var tagW = tagText.Length > 0 ? g.MeasureString(tagText, _small).Width + 14 + 6 : 0;
                    var color = n.Importance >= 3 ? TextColor : A(TextColor, 215);
                    g.DrawString(Fit(g, n.Title, _font, rect.Right - pad - nx - tagW), _font, color, nx, y + 2);
                    if (tag != null)
                        Chip(g, tagText, tag.Dir > 0 ? PositiveColor : tag.Dir < 0 ? NegativeColor : MutedColor, rect.Right - pad - tagW + 6, y + 2, lh);
                    y += rowH;
                }
            }
        }

        // ---------- pop-ups ----------

        private void DrawPopups(RenderContext g, Snapshot? s)
        {
            List<Popup> list;
            lock (_popLock) list = ShowPopups ? _popups.ToList() : new List<Popup>();
            if (PreviewPopup)
                list.Insert(0, new Popup
                {
                    Key = "preview", Kind = "high", Shown = DateTime.UtcNow,
                    Meta = "Preview · pop-ups appear here · click × to hide",
                    Title = "Fed's Goolsbee: not yet confident inflation is on track, sees fewer cuts next year",
                    Tags = new List<Tag> { new() { M = "NQ", Dir = -1 }, new() { M = "ES", Dir = -1 } },
                });
            if (list.Count == 0) return;
            var w = PopupWidth;
            var pad = 12;
            var lh = g.MeasureString("Ag", _font).Height;
            var sh = g.MeasureString("Ag", _small).Height;
            var icon = lh + 8;
            var textW = w - pad * 2 - icon - 10 - 16;

            // measure each, then stack from the chosen place (downwards from the top, upwards from the bottom)
            var heights = list.Select(p => 2 + pad + sh + 4 + Wrap(g, p.Title, _font, textW, 2).Count * (lh + 2) + (p.Nums != null ? sh + lh + 16 : 0) + (p.Tags.Count > 0 ? lh + 8 : 0) + pad + 2).ToList();
            var total = heights.Sum() + (list.Count - 1) * 8;
            var origin = Place(PopupPlacement, w, total, PopupX, PopupY);
            var y = origin.Y;
            for (var i = 0; i < list.Count; i++)
            {
                var pop = list[i];
                var h = heights[i];
                var rect = new Rectangle(origin.X, y, w, h);
                var c = pop.Kind == "high" ? NegativeColor : pop.Kind == "soon" ? WarningColor : pop.Kind == "release" ? WarningColor : AccentColor;
                g.FillRectangle(Color.FromArgb(Math.Max(Background.A, (byte)245), Background.R + 4 > 255 ? 255 : Background.R + 4, Background.G + 4 > 255 ? 255 : Background.G + 4, Background.B + 4 > 255 ? 255 : Background.B + 4), rect, Radius);
                g.DrawRectangle(new RenderPen(BorderColor, 1), rect, Radius);
                g.FillRectangle(c, new Rectangle(rect.X + 1, rect.Y + 1, rect.Width - 2, 2), 1);

                var ir = new Rectangle(rect.X + pad, rect.Y + pad + 2, icon, icon);
                g.FillRectangle(A(c, 40), ir, 5);
                var glyph = pop.Kind == "high" ? "!" : pop.Kind == "soon" ? "◷" : pop.Kind == "release" ? "!" : "N";
                var gsz = g.MeasureString(glyph, _bold);
                g.DrawString(glyph, _bold, c, ir.X + (icon - gsz.Width) / 2, ir.Y + (icon - gsz.Height) / 2);

                var tx = ir.Right + 10;
                var ty = rect.Y + pad;
                g.DrawString(Fit(g, pop.Meta, _small, textW), _small, MutedColor, tx, ty);
                ty += sh + 4;
                foreach (var line in Wrap(g, pop.Title, _font, textW, 2))
                {
                    g.DrawString(line, _font, TextColor, tx, ty);
                    ty += lh + 2;
                }
                if (pop.Nums != null)
                {
                    ty += 4;
                    var cw = (textW - 12) / 3;
                    var names = new[] { "ACTUAL", "FORECAST", "PREVIOUS" };
                    for (var k = 0; k < 3; k++)
                    {
                        var nr = new Rectangle(tx + k * (cw + 6), ty, cw, sh + lh + 8);
                        g.FillRectangle(TileColor, nr, 4);
                        g.DrawRectangle(new RenderPen(BorderColor, 1), nr, 4);
                        g.DrawString(names[k], _small, MutedColor, nr.X + 6, nr.Y + 3);
                        g.DrawString(pop.Nums[k], _bold, k == 0 ? c : TextColor, nr.X + 6, nr.Y + 3 + sh + 1);
                    }
                    ty += sh + lh + 12;
                }
                if (pop.Tags.Count > 0)
                {
                    ty += 4;
                    var cx = tx;
                    foreach (var t in pop.Tags.Take(4))
                        cx += Chip(g, t.M + (t.Dir > 0 ? " ↑" : t.Dir < 0 ? " ↓" : ""), t.Dir > 0 ? PositiveColor : t.Dir < 0 ? NegativeColor : MutedColor, cx, ty, lh) + 5;
                }

                // close and time left
                var xr = new Rectangle(rect.Right - pad - 12, rect.Y + pad - 2, 14, 14);
                g.DrawString("✕", _small, MutedColor, xr.X + 2, xr.Y);
                _closeBoxes.Add((Rectangle.Inflate(xr, 4, 4), pop.Key));
                if (pop.Key != "preview")
                {
                    var left = 1 - Math.Min(1, (DateTime.UtcNow - pop.Shown).TotalSeconds / Math.Max(1, PopupSeconds));
                    g.FillRectangle(A(TextColor, 40), new Rectangle(rect.X + 1, rect.Bottom - 3, (int)((rect.Width - 2) * left), 2));
                }

                y += h + 8;
            }
        }
    }
}
