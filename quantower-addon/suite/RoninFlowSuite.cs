// RoninFlow Suite — Quantower indicator (beta).
//
// RoninFlow on your chart, each part switched on or off in the indicator's settings: the account panel (risk tier,
// gamma regime, today's P&L, buffer to the profit target, trade stats, GEX line, open positions on every account),
// your executions, gamma levels, the news feed with pop-ups and today's economic events, a DOM heatmap, custom candles
// and alerts with sounds.
//
// Install: npm run addon:qt builds it into Quantower's Indicators folder (with RoninFlow Sync; needs the free .NET SDK).
// Then on a chart: Indicators → RoninFlow Suite.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using TradingPlatform.BusinessLayer;
using TradingPlatform.BusinessLayer.Chart;

namespace RoninFlowSuiteTypes
{
    public enum Corner { TopLeft, TopRight, BottomLeft, BottomRight, TopMiddle, BottomMiddle }
    public enum MarkerStyle { Triangles, Arrows, Circles }
    public enum LineKind { Solid, Dashed, Dotted }
    public enum ResultUnit { Money, Ticks, Points }
    public enum LabelSide { Left, Middle, Right }
    public enum EventLevel { AllEvents, MediumAndHigh, HighOnly }
    public enum Palette { Bookmap, Thermal, Ocean, Mono }
}

namespace TradeJournal
{
    using RoninFlowSuiteTypes;

    public sealed class RoninFlowSuite : Indicator
    {
        [InputParameter("General · RoninFlow address (empty = this PC / the sync settings file)", 1)]
        public string ServerUrl = "";
        [InputParameter("General · Token (RoninFlow on another computer only)", 2)]
        public string Token = "";
        [InputParameter("General · Account (empty = the chart's account)", 3)]
        public string AccountName = "";
        [InputParameter("General · Refresh every (seconds)", 4, minimum: 2, maximum: 60, increment: 1, decimalPlaces: 0)]
        public int RefreshSeconds = 3;
        [InputParameter("General · Text size", 5, minimum: 7, maximum: 20, increment: 1, decimalPlaces: 0)]
        public int FontSize = 11;
        [InputParameter("Account panel · Show the account panel", 6)]
        public bool ShowAccount = true;
        [InputParameter("Account panel · Placement", 7, variants: new object[] { "TopLeft", Corner.TopLeft, "TopRight", Corner.TopRight, "BottomLeft", Corner.BottomLeft, "BottomRight", Corner.BottomRight, "TopMiddle", Corner.TopMiddle, "BottomMiddle", Corner.BottomMiddle })]
        public Corner AccountPlacement = Corner.TopRight;
        [InputParameter("Account panel · X offset", 8, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int AccountX = 12;
        [InputParameter("Account panel · Y offset", 9, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int AccountY = 12;
        [InputParameter("Account panel · Width", 10, minimum: 180, maximum: 700, increment: 1, decimalPlaces: 0)]
        public int AccountWidth = 320;
        [InputParameter("Account panel · Risk tier chip", 11)]
        public bool ShowTierChip = true;
        [InputParameter("Account panel · Gamma regime chip", 12)]
        public bool ShowGammaChip = true;
        [InputParameter("Account panel · P&L tiles", 13)]
        public bool ShowPnlTiles = true;
        [InputParameter("Account panel · Buffer bar (loss limit to profit target)", 14)]
        public bool ShowBuffer = true;
        [InputParameter("Account panel · Buffer bar moves with closed P&L only", 15)]
        public bool BufferClosedOnly = false;
        [InputParameter("Account panel · Trade stats (click to collapse)", 16)]
        public bool ShowStats = true;
        [InputParameter("Account panel · GEX line", 17)]
        public bool ShowGexLine = true;
        [InputParameter("Account panel · Open positions on every account", 18)]
        public bool ShowAllPositions = true;
        [InputParameter("Executions · Show your executions", 19)]
        public bool ShowExecutions = true;
        [InputParameter("Executions · Marker style", 20, variants: new object[] { "Triangles", MarkerStyle.Triangles, "Arrows", MarkerStyle.Arrows, "Circles", MarkerStyle.Circles })]
        public MarkerStyle ExecMarker = MarkerStyle.Triangles;
        [InputParameter("Executions · Marker size", 21, minimum: 4, maximum: 40, increment: 1, decimalPlaces: 0)]
        public int ExecSize = 10;
        [InputParameter("Executions · Buy colour", 22)]
        public Color ExecBuyColor = Color.FromArgb(0x2B, 0xC4, 0x8A);
        [InputParameter("Executions · Sell colour", 23)]
        public Color ExecSellColor = Color.FromArgb(0xE5, 0x48, 0x4D);
        [InputParameter("Executions · Quantity next to each marker", 24)]
        public bool ExecShowQty = true;
        [InputParameter("Executions · Join entry and exit with a line", 25)]
        public bool ExecConnect = true;
        [InputParameter("Executions · Winning trade line", 26)]
        public Color ExecWinColor = Color.FromArgb(0x2B, 0xC4, 0x8A);
        [InputParameter("Executions · Losing trade line", 27)]
        public Color ExecLossColor = Color.FromArgb(0xE5, 0x48, 0x4D);
        [InputParameter("Executions · Line width", 28, minimum: 1, maximum: 8, increment: 1, decimalPlaces: 0)]
        public int ExecLineWidth = 1;
        [InputParameter("Executions · Line style", 29, variants: new object[] { "Solid", LineKind.Solid, "Dashed", LineKind.Dashed, "Dotted", LineKind.Dotted })]
        public LineKind ExecLineStyle = LineKind.Dashed;
        [InputParameter("Executions · Result at the exit", 30)]
        public bool ExecShowResult = true;
        [InputParameter("Executions · Result in", 31, variants: new object[] { "Money", ResultUnit.Money, "Ticks", ResultUnit.Ticks, "Points", ResultUnit.Points })]
        public ResultUnit ExecResultUnit = ResultUnit.Money;
        [InputParameter("Executions · Open position average price line", 32)]
        public bool ExecShowAvg = true;
        [InputParameter("Executions · Average price line colour", 33)]
        public Color ExecAvgColor = Color.FromArgb(0xE8, 0xB0, 0x43);
        [InputParameter("Gamma · Show gamma levels", 34)]
        public bool ShowGamma = true;
        [InputParameter("Gamma · Zones instead of lines", 35)]
        public bool GammaZones = false;
        [InputParameter("Gamma · Zone height (ticks)", 36, minimum: 1, maximum: 200, increment: 1, decimalPlaces: 0)]
        public int ZoneTicks = 8;
        [InputParameter("Gamma · Gamma flip", 37)]
        public bool ShowFlip = true;
        [InputParameter("Gamma · Call and put walls", 38)]
        public bool ShowWalls = true;
        [InputParameter("Gamma · Other big strikes", 39)]
        public bool ShowOtherLevels = true;
        [InputParameter("Gamma · Level names", 40, variants: new object[] { "Left", LabelSide.Left, "Middle", LabelSide.Middle, "Right", LabelSide.Right })]
        public LabelSide LabelSide = LabelSide.Right;
        [InputParameter("Gamma · Call wall", 41)]
        public Color CallWallColor = Color.FromArgb(0x2B, 0xC4, 0x8A);
        [InputParameter("Gamma · Put wall", 42)]
        public Color PutWallColor = Color.FromArgb(0xE5, 0x48, 0x4D);
        [InputParameter("Gamma · Gamma flip colour", 43)]
        public Color FlipColor = Color.FromArgb(0xE8, 0xB0, 0x43);
        [InputParameter("Gamma · Positive strikes", 44)]
        public Color PosLevelColor = Color.FromArgb(0x2B, 0xC4, 0x8A);
        [InputParameter("Gamma · Negative strikes", 45)]
        public Color NegLevelColor = Color.FromArgb(0xE5, 0x48, 0x4D);
        [InputParameter("Gamma · Line width", 46, minimum: 1, maximum: 6, increment: 1, decimalPlaces: 0)]
        public int LevelWidth = 1;
        [InputParameter("News · Show the news feed (click the title to collapse)", 47)]
        public bool ShowNews = true;
        [InputParameter("News · Placement", 48, variants: new object[] { "TopLeft", Corner.TopLeft, "TopRight", Corner.TopRight, "BottomLeft", Corner.BottomLeft, "BottomRight", Corner.BottomRight, "TopMiddle", Corner.TopMiddle, "BottomMiddle", Corner.BottomMiddle })]
        public Corner NewsPlacement = Corner.TopLeft;
        [InputParameter("News · X offset", 49, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int NewsX = 12;
        [InputParameter("News · Y offset", 50, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int NewsY = 12;
        [InputParameter("News · Width", 51, minimum: 200, maximum: 800, increment: 1, decimalPlaces: 0)]
        public int NewsWidth = 360;
        [InputParameter("News · Headlines", 52, minimum: 1, maximum: 20, increment: 1, decimalPlaces: 0)]
        public int NewsRows = 6;
        [InputParameter("News · Only headlines at least this important (0-3)", 53, minimum: 0, maximum: 3, increment: 1, decimalPlaces: 0)]
        public int NewsMinImportance = 0;
        [InputParameter("News · Pop-ups for new headlines", 54)]
        public bool ShowPopups = true;
        [InputParameter("News · Pop-up placement", 55, variants: new object[] { "TopLeft", Corner.TopLeft, "TopRight", Corner.TopRight, "BottomLeft", Corner.BottomLeft, "BottomRight", Corner.BottomRight, "TopMiddle", Corner.TopMiddle, "BottomMiddle", Corner.BottomMiddle })]
        public Corner PopupPlacement = Corner.BottomRight;
        [InputParameter("News · Pop-up X offset", 56, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int PopupX = 12;
        [InputParameter("News · Pop-up Y offset", 57, minimum: -3000, maximum: 3000, increment: 1, decimalPlaces: 0)]
        public int PopupY = 40;
        [InputParameter("News · Pop-up shows for (seconds)", 58, minimum: 3, maximum: 120, increment: 1, decimalPlaces: 0)]
        public int PopupSeconds = 12;
        [InputParameter("News · Pop-ups only at least this important (0-3)", 59, minimum: 0, maximum: 3, increment: 1, decimalPlaces: 0)]
        public int PopupMinImportance = 2;
        [InputParameter("News · Today's economic events on the time axis", 60)]
        public bool ShowEventMarkers = true;
        [InputParameter("News · Events shown", 61, variants: new object[] { "AllEvents", EventLevel.AllEvents, "MediumAndHigh", EventLevel.MediumAndHigh, "HighOnly", EventLevel.HighOnly })]
        public EventLevel EventMinImpact = EventLevel.MediumAndHigh;
        [InputParameter("Heatmap · Show the DOM heatmap", 62)]
        public bool ShowHeatmap = false;
        [InputParameter("Heatmap · Draw behind the candles", 63)]
        public bool HeatmapBehind = true;
        [InputParameter("Heatmap · Minimum size shown", 64, minimum: 1, maximum: 100000, increment: 1, decimalPlaces: 0)]
        public int HmThreshold = 15;
        [InputParameter("Heatmap · New shade when size changes by (%)", 65, minimum: 5, maximum: 500, increment: 1, decimalPlaces: 0)]
        public int HmReshade = 25;
        [InputParameter("Heatmap · Live levels reach the right edge", 66)]
        public bool HmExtendLive = true;
        [InputParameter("Heatmap · Colour palette", 67, variants: new object[] { "Bookmap", Palette.Bookmap, "Thermal", Palette.Thermal, "Ocean", Palette.Ocean, "Mono", Palette.Mono })]
        public Palette HmPalette = Palette.Bookmap;
        [InputParameter("Heatmap · Contrast", 68, minimum: 0.3, maximum: 3, increment: 0.1, decimalPlaces: 1)]
        public double HmContrast = 1.2;
        [InputParameter("Heatmap · Opacity (%)", 69, minimum: 10, maximum: 100, increment: 1, decimalPlaces: 0)]
        public int HmOpacity = 100;
        [InputParameter("Heatmap · Size tags on the biggest live levels", 70)]
        public bool HmTags = true;
        [InputParameter("Heatmap · How many tags", 71, minimum: 1, maximum: 50, increment: 1, decimalPlaces: 0)]
        public int HmTagCount = 8;
        [InputParameter("Candles · Restyle the candles", 72)]
        public bool ShowCandles = false;
        [InputParameter("Candles · Bullish body", 73)]
        public Color CcBullColor = Color.FromArgb(0x26, 0xA6, 0x9A);
        [InputParameter("Candles · Bearish body", 74)]
        public Color CcBearColor = Color.FromArgb(0x9C, 0x4D, 0xCC);
        [InputParameter("Candles · Bullish wick / outline", 75)]
        public Color CcBullWick = Color.FromArgb(0x26, 0xA6, 0x9A);
        [InputParameter("Candles · Bearish wick / outline", 76)]
        public Color CcBearWick = Color.FromArgb(0x9C, 0x4D, 0xCC);
        [InputParameter("Candles · Doji", 77)]
        public Color CcDojiColor = Color.FromArgb(0x8B, 0x8B, 0x8F);
        [InputParameter("Candles · Body opacity (%)", 78, minimum: 0, maximum: 100, increment: 1, decimalPlaces: 0)]
        public int CcOpacity = 100;
        [InputParameter("Alerts · Trade entered", 79)]
        public bool AlertEntry = true;
        [InputParameter("Alerts · Entry sound", 80)]
        public string EntrySound = "Alert1.wav";
        [InputParameter("Alerts · Added to a trade (scale-in)", 81)]
        public bool AlertFill = false;
        [InputParameter("Alerts · Scale-in sound", 82)]
        public string FillSound = "Alert1.wav";
        [InputParameter("Alerts · Winning trade", 83)]
        public bool AlertWin = true;
        [InputParameter("Alerts · Win sound", 84)]
        public string WinSound = "Alert2.wav";
        [InputParameter("Alerts · Losing trade", 85)]
        public bool AlertLoss = true;
        [InputParameter("Alerts · Loss sound", 86)]
        public string LossSound = "Alert3.wav";
        [InputParameter("Alerts · Daily loss limit (warning and hit)", 87)]
        public bool AlertDll = true;
        [InputParameter("Alerts · Loss limit sound", 88)]
        public string DllSound = "Alert4.wav";
        [InputParameter("Alerts · Warn at (% of the limit used)", 89, minimum: 10, maximum: 99, increment: 1, decimalPlaces: 0)]
        public int DllWarnPercent = 75;
        [InputParameter("Alerts · Profit target hit", 90)]
        public bool AlertTarget = true;
        [InputParameter("Alerts · Target sound", 91)]
        public string TargetSound = "Alert2.wav";
        [InputParameter("Alerts · Profit target ($, 0 = the account's target in RoninFlow)", 92, minimum: 0, maximum: 1000000, increment: 0.1, decimalPlaces: 1)]
        public double ProfitTarget = 0.0;
        [InputParameter("Alerts · Limits count open P&L", 93)]
        public bool AlertIncludeOpen = true;
        [InputParameter("Look · Panel background", 94)]
        public Color BackColor = Color.FromArgb(0x0E, 0x0E, 0x12);
        [InputParameter("Look · Panel border", 95)]
        public Color BorderColor = Color.FromArgb(0x26, 0x26, 0x2E);
        [InputParameter("Look · Tiles", 96)]
        public Color TileColor = Color.FromArgb(0x16, 0x16, 0x1C);
        [InputParameter("Look · Text", 97)]
        public Color TextColor = Color.FromArgb(0xE6, 0xE6, 0xEA);
        [InputParameter("Look · Muted text", 98)]
        public Color MutedColor = Color.FromArgb(0x8A, 0x8A, 0x96);
        [InputParameter("Look · Positive", 99)]
        public Color PositiveColor = Color.FromArgb(0x2B, 0xC4, 0x8A);
        [InputParameter("Look · Negative", 100)]
        public Color NegativeColor = Color.FromArgb(0xE5, 0x48, 0x4D);
        [InputParameter("Look · Warning", 101)]
        public Color WarningColor = Color.FromArgb(0xE8, 0xB0, 0x43);
        [InputParameter("Look · Accent", 102)]
        public Color AccentColor = Color.FromArgb(0x8B, 0x5C, 0xF6);
        [InputParameter("Look · Panel opacity (%)", 103, minimum: 30, maximum: 100, increment: 1, decimalPlaces: 0)]
        public int PanelOpacity = 94;

        private static global::TradingPlatform.BusinessLayer.Core QCore { get { return global::TradingPlatform.BusinessLayer.Core.Instance; } }
        private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };

        private sealed class AcctInfo { public string Tier = "", Color = "", Reason = ""; public int Level, Of, MaxTrades; public double DailyLoss, Trail, Target; public bool Enforced, Enforcing, Blocked, Paused, Manual, InWindow = true; }
        private sealed class GexInfo { public string Index = "", Zone = "", Error = ""; public double Total; public double? Flip, Call, Put, Spot; public bool Delayed; public List<double> Pos = new List<double>(), Neg = new List<double>(); }
        private sealed class EventItem { public long T; public string Impact = "", Ccy = "", Title = ""; }
        private sealed class NewsItem { public string Id = "", Src = "", Title = "", Link = "", Summary = ""; public long T; public int Importance, Dir; }
        private sealed class Snap { public long DayStart; public string MarketLabel = "", Error = ""; public AcctInfo Acct; public GexInfo Gex; public List<EventItem> Events = new List<EventItem>(); public List<NewsItem> News = new List<NewsItem>(); public DateTime Got; }
        private sealed class Trip { public DateTime Open, Close; public double OpenPrice, ClosePrice, Qty, Pnl; public bool Long, Complete; public string Sym, ExitId; }
        private readonly Dictionary<string, HashSet<string>> seenOrders = new Dictionary<string, HashSet<string>>(); // orders that already rang an entry or scale-in
        private sealed class PosRow { public string Account = "", Code = ""; public double Qty, Pnl; }
        private sealed class HmNode { public int Start, End; public double Price, Volume; public bool Active; }

        private volatile Snap snap;
        private System.Threading.Timer timer;
        private int busy, tickCount;
        private string baseUrl = "http://127.0.0.1:5173";
        private readonly HashSet<string> seenNews = new HashSet<string>();
        private bool newsPrimed;
        private readonly List<KeyValuePair<NewsItem, DateTime>> popups = new List<KeyValuePair<NewsItem, DateTime>>();
        private readonly object gate = new object();
        private Account account;
        private List<Trip> trips = new List<Trip>(), chartTrips = new List<Trip>();
        private double dayRealised, dayPeak, grossWin, grossLoss, best, worst, openPnl; private int dayTrades, dayWins, dayLosses;
        private List<PosRow> positions = new List<PosRow>();
        private double lastQty; private bool qtyKnown;
        private bool dllWarned, dllHit, targetHit; private DateTime alertDay = DateTime.MinValue;
        private readonly List<HmNode> hmNodes = new List<HmNode>();
        private readonly Dictionary<double, HmNode> hmLive = new Dictionary<double, HmNode>();
        private readonly object hmLock = new object();

        public RoninFlowSuite() : base()
        {
            Name = "RoninFlow Suite";
            Description = "RoninFlow on your chart: account panel, executions, gamma levels, news, heatmap, candles and alerts.";
            SeparateWindow = false;
            OnBackGround = false;
        }

        protected override void OnInit()
        {
            if (!string.IsNullOrWhiteSpace(ServerUrl)) baseUrl = ServerUrl.Trim().TrimEnd('/');
            QCore.TradeAdded += OnTrade;
            if (Symbol != null) Symbol.NewLevel2 += OnLevel2;
            timer = new System.Threading.Timer(_ => Tick(), null, 500, 1000);
        }

        protected override void OnClear()
        {
            QCore.TradeAdded -= OnTrade;
            if (Symbol != null) Symbol.NewLevel2 -= OnLevel2;
            if (timer != null) { timer.Dispose(); timer = null; }
        }

        protected override void OnUpdate(UpdateArgs args) { }

        // ================================================================== data

        private static double D(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0; }
        private static double? DN(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? (double?)v : null; }
        private static long L(string s) { long v; return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : 0; }

        private static Snap ParseSnap(string text)
        {
            var s = new Snap { Got = DateTime.UtcNow };
            foreach (var raw in text.Split('\n'))
            {
                var c = raw.TrimEnd('\r').Split('\t');
                Func<int, string> at = i => i < c.Length ? c[i] : "";
                switch (at(0))
                {
                    case "RF": s.DayStart = L(at(3)); s.MarketLabel = at(5); break;
                    case "A":
                        s.Acct = new AcctInfo { Tier = at(1), Level = (int)L(at(2)), Of = (int)L(at(3)), Color = at(4), DailyLoss = D(at(5)), Trail = D(at(6)), Target = D(at(7)), MaxTrades = (int)L(at(8)),
                            Enforced = at(9) == "1", Enforcing = at(10) == "1", Blocked = at(11) == "1", Paused = at(12) == "1", Manual = at(13) == "1", InWindow = at(14) != "0", Reason = at(15) };
                        break;
                    case "G": s.Gex = new GexInfo { Index = at(1), Zone = at(2), Total = D(at(3)), Flip = DN(at(4)), Call = DN(at(5)), Put = DN(at(6)), Spot = DN(at(7)), Delayed = at(8) == "1", Error = at(9) }; break;
                    case "P": if (s.Gex != null) s.Gex.Pos.Add(D(at(1))); break;
                    case "Q": if (s.Gex != null) s.Gex.Neg.Add(D(at(1))); break;
                    case "E": s.Events.Add(new EventItem { T = L(at(1)), Impact = at(2), Ccy = at(3), Title = at(4) }); break;
                    case "N": s.News.Add(new NewsItem { Id = at(1), T = L(at(2)), Importance = (int)L(at(3)), Dir = (int)L(at(4)), Src = at(5), Title = at(6), Link = at(7), Summary = at(8) }); break;
                }
            }
            return s;
        }

        private async Task Fetch()
        {
            try
            {
                string symbol = Symbol != null ? Symbol.Name : "";
                string acct = account != null ? (account.Name ?? account.Id) : "";
                var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/api/suite?format=tsv&symbol=" + Uri.EscapeDataString(symbol) + "&account=" + Uri.EscapeDataString(acct));
                if (!string.IsNullOrWhiteSpace(Token)) req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
                var res = await http.SendAsync(req).ConfigureAwait(false);
                res.EnsureSuccessStatusCode();
                var s = ParseSnap(await res.Content.ReadAsStringAsync().ConfigureAwait(false));
                lock (gate)
                {
                    foreach (var n in s.News)
                    {
                        if (!seenNews.Add(n.Id)) continue;
                        if (newsPrimed && ShowPopups && n.Importance >= PopupMinImportance) popups.Insert(0, new KeyValuePair<NewsItem, DateTime>(n, DateTime.UtcNow.AddSeconds(PopupSeconds)));
                    }
                    newsPrimed = true;
                    if (popups.Count > 3) popups.RemoveRange(3, popups.Count - 3);
                }
                snap = s;
            }
            catch (Exception e) { var o = snap; if (o != null) o.Error = e.Message; else snap = new Snap { Error = e.Message, Got = DateTime.UtcNow }; }
        }

        private Account FindAccount()
        {
            var all = QCore.Accounts;
            if (!string.IsNullOrWhiteSpace(AccountName)) return all.FirstOrDefault(a => string.Equals(a.Name, AccountName.Trim(), StringComparison.OrdinalIgnoreCase) || a.Id == AccountName.Trim());
            try
            {
                var chart = CurrentChart;
                var p = chart != null ? chart.GetType().GetProperty("Account") : null;
                var a = p != null ? p.GetValue(chart) as Account : null;
                if (a != null) return a;
            }
            catch { }
            return all.FirstOrDefault();
        }

        private DateTime DayStartUtc()
        {
            var s = snap;
            return s != null && s.DayStart > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(s.DayStart).UtcDateTime : DateTime.Now.Date.ToUniversalTime();
        }

        private static DateTime Utc(DateTime t) { return t.Kind == DateTimeKind.Local ? t.ToUniversalTime() : DateTime.SpecifyKind(t, DateTimeKind.Utc); }

        private static double PnlOf(object o)
        {
            foreach (var name in new[] { "NetPnL", "GrossPnL", "NetPnl", "GrossPnl" })
            {
                try
                {
                    var p = o.GetType().GetProperty(name);
                    if (p == null) continue;
                    var v = p.GetValue(o);
                    if (v == null) continue;
                    if (v is double) return (double)v;
                    var vp = v.GetType().GetProperty("Value");
                    if (vp != null) return Convert.ToDouble(vp.GetValue(v), CultureInfo.InvariantCulture);
                }
                catch { }
            }
            return 0;
        }

        private void Tick()
        {
            try
            {
                account = FindAccount();
                if (tickCount++ % Math.Max(2, RefreshSeconds) == 0 && Interlocked.Exchange(ref busy, 1) == 0)
                    Task.Run(async () => { try { await Fetch(); } finally { Interlocked.Exchange(ref busy, 0); } });
                ComputeTrades();
                RefreshPositions();
                CheckLimits();
                if (ShowHeatmap) PollDepth();
                lock (gate) popups.RemoveAll(p => p.Value < DateTime.UtcNow);
            }
            catch { }
        }

        private List<Trip> Pair(IEnumerable<Trade> trades)
        {
            var res = new List<Trip>();
            foreach (var g in trades.GroupBy(t => t.Symbol != null ? t.Symbol.Name : ""))
            {
                var open = new List<KeyValuePair<Trade, double>>();
                foreach (var t in g.OrderBy(t => Utc(t.DateTime)))
                {
                    double q = t.Side == Side.Buy ? Math.Abs(t.Quantity) : -Math.Abs(t.Quantity);
                    double tickCost = t.Symbol != null && t.Symbol.TickSize > 0 ? t.Symbol.GetTickCost(t.Price) / t.Symbol.TickSize : 1;
                    while (q != 0 && open.Count > 0 && Math.Sign(open[0].Value) != Math.Sign(q))
                    {
                        var head = open[0]; double take = Math.Min(Math.Abs(head.Value), Math.Abs(q)); bool lng = head.Value > 0;
                        double fee = (head.Key.Fee != null ? Math.Abs(head.Key.Fee.Value) : 0) + (t.Fee != null ? Math.Abs(t.Fee.Value) : 0);
                        res.Add(new Trip { Open = Utc(head.Key.DateTime), Close = Utc(t.DateTime), OpenPrice = head.Key.Price, ClosePrice = t.Price, Qty = take, Long = lng, Complete = true, Sym = g.Key, ExitId = t.Id,
                            Pnl = (t.Price - head.Key.Price) * (lng ? 1 : -1) * take * tickCost - fee * take / Math.Max(1, Math.Abs(t.Quantity)) });
                        double left = head.Value - Math.Sign(head.Value) * take;
                        if (left == 0) open.RemoveAt(0); else open[0] = new KeyValuePair<Trade, double>(head.Key, left);
                        q += Math.Sign(head.Value) * take;
                    }
                    if (q != 0) open.Add(new KeyValuePair<Trade, double>(t, q));
                }
                foreach (var o in open) res.Add(new Trip { Open = Utc(o.Key.DateTime), OpenPrice = o.Key.Price, Qty = Math.Abs(o.Value), Long = o.Value > 0, Sym = g.Key });
            }
            return res;
        }

        private void ComputeTrades()
        {
            var a = account;
            if (a == null) return;
            var mine = QCore.Trades.Where(t => t != null && t.Account == a).ToList();
            trips = Pair(mine);
            string sym = Symbol != null ? Symbol.Name : "";
            chartTrips = Pair(mine.Where(t => t.Symbol != null && t.Symbol.Name == sym));
            var from = DayStartUtc();
            double r = 0, peak = 0, gw = 0, gl = 0, bst = 0, wst = 0; int n = 0, w = 0, l = 0;
            foreach (var t in trips.Where(t => t.Complete && t.Close >= from).OrderBy(t => t.Close))
            {
                r += t.Pnl; peak = Math.Max(peak, r); n++;
                if (t.Pnl > 0) { w++; gw += t.Pnl; } else if (t.Pnl < 0) { l++; gl -= t.Pnl; }
                bst = Math.Max(bst, t.Pnl); wst = Math.Min(wst, t.Pnl);
            }
            dayRealised = r; dayPeak = peak; dayTrades = n; dayWins = w; dayLosses = l; grossWin = gw; grossLoss = gl; best = bst; worst = wst;
            openPnl = QCore.Positions.Where(p => p != null && p.Account == a).Sum(p => PnlOf(p));
        }

        private void RefreshPositions()
        {
            positions = QCore.Positions.Where(p => p != null && p.Quantity != 0)
                .Select(p => new PosRow { Account = p.Account != null ? (p.Account.Name ?? p.Account.Id) : "", Code = p.Symbol != null ? p.Symbol.Name : "", Qty = p.Side == Side.Buy ? Math.Abs(p.Quantity) : -Math.Abs(p.Quantity), Pnl = PnlOf(p) })
                .OrderBy(p => p.Account).ThenBy(p => p.Code).ToList();
        }

        private double OpenQty(string sym) { return trips.Where(x => !x.Complete && x.Sym == sym).Sum(x => x.Long ? x.Qty : -x.Qty); }

        private void OnTrade(Trade t)
        {
            try
            {
                if (t == null || account == null || t.Account != account) return;
                string sym = t.Symbol != null ? t.Symbol.Name : "";
                string order = t.OrderId ?? "";
                double before = OpenQty(sym);
                ComputeTrades();
                double now = OpenQty(sym);
                bool flip = before != 0 && now != 0 && Math.Sign(before) != Math.Sign(now);
                string side = now > 0 ? "LONG" : "SHORT";
                if (now != 0 && (before == 0 || flip))
                {
                    // entry: flat → open, or a reversal
                    var seen = new HashSet<string>();
                    if (order.Length > 0) seen.Add(order);
                    seenOrders[sym] = seen;
                    if (AlertEntry) Ring(EntrySound, string.Format(CultureInfo.InvariantCulture, "entered {0} {1} {2} @ {3}", side, Math.Abs(now), sym, t.Price));
                }
                else if (before != 0 && Math.Abs(now) > Math.Abs(before))
                {
                    // scale-in: more on the same side, from an order that hasn't already alerted
                    HashSet<string> seen;
                    if (!seenOrders.TryGetValue(sym, out seen)) seenOrders[sym] = seen = new HashSet<string>();
                    bool freshOrder = order.Length == 0 || seen.Add(order);
                    if (AlertFill && freshOrder)
                        Ring(FillSound, string.Format(CultureInfo.InvariantCulture, "added {0} to {1} {2} @ {3} · now {4}", Math.Abs(now) - Math.Abs(before), side, sym, t.Price, Math.Abs(now)));
                }
                if (now == 0) seenOrders.Remove(sym);
                if (before != 0 && (now == 0 || flip || Math.Abs(now) < Math.Abs(before)))
                {
                    // an exit — a scale-out, the final exit or the closing side of a reversal: this fill's result
                    var closed = trips.Where(x => x.Complete && x.ExitId != null && x.ExitId == t.Id).ToList();
                    if (closed.Count == 0)
                    {
                        var last = trips.Where(x => x.Complete).OrderByDescending(x => x.Close).FirstOrDefault();
                        if (last != null) closed = trips.Where(x => x.Complete && x.Close == last.Close).ToList();
                    }
                    double pnl = closed.Sum(x => x.Pnl);
                    if (pnl > 0 && AlertWin) Ring(WinSound, "win " + Money(pnl, true) + " · day " + Money(dayRealised, true));
                    else if (pnl < 0 && AlertLoss) Ring(LossSound, "loss " + Money(pnl, true) + " · day " + Money(dayRealised, true));
                }
                CheckLimits();
            }
            catch { }
        }

        private void Ring(string sound, string message)
        {
            try
            {
                string path = sound ?? "";
                if (!Path.IsPathRooted(path)) path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media", path);
                if (File.Exists(path)) new System.Media.SoundPlayer(path).Play();
                else System.Media.SystemSounds.Exclamation.Play();
            }
            catch { }
        }

        private double TargetValue() { var s = snap; return ProfitTarget > 0 ? ProfitTarget : s != null && s.Acct != null ? s.Acct.Target : 0; }

        private void CheckLimits()
        {
            var s = snap;
            var day = DayStartUtc();
            if (day != alertDay) { alertDay = day; dllWarned = dllHit = targetHit = false; }
            double now = dayRealised + (AlertIncludeOpen ? openPnl : 0);
            double dll = s != null && s.Acct != null ? s.Acct.DailyLoss : 0;
            if (AlertDll && dll > 0)
            {
                if (!dllHit && now <= -dll) { dllHit = true; Ring(DllSound, "daily loss limit hit: " + Money(now, true)); }
                else if (!dllWarned && !dllHit && now <= -dll * DllWarnPercent / 100.0) { dllWarned = true; Ring(DllSound, DllWarnPercent + "% of the daily loss limit used: " + Money(now, true)); }
            }
            double target = TargetValue();
            if (AlertTarget && target > 0 && !targetHit && now >= target) { targetHit = true; Ring(TargetSound, "profit target hit: " + Money(now, true)); }
        }

        // ================================================================== heatmap: the order book, sampled every second

        // the book as it is now (price → size), kept from the level 2 updates
        private readonly Dictionary<double, double> book = new Dictionary<double, double>();
        private static readonly PropertyInfo closedProp = typeof(Level2Quote).GetProperty("Closed");

        private void OnLevel2(Symbol symbol, Level2Quote q, DOMQuote dom)
        {
            if (q == null) return;
            bool closed = q.Size <= 0;
            try { if (closedProp != null && (bool)closedProp.GetValue(q)) closed = true; } catch { }
            lock (hmLock) { if (closed) book.Remove(q.Price); else book[q.Price] = q.Size; }
        }

        private void PollDepth()
        {
            if (HistoricalData == null) return;
            int bar = Math.Max(0, HistoricalData.Count - 1);
            lock (hmLock)
            {
                var now = book.Where(kv => kv.Value >= HmThreshold).ToDictionary(kv => kv.Key, kv => kv.Value);
                foreach (var k in hmLive.Keys.ToList())
                    if (!now.ContainsKey(k)) { var n = hmLive[k]; n.End = bar; n.Active = false; hmLive.Remove(k); }
                foreach (var kv in now)
                {
                    HmNode n;
                    if (hmLive.TryGetValue(kv.Key, out n))
                    {
                        n.End = bar;
                        double change = n.Volume > 0 ? Math.Abs(kv.Value - n.Volume) / n.Volume * 100 : 100;
                        if (change >= HmReshade && bar > n.Start) { n.Active = false; HmStart(kv.Key, kv.Value, bar); }
                        else n.Volume = kv.Value;
                    }
                    else HmStart(kv.Key, kv.Value, bar);
                }
                if (hmNodes.Count > 6000) hmNodes.RemoveAll(n => !n.Active && n.End < bar - 2000);
            }
        }

        private void HmStart(double price, double vol, int bar) { var n = new HmNode { Start = bar, End = bar, Price = price, Volume = vol, Active = true }; hmLive[price] = n; hmNodes.Add(n); }

        private static Color[] Stops(Palette p)
        {
            switch (p)
            {
                case Palette.Thermal: return new[] { Color.FromArgb(20, 0, 40), Color.FromArgb(90, 10, 120), Color.FromArgb(180, 20, 110), Color.FromArgb(240, 70, 40), Color.FromArgb(255, 160, 20), Color.FromArgb(255, 230, 90), Color.FromArgb(255, 255, 235) };
                case Palette.Ocean: return new[] { Color.FromArgb(5, 15, 40), Color.FromArgb(10, 60, 120), Color.FromArgb(0, 130, 190), Color.FromArgb(40, 200, 220), Color.FromArgb(170, 240, 245), Color.FromArgb(255, 255, 255) };
                case Palette.Mono: return new[] { Color.FromArgb(25, 25, 30), Color.FromArgb(90, 90, 100), Color.FromArgb(170, 170, 180), Color.FromArgb(255, 255, 255) };
                default: return new[] { Color.FromArgb(10, 20, 70), Color.FromArgb(0, 90, 200), Color.FromArgb(0, 190, 230), Color.FromArgb(40, 210, 110), Color.FromArgb(240, 230, 40), Color.FromArgb(255, 140, 0), Color.FromArgb(235, 30, 30), Color.FromArgb(255, 245, 230) };
            }
        }
        private static Color Ramp(Color[] s, double t)
        {
            t = Math.Max(0, Math.Min(1, t)); double pos = t * (s.Length - 1); int k = Math.Min(s.Length - 2, (int)Math.Floor(pos)); double f = pos - k;
            return Color.FromArgb((int)(s[k].R + (s[k + 1].R - s[k].R) * f), (int)(s[k].G + (s[k + 1].G - s[k].G) * f), (int)(s[k].B + (s[k + 1].B - s[k].B) * f));
        }

        // ================================================================== drawing helpers

        private Font fN, fS, fB, fBig; private int fontKey;
        private void Fonts()
        {
            if (fN != null && fontKey == FontSize) return;
            fontKey = FontSize;
            fN = new Font("Segoe UI", FontSize, GraphicsUnit.Pixel); fS = new Font("Segoe UI", FontSize - 1.5f, GraphicsUnit.Pixel);
            fB = new Font("Segoe UI Semibold", FontSize, GraphicsUnit.Pixel); fBig = new Font("Segoe UI Semibold", FontSize + 3, GraphicsUnit.Pixel);
        }
        private static Color A(Color c, int a) { return Color.FromArgb(Math.Max(0, Math.Min(255, a)), c.R, c.G, c.B); }
        private Graphics g;
        private SizeF M(string s, Font f) { return g.MeasureString(s ?? "", f, int.MaxValue, StringFormat.GenericTypographic); }
        private float T(string s, Font f, Color c, float x, float y) { using (var b = new SolidBrush(c)) g.DrawString(s ?? "", f, b, x, y, StringFormat.GenericTypographic); return M(s, f).Width; }
        private string Fit(string s, Font f, float w) { if (M(s, f).Width <= w) return s; while (s.Length > 1 && M(s + "…", f).Width > w) s = s.Substring(0, s.Length - 1); return s + "…"; }
        private List<string> Wrap(string s, Font f, float w, int max)
        {
            var lines = new List<string>(); var cur = "";
            foreach (var word in (s ?? "").Split(' '))
            {
                var next = cur.Length == 0 ? word : cur + " " + word;
                if (M(next, f).Width <= w || cur.Length == 0) cur = next; else { lines.Add(cur); cur = word; if (lines.Count == max) { cur = ""; break; } }
            }
            if (cur.Length > 0 && lines.Count < max) lines.Add(cur);
            return lines;
        }
        private static GraphicsPath RoundPath(RectangleF r, float rad)
        {
            var p = new GraphicsPath(); float d = rad * 2;
            if (rad <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90); p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }
        private void Round(RectangleF r, Color fill, Color? border, float rad = 5)
        {
            using (var p = RoundPath(r, rad)) { using (var b = new SolidBrush(fill)) g.FillPath(b, p); if (border.HasValue) using (var pen = new Pen(border.Value, 1)) g.DrawPath(pen, p); }
        }
        private void Fill(RectangleF r, Color c) { using (var b = new SolidBrush(c)) g.FillRectangle(b, r); }
        private float Chip(string text, Color c, float x, float y, float h)
        {
            float w = M(text, fS).Width + 14; Round(new RectangleF(x, y, w, h), A(c, 40), A(c, 150), h / 2); T(text, fS, c, x + 7, y + (h - M("Ag", fS).Height) / 2); return w;
        }
        private Rectangle area;
        private PointF Place(Corner c, float w, float h, int dx, int dy)
        {
            float l = area.Left, t = area.Top, r = area.Right, b = area.Bottom;
            switch (c)
            {
                case Corner.TopLeft: return new PointF(l + dx, t + dy);
                case Corner.TopRight: return new PointF(r - w - dx, t + dy);
                case Corner.BottomLeft: return new PointF(l + dx, b - h - dy);
                case Corner.BottomRight: return new PointF(r - w - dx, b - h - dy);
                case Corner.TopMiddle: return new PointF(l + (r - l - w) / 2 + dx, t + dy);
                default: return new PointF(l + (r - l - w) / 2 + dx, b - h - dy);
            }
        }
        private void Box(RectangleF r) { Round(r, A(BackColor, (int)(255 * PanelOpacity / 100.0)), BorderColor, 6); }
        private static string Money(double v, bool sign = false) { return (v < 0 ? "-$" : sign && v > 0 ? "+$" : "$") + Math.Abs(v).ToString("N2", CultureInfo.InvariantCulture); }
        private static string Num(double v, bool sign = false) { return (sign && v > 0 ? "+" : "") + v.ToString("0.00", CultureInfo.InvariantCulture); }
        private static string Mask(string id) { return id.Length > 9 ? id.Substring(0, 4) + "•••" + id.Substring(id.Length - 3) : id; }
        private static Color Hex(string h, Color fb) { try { return ColorTranslator.FromHtml(h.StartsWith("#") ? h : "#" + h); } catch { return fb; } }

        private float X(DateTime utc) { return (float)CurrentChart.MainWindow.CoordinatesConverter.GetChartX(utc); }
        private float Y(double price) { return (float)CurrentChart.MainWindow.CoordinatesConverter.GetChartY(price); }
        private int BarOf(DateTime utc)
        {
            int n = HistoricalData.Count;
            if (n == 0) return -1;
            int lo = 0, hi = n - 1;
            Func<int, DateTime> time = i => Utc(HistoricalData[i, SeekOriginHistory.Begin].TimeLeft);
            if (time(0) > utc) return -1;
            while (lo < hi) { int mid = (lo + hi + 1) / 2; if (time(mid) <= utc) lo = mid; else hi = mid - 1; }
            return lo;
        }
        private float BarX(int i) { return X(Utc(HistoricalData[i, SeekOriginHistory.Begin].TimeLeft)) + CurrentChart.BarsWidth / 2f; }

        // ================================================================== rendering

        public override void OnPaintChart(PaintChartEventArgs args)
        {
            base.OnPaintChart(args);
            if (CurrentChart == null || HistoricalData == null) return;
            g = args.Graphics;
            area = CurrentChart.MainWindow.ClientRectangle;
            Fonts();
            var state = g.Save();
            try
            {
                g.SetClip(area);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                var s = snap;
                if (ShowHeatmap) try { DrawHeatmap(); } catch { }
                if (ShowCandles) try { DrawCandles(); } catch { }
                if (ShowGamma && s != null && s.Gex != null && s.Gex.Error.Length == 0) try { DrawGamma(s.Gex); } catch { }
                if (ShowExecutions) try { DrawExecutions(); } catch { }
                if (ShowEventMarkers && s != null) try { DrawEvents(s); } catch { }
                float bottom = 0;
                if (ShowAccount) try { bottom = DrawAccount(s); } catch { }
                if (ShowAllPositions && positions.Count > 0) try { DrawPositions(bottom); } catch { }
                if (ShowNews && s != null) try { DrawNews(s); } catch { }
                if (ShowPopups) try { DrawPopups(); } catch { }
            }
            finally { g.Restore(state); }
        }

        private void DrawCandles()
        {
            int n = HistoricalData.Count;
            float bw = Math.Max(1, CurrentChart.BarsWidth);
            for (int i = n - 1; i >= 0; i--)
            {
                var bar = HistoricalData[i, SeekOriginHistory.Begin] as HistoryItemBar;
                if (bar == null) continue;
                float x = BarX(i);
                if (x < area.Left - bw) break;
                if (x > area.Right + bw) continue;
                bool bull = bar.Close > bar.Open, doji = bar.Close == bar.Open;
                var body = doji ? CcDojiColor : bull ? CcBullColor : CcBearColor;
                var wick = doji ? CcDojiColor : bull ? CcBullWick : CcBearWick;
                float yo = Y(bar.Open), yc = Y(bar.Close), yh = Y(bar.High), yl = Y(bar.Low), top = Math.Min(yo, yc), bot = Math.Max(yo, yc);
                using (var pen = new Pen(wick, 1)) g.DrawLine(pen, x, yh, x, yl);
                if (bw > 2)
                {
                    var r = new RectangleF(x - bw / 2f, top, bw, Math.Max(1, bot - top));
                    Fill(r, A(body, (int)(255 * CcOpacity / 100.0)));
                    using (var pen = new Pen(wick, 1)) g.DrawRectangle(pen, r.X, r.Y, r.Width, r.Height);
                }
            }
        }

        private void DrawGamma(GexInfo gx)
        {
            double tick = Symbol != null && Symbol.TickSize > 0 ? Symbol.TickSize : 0.25;
            var levels = new List<Tuple<double, string, Color>>();
            if (ShowWalls && gx.Call.HasValue) levels.Add(Tuple.Create(gx.Call.Value, "Call wall", CallWallColor));
            if (ShowWalls && gx.Put.HasValue) levels.Add(Tuple.Create(gx.Put.Value, "Put wall", PutWallColor));
            if (ShowFlip && gx.Flip.HasValue) levels.Add(Tuple.Create(gx.Flip.Value, "Gamma flip", FlipColor));
            if (ShowOtherLevels) { foreach (var p in gx.Pos) levels.Add(Tuple.Create(p, "+γ", PosLevelColor)); foreach (var p in gx.Neg) levels.Add(Tuple.Create(p, "−γ", NegLevelColor)); }
            foreach (var lv in levels)
            {
                float y = Y(lv.Item1);
                if (y < area.Top - 40 || y > area.Bottom + 40) continue;
                bool major = lv.Item2.Length > 2;
                if (GammaZones)
                {
                    float h = Math.Max(2, Math.Abs(Y(lv.Item1 + tick * ZoneTicks / 2.0) - Y(lv.Item1 - tick * ZoneTicks / 2.0)));
                    Fill(new RectangleF(area.Left, y - h / 2, area.Width, h), A(lv.Item3, major ? 45 : 25));
                }
                else using (var pen = new Pen(A(lv.Item3, major ? 220 : 140), LevelWidth) { DashStyle = major ? DashStyle.Solid : DashStyle.Dash }) g.DrawLine(pen, area.Left, y, area.Right, y);
                string label = lv.Item2 + " " + lv.Item1.ToString("0.##", CultureInfo.InvariantCulture);
                float w = M(label, fS).Width + 10, h2 = M("Ag", fS).Height + 4;
                float x = LabelSide == LabelSide.Left ? area.Left + 6 : LabelSide == LabelSide.Middle ? area.Left + (area.Width - w) / 2 : area.Right - w - 70;
                Round(new RectangleF(x, y - h2 / 2, w, h2), A(BackColor, 220), A(lv.Item3, 160), 3);
                T(label, fS, lv.Item3, x + 5, y - h2 / 2 + 2);
            }
        }

        private void DrawExecutions()
        {
            var used = new List<RectangleF>();
            var dash = ExecLineStyle == LineKind.Solid ? DashStyle.Solid : ExecLineStyle == LineKind.Dotted ? DashStyle.Dot : DashStyle.Dash;
            foreach (var t in chartTrips)
            {
                int b1 = BarOf(t.Open);
                if (b1 < 0) continue;
                float x1 = BarX(b1), y1 = Y(t.OpenPrice);
                if (t.Complete)
                {
                    int b2 = BarOf(t.Close);
                    float x2 = BarX(b2), y2 = Y(t.ClosePrice);
                    if (ExecConnect) using (var pen = new Pen(t.Pnl >= 0 ? ExecWinColor : ExecLossColor, ExecLineWidth) { DashStyle = dash }) g.DrawLine(pen, x1, y1, x2, y2);
                    Marker(x1, y1, t.Long, t.Qty); Marker(x2, y2, !t.Long, t.Qty);
                    if (ExecShowResult) Result(t, x2, y2, used);
                }
                else Marker(x1, y1, t.Long, t.Qty);
            }
            if (ExecShowAvg)
            {
                var open = chartTrips.Where(t => !t.Complete).ToList();
                double q = open.Sum(t => t.Long ? t.Qty : -t.Qty);
                if (q != 0)
                {
                    double avg = open.Sum(t => t.OpenPrice * t.Qty) / open.Sum(t => t.Qty);
                    float y = Y(avg);
                    using (var pen = new Pen(ExecAvgColor, 1) { DashStyle = DashStyle.Dash }) g.DrawLine(pen, area.Left, y, area.Right, y);
                    string label = (q > 0 ? "LONG " : "SHORT ") + Math.Abs(q) + " avg " + avg.ToString("0.00##", CultureInfo.InvariantCulture);
                    float w = M(label, fS).Width + 10, h = M("Ag", fS).Height + 4, x = area.Right - w - 90;
                    Round(new RectangleF(x, y - h / 2, w, h), A(BackColor, 235), ExecAvgColor, 3); T(label, fS, ExecAvgColor, x + 5, y - h / 2 + 2);
                }
            }
        }

        private void Marker(float x, float y, bool buy, double qty)
        {
            var c = buy ? ExecBuyColor : ExecSellColor;
            float s = ExecSize, h = Math.Max(3, s * 0.9f), half = Math.Max(2, s / 2), d = buy ? 1 : -1, labelY;
            using (var b = new SolidBrush(c)) using (var outline = new Pen(Color.FromArgb(200, 0, 0, 0), 1))
            {
                if (ExecMarker == MarkerStyle.Circles) { g.FillEllipse(b, x - half, y - half, half * 2, half * 2); g.DrawEllipse(outline, x - half, y - half, half * 2, half * 2); labelY = buy ? y + half + 1 : y - half - 1; }
                else
                {
                    if (ExecMarker == MarkerStyle.Arrows) { float sw = Math.Max(2, half / 2); g.FillRectangle(b, x - sw / 2, buy ? y + h : y - 2 * h, sw, h); }
                    var pts = new[] { new PointF(x, y), new PointF(x - half, y + d * h), new PointF(x + half, y + d * h) };
                    g.FillPolygon(b, pts); g.DrawPolygon(outline, pts);
                    labelY = buy ? y + h * (ExecMarker == MarkerStyle.Arrows ? 2 : 1) + 1 : y - h * (ExecMarker == MarkerStyle.Arrows ? 2 : 1) - 1;
                }
            }
            if (ExecShowQty && qty > 0) { string tq = qty.ToString("0.##", CultureInfo.InvariantCulture); var m = M(tq, fS); T(tq, fS, c, x - m.Width / 2, buy ? labelY : labelY - m.Height); }
        }

        private void Result(Trip t, float x, float y, List<RectangleF> used)
        {
            double tick = Symbol != null ? Symbol.TickSize : 0, move = (t.ClosePrice - t.OpenPrice) * (t.Long ? 1 : -1);
            string text = ExecResultUnit == ResultUnit.Ticks && tick > 0 ? (move >= 0 ? "+" : "") + (move / tick).ToString("0.#", CultureInfo.InvariantCulture) + "t"
                : ExecResultUnit == ResultUnit.Points ? (move >= 0 ? "+" : "") + move.ToString("0.##", CultureInfo.InvariantCulture) + " pts" : Money(t.Pnl, true);
            var c = (ExecResultUnit == ResultUnit.Money ? t.Pnl >= 0 : move >= 0) ? ExecWinColor : ExecLossColor;
            var m = M(text, fS); float w = m.Width + 10, h = m.Height + 4, gap = ExecSize + 4; bool exitBuy = !t.Long;
            var box = new RectangleF(x + gap / 2, exitBuy ? y + gap : y - gap - h, w, h);
            for (int k = 0; k < 4 && used.Any(u => u.IntersectsWith(box)); k++) box.Y += exitBuy ? h + 2 : -(h + 2);
            used.Add(box);
            Round(box, A(BackColor, 235), A(c, 200), 3); T(text, fS, c, box.X + 5, box.Y + 2);
        }

        private void DrawHeatmap()
        {
            var stops = Stops(HmPalette);
            float bw = Math.Max(1, CurrentChart.BarsWidth);
            var vis = new List<Tuple<HmNode, float, float, float>>(); List<double> recent;
            lock (hmLock)
            {
                if (hmNodes.Count == 0) return;
                recent = hmNodes.Skip(Math.Max(0, hmNodes.Count - 3000)).Select(n => n.Volume).ToList();
                int last = HistoricalData.Count - 1;
                foreach (var n in hmNodes)
                {
                    float x1 = BarX(Math.Min(n.Start, last)) - bw / 2, x2 = n.Active && HmExtendLive ? area.Right : BarX(Math.Min(n.End, last)) + bw / 2, y = Y(n.Price);
                    if (x2 < area.Left || x1 > area.Right || y < area.Top - 30 || y > area.Bottom + 30) continue;
                    vis.Add(Tuple.Create(n, x1, Math.Max(x2, x1 + 2), y));
                }
            }
            if (vis.Count == 0) return;
            recent.Sort();
            double top = recent[Math.Min(recent.Count - 1, (int)Math.Round((recent.Count - 1) * 0.99))];
            double lo = Math.Log10(1 + HmThreshold), hi = Math.Max(Math.Log10(1 + top), lo + 0.3);
            Func<double, double> heat = v => Math.Pow(Math.Max(0, Math.Min(1, (Math.Log10(1 + v) - lo) / (hi - lo))), HmContrast);
            double tick = Symbol != null && Symbol.TickSize > 0 ? Symbol.TickSize : 0.25;
            float rowH = Math.Max(1, Math.Abs(Y(vis[0].Item1.Price) - Y(vis[0].Item1.Price + tick)));
            var sm = g.SmoothingMode; g.SmoothingMode = SmoothingMode.None;
            foreach (var v in vis.OrderBy(v => v.Item1.Volume))
            {
                double t = heat(v.Item1.Volume); var c = Ramp(stops, t);
                int a = (int)Math.Round(255 * (0.10 + 0.90 * Math.Pow(t, 1.35)) * HmOpacity / 100.0);
                float w = v.Item3 - v.Item2, halo = rowH + Math.Max(3, rowH) * (float)(0.6 + 0.8 * t);
                using (var lg = new LinearGradientBrush(new RectangleF(v.Item2, v.Item4 - halo, w, halo + 0.5f), A(c, 0), A(c, a / 2), LinearGradientMode.Vertical)) g.FillRectangle(lg, v.Item2, v.Item4 - halo, w, halo);
                using (var lg = new LinearGradientBrush(new RectangleF(v.Item2, v.Item4 - 0.5f, w, halo + 0.5f), A(c, a / 2), A(c, 0), LinearGradientMode.Vertical)) g.FillRectangle(lg, v.Item2, v.Item4, w, halo);
                Fill(new RectangleF(v.Item2, v.Item4 - rowH / 2, w, Math.Max(1, rowH)), A(c, a));
                if (t > 0.35) Fill(new RectangleF(v.Item2, v.Item4 - Math.Max(1, rowH * 0.2f), w, Math.Max(1, rowH * 0.4f)), A(Color.White, (int)(a * Math.Min(0.6, (t - 0.35) * 0.9))));
            }
            g.SmoothingMode = sm;
            if (HmTags)
            {
                var used = new List<RectangleF>();
                foreach (var v in vis.Where(v => v.Item1.Active).OrderByDescending(v => v.Item1.Volume))
                {
                    if (used.Count >= HmTagCount) break;
                    string text = v.Item1.Volume.ToString("N0", CultureInfo.InvariantCulture); var m = M(text, fS);
                    var r = new RectangleF(area.Right - m.Width - 18, v.Item4 - m.Height / 2 - 2, m.Width + 10, m.Height + 4);
                    if (used.Any(u => u.IntersectsWith(r))) continue;
                    used.Add(r);
                    Fill(r, Color.FromArgb(215, 8, 8, 10)); Fill(new RectangleF(r.X, r.Y + 2, 2, r.Height - 4), Ramp(stops, heat(v.Item1.Volume)));
                    T(text, fS, Color.White, r.X + 6, r.Y + 2);
                }
            }
        }

        private void DrawEvents(Snap s)
        {
            float bottom = area.Bottom;
            foreach (var e in s.Events)
            {
                if (EventMinImpact == EventLevel.HighOnly && e.Impact != "high") continue;
                if (EventMinImpact == EventLevel.MediumAndHigh && e.Impact == "low") continue;
                float x = X(DateTimeOffset.FromUnixTimeMilliseconds(e.T).UtcDateTime);
                if (x < area.Left || x > area.Right) continue;
                var c = e.Impact == "high" ? NegativeColor : e.Impact == "medium" ? WarningColor : MutedColor;
                using (var pen = new Pen(A(c, 90), 1) { DashStyle = DashStyle.Dot }) g.DrawLine(pen, x, area.Top, x, bottom - 18);
                string tag = e.Impact == "high" ? "HIGH" : e.Impact == "medium" ? "MED" : "LOW"; var m = M(tag, fS);
                var r = new RectangleF(x - m.Width / 2 - 5, bottom - m.Height - 6, m.Width + 10, m.Height + 4);
                Round(r, A(c, 70), c, 3); T(tag, fS, Color.White, r.X + 5, r.Y + 2);
            }
        }

        private float DrawAccount(Snap s)
        {
            var acct = s != null ? s.Acct : null;
            float w = AccountWidth, pad = 10, lh = M("Ag", fN).Height, sh = M("Ag", fS).Height, bh = M("Ag", fBig).Height;
            float chipH = sh + 8, tileH = sh + bh + 14, statRowH = sh + lh + 10;
            var gx = s != null ? s.Gex : null;
            double price = HistoricalData.Count > 0 ? ((HistoryItemBar)HistoricalData[HistoricalData.Count - 1, SeekOriginHistory.Begin]).Close : 0;
            string gammaText = null; var gammaColor = MutedColor;
            if (gx != null && gx.Error.Length == 0)
            {
                bool? pos = gx.Flip.HasValue && price > 0 ? price >= gx.Flip.Value : gx.Zone.Length > 0 ? (bool?)(gx.Zone == "positive") : null;
                if (pos.HasValue) { gammaText = pos.Value ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending"; gammaColor = pos.Value ? PositiveColor : NegativeColor; }
            }
            bool chips = (ShowTierChip && acct != null && acct.Tier.Length > 0) || (ShowGammaChip && gammaText != null);
            bool blocked = acct != null && acct.Blocked;
            var blockLines = blocked ? Wrap("New orders blocked — " + (acct.Reason.Length > 0 ? acct.Reason : "a risk rule is broken"), fS, w - pad * 2 - 14, 3) : new List<string>();
            double dll = acct != null ? acct.DailyLoss : 0, target = TargetValue();
            int cols = w >= 270 ? 4 : 2;
            float h = pad + lh + pad;
            if (chips) h += chipH + 8;
            if (blocked) h += blockLines.Count * (sh + 2) + 16;
            if (ShowPnlTiles) h += tileH + 8;
            if (ShowBuffer && (dll > 0 || target > 0)) h += sh + 6 + 10 + sh + 10;
            if (ShowStats && dayTrades > 0) h += statRowH * (8 / cols) + 2;
            if (ShowGexLine && gx != null) h += lh + 10;
            var p = Place(AccountPlacement, w, h, AccountX, AccountY);
            var rect = new RectangleF(p.X, p.Y, w, h);
            Box(rect);
            float x = p.X + pad, y = p.Y + pad;
            float cx = x + T("Ronin", fB, TextColor, x, y); cx += T("Flow", fB, AccentColor, cx, y) + 8;
            T(account != null ? Mask(account.Name ?? account.Id) : "no account", fN, MutedColor, cx, y);
            string state = s == null || (DateTime.UtcNow - s.Got).TotalSeconds > 20 || s.Error.Length > 0 ? "offline" : blocked ? "blocked" : acct != null && acct.Paused ? "rules paused" : acct != null && acct.Enforcing ? "enforcing" : "live";
            var stc = state == "offline" ? MutedColor : state == "blocked" ? NegativeColor : state == "rules paused" ? WarningColor : PositiveColor;
            float sw = M(state, fS).Width;
            T(state, fS, MutedColor, rect.Right - pad - sw, y + (lh - sh) / 2);
            using (var b = new SolidBrush(stc)) g.FillEllipse(b, rect.Right - pad - sw - 11, y + lh / 2 - 3, 6, 6);
            y += lh + pad;
            using (var pen = new Pen(BorderColor, 1)) g.DrawLine(pen, rect.Left + 1, y - pad / 2, rect.Right - 1, y - pad / 2);
            if (chips)
            {
                float chx = x;
                if (ShowTierChip && acct != null && acct.Tier.Length > 0) chx += Chip("● Tier " + acct.Tier + " " + (acct.Level + 1) + "/" + Math.Max(1, acct.Of), Hex(acct.Color, AccentColor), chx, y, chipH) + 6;
                if (ShowGammaChip && gammaText != null) Chip(Fit(gammaText, fS, rect.Right - pad - chx - 14), gammaColor, chx, y, chipH);
                y += chipH + 8;
            }
            if (blocked)
            {
                float bhh = blockLines.Count * (sh + 2) + 10;
                Round(new RectangleF(x, y, w - pad * 2, bhh), A(NegativeColor, 30), A(NegativeColor, 120), 4);
                float ty = y + 5; foreach (var l in blockLines) { T(l, fS, NegativeColor, x + 7, ty); ty += sh + 2; }
                y += bhh + 6;
            }
            if (ShowPnlTiles)
            {
                float tw = (w - pad * 2 - 12) / 3;
                var tiles = new[] { Tuple.Create("OPEN", Num(openPnl, true), openPnl), Tuple.Create("CLOSED", Num(dayRealised, true), dayRealised), Tuple.Create("TRADES", acct != null && acct.MaxTrades > 0 ? dayTrades + " / " + acct.MaxTrades : dayTrades.ToString(CultureInfo.InvariantCulture), 0.0) };
                for (int i = 0; i < 3; i++)
                {
                    var tr = new RectangleF(x + i * (tw + 6), y, tw, tileH);
                    var tone = tiles[i].Item3 > 0 ? PositiveColor : tiles[i].Item3 < 0 ? NegativeColor : Color.Empty;
                    Round(tr, tone.IsEmpty ? TileColor : A(tone, 40), tone.IsEmpty ? BorderColor : A(tone, 110), 5);
                    T(tiles[i].Item1, fS, MutedColor, tr.X + 8, tr.Y + 5);
                    T(tiles[i].Item2, fBig, tone.IsEmpty ? TextColor : tone, tr.X + 8, tr.Y + 7 + sh);
                }
                y += tileH + 8;
            }
            if (ShowBuffer && (dll > 0 || target > 0))
            {
                double now = dayRealised + (BufferClosedOnly ? 0 : openPnl), trail = acct != null ? acct.Trail : 0;
                double stop = dll > 0 ? (trail > 0 ? Math.Max(-dll, dayPeak - trail) : -dll) : 0;
                string left = dll > 0 ? (BufferClosedOnly ? "Buffer to loss limit (closed)" : "Buffer to loss limit") : "To profit target";
                string right = dll > 0 ? Money(Math.Max(0, now - stop)) + " of " + Money(dll) : target - now > 0 ? Money(target - now) + " to go" : "hit";
                T(left, fS, MutedColor, x, y);
                T(right, fS, dll > 0 && now - stop <= dll * 0.25 ? NegativeColor : TextColor, rect.Right - pad - M(right, fS).Width, y);
                y += sh + 6;
                var bar = new RectangleF(x, y, w - pad * 2, 6);
                double lo = dll > 0 ? -dll : Math.Min(Math.Min(0, now), -target / 2), hi = Math.Max(Math.Max(dayPeak, now), target > 0 ? target : dll * 0.5);
                if (hi <= lo) hi = lo + 1;
                Func<double, float> BX = v => bar.X + (float)((Math.Max(lo, Math.Min(hi, v)) - lo) / (hi - lo)) * bar.Width;
                using (var lg = new LinearGradientBrush(new RectangleF(bar.X - 1, bar.Y, bar.Width + 2, bar.Height), A(NegativeColor, 90), A(PositiveColor, 90), LinearGradientMode.Horizontal)) using (var path = RoundPath(bar, 3)) g.FillPath(lg, path);
                if (dll > 0) Fill(new RectangleF(BX(stop) - 1, bar.Y - 2, 2, bar.Height + 4), NegativeColor);
                if (target > 0) Fill(new RectangleF(Math.Min(bar.Right - 2, BX(target)) - 1, bar.Y - 2, 2, bar.Height + 4), PositiveColor);
                Fill(new RectangleF(BX(now) - 1, bar.Y - 3, 3, bar.Height + 6), Color.White);
                y += 10;
                if (dll > 0) T("stop " + Num(stop, true), fS, MutedColor, x, y);
                string hiT = "high " + Num(dayPeak, true);
                if (target > 0) { string tt = "target " + Num(target, true); T(tt, fS, PositiveColor, rect.Right - pad - M(tt, fS).Width, y); T(hiT, fS, MutedColor, x + (w - pad * 2 - M(hiT, fS).Width) / 2, y); }
                else T(hiT, fS, MutedColor, rect.Right - pad - M(hiT, fS).Width, y);
                y += sh + 10;
            }
            if (ShowStats && dayTrades > 0)
            {
                double wr = (double)dayWins / dayTrades, aw = dayWins > 0 ? grossWin / dayWins : 0, al = dayLosses > 0 ? grossLoss / dayLosses : 0;
                double pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0, ev = dayRealised / dayTrades, edge = al > 0 ? wr * aw / al : 0;
                var cells = new[]
                {
                    Tuple.Create("Win rate", (wr * 100).ToString("0", CultureInfo.InvariantCulture) + "%", TextColor), Tuple.Create("Profit f.", pf.ToString("0.00", CultureInfo.InvariantCulture), pf >= 1 ? PositiveColor : NegativeColor),
                    Tuple.Create("EV", Num(ev, true), ev >= 0 ? PositiveColor : NegativeColor), Tuple.Create("Edge", edge.ToString("0.00", CultureInfo.InvariantCulture), edge >= 0.75 ? PositiveColor : edge >= 0.5 ? WarningColor : NegativeColor),
                    Tuple.Create("Avg win", aw.ToString("0.00", CultureInfo.InvariantCulture), PositiveColor), Tuple.Create("Avg loss", al.ToString("0.00", CultureInfo.InvariantCulture), NegativeColor),
                    Tuple.Create("Best", Num(best, true), PositiveColor), Tuple.Create("Worst", Num(worst, true), NegativeColor),
                };
                float cw = (w - pad * 2) / cols;
                for (int i = 0; i < 8; i++) { float sx = x + (i % cols) * cw, sy = y + (i / cols) * statRowH; T(cells[i].Item1, fS, MutedColor, sx, sy + 3); T(cells[i].Item2, fB, cells[i].Item3, sx, sy + 4 + sh); }
                y += statRowH * (8 / cols) + 2;
            }
            if (ShowGexLine && gx != null)
            {
                string t = gx.Error.Length > 0 ? "GEX: " + gx.Error : gx.Index + " GEX " + (gx.Total >= 0 ? "+" : "-") + "$" + (Math.Abs(gx.Total) / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + "B" + (gx.Flip.HasValue ? " · flip " + gx.Flip.Value.ToString("0.##", CultureInfo.InvariantCulture) : "") + (gx.Delayed ? " · delayed" : "");
                T(Fit(t, fN, w - pad * 2), fN, gx.Total >= 0 ? PositiveColor : NegativeColor, x, y + 2);
            }
            return rect.Bottom;
        }

        private void DrawPositions(float top)
        {
            var rows = positions;
            float pad = 8, lh = M("Ag", fN).Height, rowH = lh + 5, w = AccountWidth, h = pad * 2 + rows.Count * rowH;
            var p = Place(AccountPlacement, w, h, AccountX, AccountY);
            bool below = AccountPlacement == Corner.TopLeft || AccountPlacement == Corner.TopRight || AccountPlacement == Corner.TopMiddle;
            float y0 = ShowAccount ? (below ? top + 6 : p.Y - h - 6) : p.Y;
            var r = new RectangleF(p.X, y0, w, h);
            Box(r);
            float y = y0 + pad;
            foreach (var row in rows)
            {
                T(Mask(row.Account), fN, MutedColor, r.X + pad, y);
                T((row.Qty > 0 ? "LONG " : "SHORT ") + Math.Abs(row.Qty).ToString("0.##", CultureInfo.InvariantCulture) + " " + row.Code, fB, row.Qty > 0 ? PositiveColor : NegativeColor, r.X + w * 0.38f, y);
                string pnl = Num(row.Pnl, true);
                T(pnl, fB, row.Pnl >= 0 ? PositiveColor : NegativeColor, r.Right - pad - M(pnl, fB).Width, y);
                y += rowH;
            }
        }

        private void DrawNews(Snap s)
        {
            var items = s.News.Where(n => n.Importance >= NewsMinImportance).Take(NewsRows).ToList();
            float w = NewsWidth, pad = 10, lh = M("Ag", fN).Height, sh = M("Ag", fS).Height, rowH = lh + sh + 10;
            float h = pad + lh + 8 + Math.Max(1, items.Count) * rowH + 2;
            var p = Place(NewsPlacement, w, h, NewsX, NewsY);
            var r = new RectangleF(p.X, p.Y, w, h);
            Box(r);
            float x = r.X + pad, y = r.Y + pad;
            T("News" + (s.MarketLabel.Length > 0 ? " · " + s.MarketLabel : ""), fB, TextColor, x, y);
            y += lh + 8;
            if (items.Count == 0) { T("No headlines yet", fS, MutedColor, x, y); return; }
            foreach (var n in items)
            {
                var c = n.Importance >= 3 ? NegativeColor : n.Importance >= 2 ? WarningColor : MutedColor;
                Fill(new RectangleF(r.X + 1, y + 2, 2, rowH - 6), c);
                string meta = DateTimeOffset.FromUnixTimeMilliseconds(n.T).LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture) + " · " + n.Src + (n.Dir > 0 ? " · ↑" : n.Dir < 0 ? " · ↓" : "");
                T(meta, fS, n.Dir > 0 ? PositiveColor : n.Dir < 0 ? NegativeColor : MutedColor, x, y);
                T(Fit(n.Title, fN, w - pad * 2), fN, TextColor, x, y + sh + 2);
                y += rowH;
            }
        }

        private void DrawPopups()
        {
            List<KeyValuePair<NewsItem, DateTime>> list; lock (gate) list = popups.ToList();
            float w = 340, pad = 10, lh = M("Ag", fN).Height, sh = M("Ag", fS).Height, offset = 0;
            foreach (var kv in list)
            {
                var n = kv.Key; var lines = Wrap(n.Title, fB, w - pad * 2, 3);
                float h = pad * 2 + sh + 4 + lines.Count * (lh + 2);
                var p = Place(PopupPlacement, w, h, PopupX, PopupY);
                bool top = PopupPlacement == Corner.TopLeft || PopupPlacement == Corner.TopRight || PopupPlacement == Corner.TopMiddle;
                var r = new RectangleF(p.X, top ? p.Y + offset : p.Y - offset, w, h);
                var c = n.Importance >= 3 ? NegativeColor : n.Importance >= 2 ? WarningColor : AccentColor;
                Box(r); Fill(new RectangleF(r.X + 1, r.Y + 1, 3, r.Height - 2), c);
                T((n.Importance >= 3 ? "HIGH IMPACT · " : "") + n.Src, fS, c, r.X + pad + 2, r.Y + pad);
                float y = r.Y + pad + sh + 4; foreach (var l in lines) { T(l, fB, TextColor, r.X + pad + 2, y); y += lh + 2; }
                offset += h + 8;
            }
        }
    }
}
