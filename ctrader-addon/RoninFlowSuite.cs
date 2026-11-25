// RoninFlow Suite — cTrader indicator (cTrader 5 or newer).
//
// RoninFlow on your chart, each part switched on or off in the indicator's parameters: the account panel (risk tier,
// gamma regime, today's P&L, buffer to the profit target, trade stats, GEX line, open positions on every symbol),
// your trades on the chart, gamma levels, the news feed (click a headline to read it) with pop-ups and today's economic
// events, a DOM heatmap, candle colours and alerts with sounds.
//
// Install: npm run addon:ctrader puts the code on your clipboard → cTrader → Algo → Indicators → New → paste → Build.
// Then add it to a chart. It reads RoninFlow on this PC (http://127.0.0.1:5173) unless you set another address.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Indicators
{
    public enum Corner { TopLeft, TopRight, BottomLeft, BottomRight, TopMiddle, BottomMiddle }
    public enum MarkerStyle { Triangles, Arrows, Circles }
    public enum LineKind { Solid, Dashed, Dotted }
    public enum ResultUnit { Money, Ticks, Points }
    public enum LabelSide { Left, Middle, Right }
    public enum EventLevel { AllEvents, MediumAndHigh, HighOnly }
    public enum Palette { Bookmap, Thermal, Ocean, Mono }

    [Indicator(IsOverlay = true, AccessRights = AccessRights.None, TimeZone = TimeZones.UTC)]
    public class RoninFlowSuite : Indicator
    {
        [Parameter("RoninFlow address (empty = this PC / the sync settings file)", Group = "General", DefaultValue = "")]
        public string ServerUrl { get; set; }
        [Parameter("Token (RoninFlow on another computer only)", Group = "General", DefaultValue = "")]
        public string Token { get; set; }
        [Parameter("Account (empty = the chart's account)", Group = "General", DefaultValue = "")]
        public string AccountName { get; set; }
        [Parameter("Refresh every (seconds)", Group = "General", DefaultValue = 3, MinValue = 2, MaxValue = 60)]
        public int RefreshSeconds { get; set; }
        [Parameter("Text size", Group = "General", DefaultValue = 11, MinValue = 7, MaxValue = 20)]
        public int FontSize { get; set; }
        [Parameter("Show the account panel", Group = "Account panel", DefaultValue = true)]
        public bool ShowAccount { get; set; }
        [Parameter("Account panel: Placement", Group = "Account panel", DefaultValue = Corner.TopRight)]
        public Corner AccountPlacement { get; set; }
        [Parameter("Account panel: X offset", Group = "Account panel", DefaultValue = 12, MinValue = -3000, MaxValue = 3000)]
        public int AccountX { get; set; }
        [Parameter("Account panel: Y offset", Group = "Account panel", DefaultValue = 12, MinValue = -3000, MaxValue = 3000)]
        public int AccountY { get; set; }
        [Parameter("Account panel: Width", Group = "Account panel", DefaultValue = 320, MinValue = 180, MaxValue = 700)]
        public int AccountWidth { get; set; }
        [Parameter("Risk tier chip", Group = "Account panel", DefaultValue = true)]
        public bool ShowTierChip { get; set; }
        [Parameter("Gamma regime chip", Group = "Account panel", DefaultValue = true)]
        public bool ShowGammaChip { get; set; }
        [Parameter("P&L tiles", Group = "Account panel", DefaultValue = true)]
        public bool ShowPnlTiles { get; set; }
        [Parameter("Buffer bar (loss limit to profit target)", Group = "Account panel", DefaultValue = true)]
        public bool ShowBuffer { get; set; }
        [Parameter("Buffer bar moves with closed P&L only", Group = "Account panel", DefaultValue = false)]
        public bool BufferClosedOnly { get; set; }
        [Parameter("Trade stats (click to collapse)", Group = "Account panel", DefaultValue = true)]
        public bool ShowStats { get; set; }
        [Parameter("GEX line", Group = "Account panel", DefaultValue = true)]
        public bool ShowGexLine { get; set; }
        [Parameter("Open positions on every account", Group = "Account panel", DefaultValue = true)]
        public bool ShowAllPositions { get; set; }
        [Parameter("Show your executions", Group = "Executions", DefaultValue = true)]
        public bool ShowExecutions { get; set; }
        [Parameter("Marker style", Group = "Executions", DefaultValue = MarkerStyle.Triangles)]
        public MarkerStyle ExecMarker { get; set; }
        [Parameter("Marker size", Group = "Executions", DefaultValue = 10, MinValue = 4, MaxValue = 40)]
        public int ExecSize { get; set; }
        [Parameter("Buy colour", Group = "Executions", DefaultValue = "#2BC48A")]
        public Color ExecBuyColor { get; set; }
        [Parameter("Sell colour", Group = "Executions", DefaultValue = "#E5484D")]
        public Color ExecSellColor { get; set; }
        [Parameter("Quantity next to each marker", Group = "Executions", DefaultValue = true)]
        public bool ExecShowQty { get; set; }
        [Parameter("Join entry and exit with a line", Group = "Executions", DefaultValue = true)]
        public bool ExecConnect { get; set; }
        [Parameter("Winning trade line", Group = "Executions", DefaultValue = "#2BC48A")]
        public Color ExecWinColor { get; set; }
        [Parameter("Losing trade line", Group = "Executions", DefaultValue = "#E5484D")]
        public Color ExecLossColor { get; set; }
        [Parameter("Executions: Line width", Group = "Executions", DefaultValue = 1, MinValue = 1, MaxValue = 8)]
        public int ExecLineWidth { get; set; }
        [Parameter("Line style", Group = "Executions", DefaultValue = LineKind.Dashed)]
        public LineKind ExecLineStyle { get; set; }
        [Parameter("Result at the exit", Group = "Executions", DefaultValue = true)]
        public bool ExecShowResult { get; set; }
        [Parameter("Result in", Group = "Executions", DefaultValue = ResultUnit.Money)]
        public ResultUnit ExecResultUnit { get; set; }
        [Parameter("Open position average price line", Group = "Executions", DefaultValue = true)]
        public bool ExecShowAvg { get; set; }
        [Parameter("Average price line colour", Group = "Executions", DefaultValue = "#E8B043")]
        public Color ExecAvgColor { get; set; }
        [Parameter("Show gamma levels", Group = "Gamma", DefaultValue = true)]
        public bool ShowGamma { get; set; }
        [Parameter("Zones instead of lines", Group = "Gamma", DefaultValue = false)]
        public bool GammaZones { get; set; }
        [Parameter("Zone height (ticks)", Group = "Gamma", DefaultValue = 8, MinValue = 1, MaxValue = 200)]
        public int ZoneTicks { get; set; }
        [Parameter("Gamma flip", Group = "Gamma", DefaultValue = true)]
        public bool ShowFlip { get; set; }
        [Parameter("Call and put walls", Group = "Gamma", DefaultValue = true)]
        public bool ShowWalls { get; set; }
        [Parameter("Other big strikes", Group = "Gamma", DefaultValue = true)]
        public bool ShowOtherLevels { get; set; }
        [Parameter("Level names", Group = "Gamma", DefaultValue = LabelSide.Right)]
        public LabelSide LabelSide { get; set; }
        [Parameter("Call wall", Group = "Gamma", DefaultValue = "#2BC48A")]
        public Color CallWallColor { get; set; }
        [Parameter("Put wall", Group = "Gamma", DefaultValue = "#E5484D")]
        public Color PutWallColor { get; set; }
        [Parameter("Gamma flip colour", Group = "Gamma", DefaultValue = "#E8B043")]
        public Color FlipColor { get; set; }
        [Parameter("Positive strikes", Group = "Gamma", DefaultValue = "#2BC48A")]
        public Color PosLevelColor { get; set; }
        [Parameter("Negative strikes", Group = "Gamma", DefaultValue = "#E5484D")]
        public Color NegLevelColor { get; set; }
        [Parameter("Gamma: Line width", Group = "Gamma", DefaultValue = 1, MinValue = 1, MaxValue = 6)]
        public int LevelWidth { get; set; }
        [Parameter("Show the news feed (click the title to collapse)", Group = "News", DefaultValue = true)]
        public bool ShowNews { get; set; }
        [Parameter("News: Placement", Group = "News", DefaultValue = Corner.TopLeft)]
        public Corner NewsPlacement { get; set; }
        [Parameter("News: X offset", Group = "News", DefaultValue = 12, MinValue = -3000, MaxValue = 3000)]
        public int NewsX { get; set; }
        [Parameter("News: Y offset", Group = "News", DefaultValue = 12, MinValue = -3000, MaxValue = 3000)]
        public int NewsY { get; set; }
        [Parameter("News: Width", Group = "News", DefaultValue = 360, MinValue = 200, MaxValue = 800)]
        public int NewsWidth { get; set; }
        [Parameter("Headlines", Group = "News", DefaultValue = 6, MinValue = 1, MaxValue = 20)]
        public int NewsRows { get; set; }
        [Parameter("Only headlines at least this important (0-3)", Group = "News", DefaultValue = 0, MinValue = 0, MaxValue = 3)]
        public int NewsMinImportance { get; set; }
        [Parameter("Pop-ups for new headlines", Group = "News", DefaultValue = true)]
        public bool ShowPopups { get; set; }
        [Parameter("Pop-up placement", Group = "News", DefaultValue = Corner.BottomRight)]
        public Corner PopupPlacement { get; set; }
        [Parameter("Pop-up X offset", Group = "News", DefaultValue = 12, MinValue = -3000, MaxValue = 3000)]
        public int PopupX { get; set; }
        [Parameter("Pop-up Y offset", Group = "News", DefaultValue = 40, MinValue = -3000, MaxValue = 3000)]
        public int PopupY { get; set; }
        [Parameter("Pop-up shows for (seconds)", Group = "News", DefaultValue = 12, MinValue = 3, MaxValue = 120)]
        public int PopupSeconds { get; set; }
        [Parameter("Pop-ups only at least this important (0-3)", Group = "News", DefaultValue = 2, MinValue = 0, MaxValue = 3)]
        public int PopupMinImportance { get; set; }
        [Parameter("Today's economic events on the time axis", Group = "News", DefaultValue = true)]
        public bool ShowEventMarkers { get; set; }
        [Parameter("Events shown", Group = "News", DefaultValue = EventLevel.MediumAndHigh)]
        public EventLevel EventMinImpact { get; set; }
        [Parameter("Show the DOM heatmap", Group = "Heatmap", DefaultValue = false)]
        public bool ShowHeatmap { get; set; }
        [Parameter("Draw behind the candles", Group = "Heatmap", DefaultValue = true)]
        public bool HeatmapBehind { get; set; }
        [Parameter("Minimum size shown", Group = "Heatmap", DefaultValue = 15, MinValue = 1, MaxValue = 100000)]
        public int HmThreshold { get; set; }
        [Parameter("New shade when size changes by (%)", Group = "Heatmap", DefaultValue = 25, MinValue = 5, MaxValue = 500)]
        public int HmReshade { get; set; }
        [Parameter("Live levels reach the right edge", Group = "Heatmap", DefaultValue = true)]
        public bool HmExtendLive { get; set; }
        [Parameter("Colour palette", Group = "Heatmap", DefaultValue = Palette.Bookmap)]
        public Palette HmPalette { get; set; }
        [Parameter("Contrast", Group = "Heatmap", DefaultValue = 1.2, MinValue = 0.3, MaxValue = 3)]
        public double HmContrast { get; set; }
        [Parameter("Opacity (%)", Group = "Heatmap", DefaultValue = 100, MinValue = 10, MaxValue = 100)]
        public int HmOpacity { get; set; }
        [Parameter("Size tags on the biggest live levels", Group = "Heatmap", DefaultValue = true)]
        public bool HmTags { get; set; }
        [Parameter("How many tags", Group = "Heatmap", DefaultValue = 8, MinValue = 1, MaxValue = 50)]
        public int HmTagCount { get; set; }
        [Parameter("Restyle the candles", Group = "Candles", DefaultValue = false)]
        public bool ShowCandles { get; set; }
        [Parameter("Bullish body", Group = "Candles", DefaultValue = "#26A69A")]
        public Color CcBullColor { get; set; }
        [Parameter("Bearish body", Group = "Candles", DefaultValue = "#9C4DCC")]
        public Color CcBearColor { get; set; }
        [Parameter("Bullish wick / outline", Group = "Candles", DefaultValue = "#26A69A")]
        public Color CcBullWick { get; set; }
        [Parameter("Bearish wick / outline", Group = "Candles", DefaultValue = "#9C4DCC")]
        public Color CcBearWick { get; set; }
        [Parameter("Doji", Group = "Candles", DefaultValue = "#8B8B8F")]
        public Color CcDojiColor { get; set; }
        [Parameter("Body opacity (%)", Group = "Candles", DefaultValue = 100, MinValue = 0, MaxValue = 100)]
        public int CcOpacity { get; set; }
        [Parameter("Trade entered", Group = "Alerts", DefaultValue = true)]
        public bool AlertEntry { get; set; }
        [Parameter("Entry sound", Group = "Alerts", DefaultValue = "Alert1.wav")]
        public string EntrySound { get; set; }
        [Parameter("Added to a trade (scale-in)", Group = "Alerts", DefaultValue = false)]
        public bool AlertFill { get; set; }
        [Parameter("Scale-in sound", Group = "Alerts", DefaultValue = "Alert1.wav")]
        public string FillSound { get; set; }
        [Parameter("Winning trade", Group = "Alerts", DefaultValue = true)]
        public bool AlertWin { get; set; }
        [Parameter("Win sound", Group = "Alerts", DefaultValue = "Alert2.wav")]
        public string WinSound { get; set; }
        [Parameter("Losing trade", Group = "Alerts", DefaultValue = true)]
        public bool AlertLoss { get; set; }
        [Parameter("Loss sound", Group = "Alerts", DefaultValue = "Alert3.wav")]
        public string LossSound { get; set; }
        [Parameter("Daily loss limit (warning and hit)", Group = "Alerts", DefaultValue = true)]
        public bool AlertDll { get; set; }
        [Parameter("Loss limit sound", Group = "Alerts", DefaultValue = "Alert4.wav")]
        public string DllSound { get; set; }
        [Parameter("Warn at (% of the limit used)", Group = "Alerts", DefaultValue = 75, MinValue = 10, MaxValue = 99)]
        public int DllWarnPercent { get; set; }
        [Parameter("Profit target hit", Group = "Alerts", DefaultValue = true)]
        public bool AlertTarget { get; set; }
        [Parameter("Target sound", Group = "Alerts", DefaultValue = "Alert2.wav")]
        public string TargetSound { get; set; }
        [Parameter("Profit target ($, 0 = the account's target in RoninFlow)", Group = "Alerts", DefaultValue = 0, MinValue = 0, MaxValue = 1000000)]
        public double ProfitTarget { get; set; }
        [Parameter("Limits count open P&L", Group = "Alerts", DefaultValue = true)]
        public bool AlertIncludeOpen { get; set; }
        [Parameter("Panel background", Group = "Look", DefaultValue = "#0E0E12")]
        public Color BackColor { get; set; }
        [Parameter("Panel border", Group = "Look", DefaultValue = "#26262E")]
        public Color BorderColor { get; set; }
        [Parameter("Tiles", Group = "Look", DefaultValue = "#16161C")]
        public Color TileColor { get; set; }
        [Parameter("Text", Group = "Look", DefaultValue = "#E6E6EA")]
        public Color TextColor { get; set; }
        [Parameter("Muted text", Group = "Look", DefaultValue = "#8A8A96")]
        public Color MutedColor { get; set; }
        [Parameter("Positive", Group = "Look", DefaultValue = "#2BC48A")]
        public Color PositiveColor { get; set; }
        [Parameter("Negative", Group = "Look", DefaultValue = "#E5484D")]
        public Color NegativeColor { get; set; }
        [Parameter("Warning", Group = "Look", DefaultValue = "#E8B043")]
        public Color WarningColor { get; set; }
        [Parameter("Accent", Group = "Look", DefaultValue = "#8B5CF6")]
        public Color AccentColor { get; set; }
        [Parameter("Panel opacity (%)", Group = "Look", DefaultValue = 94, MinValue = 30, MaxValue = 100)]
        public int PanelOpacity { get; set; }

        private sealed class AcctInfo { public string Tier = "", Color = "", Reason = ""; public int Level, Of, MaxTrades; public double DailyLoss, Trail, Target; public bool Enforcing, Blocked, Paused; }
        private sealed class GexInfo { public string Index = "", Zone = "", Error = ""; public double Total; public double? Flip, Call, Put; public bool Delayed; public List<double> Pos = new List<double>(), Neg = new List<double>(); }
        private sealed class EventItem { public long T; public string Impact = "", Title = ""; }
        private sealed class NewsItem { public string Id = "", Src = "", Title = "", Summary = ""; public long T; public int Importance, Dir; }
        private sealed class Snap { public long DayStart; public string MarketLabel = "", Error = ""; public AcctInfo Acct; public GexInfo Gex; public List<EventItem> Events = new List<EventItem>(); public List<NewsItem> News = new List<NewsItem>(); public DateTime Got; }
        private sealed class HmNode { public int Start, End; public double Price, Volume; public bool Active; }

        private Snap snap;
        private readonly HashSet<string> seenNews = new HashSet<string>();
        private bool newsPrimed, newsCollapsed;
        private readonly List<KeyValuePair<NewsItem, DateTime>> popups = new List<KeyValuePair<NewsItem, DateTime>>();
        private NewsItem detail;
        private int ticks;
        private bool dllWarned, dllHit, targetHit; private DateTime alertDay;
        private MarketDepth depth;
        private readonly List<HmNode> hmNodes = new List<HmNode>();
        private readonly Dictionary<double, HmNode> hmLive = new Dictionary<double, HmNode>();

        // the panels are chart controls, rebuilt every second
        private Border accountBox, newsBox, popupBox, detailBox;

        protected override void Initialize()
        {
            // entries and scale-ins come from the net position on this symbol; wins and losses from each closing deal
            // (a partial close is a deal too, so every scale-out rings). The timer catches what has no event (netting adds).
            Positions.Opened += a => { CheckPosition(); CheckClosed(); };
            Positions.Closed += a => { CheckPosition(); CheckClosed(); };
            CheckPosition();
            CheckClosed();
            if (ShowHeatmap)
            {
                depth = MarketData.GetMarketDepth(SymbolName);
                depth.Updated += OnDepth;
            }
            if (ShowCandles)
            {
                Chart.ColorSettings.BullFillColor = Color.FromArgb((int)(255 * CcOpacity / 100.0), CcBullColor);
                Chart.ColorSettings.BearFillColor = Color.FromArgb((int)(255 * CcOpacity / 100.0), CcBearColor);
                Chart.ColorSettings.BullOutlineColor = CcBullWick;
                Chart.ColorSettings.BearOutlineColor = CcBearWick;
            }
            Timer.Start(1);
            Fetch();
            Render();
        }

        public override void Calculate(int index) { }

        protected override void OnTimer()
        {
            ticks++;
            if (ticks % Math.Max(2, RefreshSeconds) == 0) Fetch();
            if (ShowHeatmap) SampleDepth();
            popups.RemoveAll(p => p.Value < DateTime.UtcNow);
            CheckPosition();
            CheckClosed();
            CheckLimits();
            Render();
        }

        // ====================================================================== data

        private static double D(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0; }
        private static double? DN(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? (double?)v : null; }
        private static long L(string s) { long v; return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : 0; }

        private void Fetch()
        {
            try
            {
                string root = string.IsNullOrWhiteSpace(ServerUrl) ? "http://127.0.0.1:5173" : ServerUrl.Trim().TrimEnd('/');
                string acct = string.IsNullOrWhiteSpace(AccountName) ? Account.Number.ToString(CultureInfo.InvariantCulture) : AccountName.Trim();
                var req = new HttpRequest(new Uri(root + "/api/suite?format=tsv&symbol=" + Uri.EscapeDataString(SymbolName) + "&account=" + Uri.EscapeDataString(acct)));
                if (!string.IsNullOrWhiteSpace(Token)) req.Headers.Add("Authorization", "Bearer " + Token.Trim());
                var res = Http.Send(req);
                if (!res.IsSuccessful) throw new Exception("HTTP " + res.StatusCode);
                var s = Parse(res.Body ?? "");
                foreach (var n in s.News)
                {
                    if (!seenNews.Add(n.Id)) continue;
                    if (newsPrimed && ShowPopups && n.Importance >= PopupMinImportance) popups.Insert(0, new KeyValuePair<NewsItem, DateTime>(n, DateTime.UtcNow.AddSeconds(PopupSeconds)));
                }
                newsPrimed = true;
                if (popups.Count > 3) popups.RemoveRange(3, popups.Count - 3);
                snap = s;
                DrawLevels();
                DrawEvents();
            }
            catch (Exception e)
            {
                if (snap == null) snap = new Snap { Error = e.Message, Got = DateTime.UtcNow };
                else snap.Error = e.Message;
            }
        }

        private static Snap Parse(string text)
        {
            var s = new Snap { Got = DateTime.UtcNow };
            foreach (var raw in text.Split('\n'))
            {
                var c = raw.TrimEnd('\r').Split('\t');
                Func<int, string> at = i => i < c.Length ? c[i] : "";
                switch (at(0))
                {
                    case "RF": s.DayStart = L(at(3)); s.MarketLabel = at(5); break;
                    case "A": s.Acct = new AcctInfo { Tier = at(1), Level = (int)L(at(2)), Of = (int)L(at(3)), Color = at(4), DailyLoss = D(at(5)), Trail = D(at(6)), Target = D(at(7)), MaxTrades = (int)L(at(8)), Enforcing = at(10) == "1", Blocked = at(11) == "1", Paused = at(12) == "1", Reason = at(15) }; break;
                    case "G": s.Gex = new GexInfo { Index = at(1), Zone = at(2), Total = D(at(3)), Flip = DN(at(4)), Call = DN(at(5)), Put = DN(at(6)), Delayed = at(8) == "1", Error = at(9) }; break;
                    case "P": if (s.Gex != null) s.Gex.Pos.Add(D(at(1))); break;
                    case "Q": if (s.Gex != null) s.Gex.Neg.Add(D(at(1))); break;
                    case "E": s.Events.Add(new EventItem { T = L(at(1)), Impact = at(2), Title = at(4) }); break;
                    case "N": s.News.Add(new NewsItem { Id = at(1), T = L(at(2)), Importance = (int)L(at(3)), Dir = (int)L(at(4)), Src = at(5), Title = at(6), Summary = at(8) }); break;
                }
            }
            return s;
        }

        private DateTime DayStart() { return snap != null && snap.DayStart > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(snap.DayStart).UtcDateTime : Server.Time.Date; }
        private double Realised() { var from = DayStart(); return History.Where(h => h.ClosingTime >= from).Sum(h => h.NetProfit); }
        private double OpenPnl() { return Positions.Sum(p => p.NetProfit); }
        private double TargetValue() { return ProfitTarget > 0 ? ProfitTarget : snap != null && snap.Acct != null ? snap.Acct.Target : 0; }

        private void Ring(string sound, string message)
        {
            try
            {
                string path = sound ?? "";
                if (!System.IO.Path.IsPathRooted(path)) path = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media", path);
                Notifications.PlaySound(path);
            }
            catch { }
            Print("RoninFlow: " + message);
        }

        private double lastNet; private bool netPrimed;
        private readonly HashSet<long> dealsSeen = new HashSet<long>(); private int historyCount = -1;

        private string Lots(double units) { return Symbol.VolumeInUnitsToQuantity(units).ToString("0.##", CultureInfo.InvariantCulture); }

        /// <summary>Flat → open (or a reversal) is an entry; more on the same side is a scale-in. Exits ring as wins / losses.</summary>
        private void CheckPosition()
        {
            double now = Positions.Where(p => p.SymbolName == SymbolName).Sum(p => p.TradeType == TradeType.Buy ? p.VolumeInUnits : -p.VolumeInUnits);
            double before = lastNet;
            lastNet = now;
            if (!netPrimed) { netPrimed = true; return; } // what was open when the indicator started isn't new
            bool flip = before != 0 && now != 0 && Math.Sign(before) != Math.Sign(now);
            string side = now > 0 ? "LONG " : "SHORT ";
            if (now != 0 && (before == 0 || flip)) { if (AlertEntry) Ring(EntrySound, "entered " + side + Lots(Math.Abs(now)) + " " + SymbolName); }
            else if (before != 0 && Math.Abs(now) > Math.Abs(before)) { if (AlertFill) Ring(FillSound, "added " + Lots(Math.Abs(now) - Math.Abs(before)) + " to " + side + SymbolName + " · now " + Lots(Math.Abs(now))); }
        }

        /// <summary>Each closing deal since the last check — a scale-out or the final exit — as one win or loss.</summary>
        private void CheckClosed()
        {
            int count = History.Count;
            if (count == historyCount) return;
            bool primed = historyCount >= 0;
            historyCount = count;
            double pnl = 0; int n = 0;
            foreach (var h in History)
            {
                if (!dealsSeen.Add(h.ClosingDealId) || !primed) continue;
                pnl += h.NetProfit; n++;
            }
            if (n == 0) return;
            if (pnl > 0 && AlertWin) Ring(WinSound, "win " + Money(pnl, true) + " · day " + Money(Realised(), true));
            else if (pnl < 0 && AlertLoss) Ring(LossSound, "loss " + Money(pnl, true) + " · day " + Money(Realised(), true));
        }

        private void CheckLimits()
        {
            var day = DayStart();
            if (day != alertDay) { alertDay = day; dllWarned = dllHit = targetHit = false; }
            double now = Realised() + (AlertIncludeOpen ? OpenPnl() : 0);
            double dll = snap != null && snap.Acct != null ? snap.Acct.DailyLoss : 0;
            if (AlertDll && dll > 0)
            {
                if (!dllHit && now <= -dll) { dllHit = true; Ring(DllSound, "daily loss limit hit: " + Money(now, true)); }
                else if (!dllWarned && !dllHit && now <= -dll * DllWarnPercent / 100.0) { dllWarned = true; Ring(DllSound, DllWarnPercent + "% of the daily loss limit used: " + Money(now, true)); }
            }
            double target = TargetValue();
            if (AlertTarget && target > 0 && !targetHit && now >= target) { targetHit = true; Ring(TargetSound, "profit target hit: " + Money(now, true)); }
        }

        // ====================================================================== chart objects: gamma, events, executions, heatmap

        private void Clear(string prefix)
        {
            foreach (var o in Chart.Objects.Where(o => o.Name.StartsWith(prefix, StringComparison.Ordinal)).ToList()) Chart.RemoveObject(o.Name);
        }

        private void DrawLevels()
        {
            Clear("rf-g-");
            var g = snap != null ? snap.Gex : null;
            if (!ShowGamma || g == null || g.Error.Length > 0) return;
            var list = new List<Tuple<double, string, Color>>();
            if (ShowWalls && g.Call.HasValue) list.Add(Tuple.Create(g.Call.Value, "Call wall", CallWallColor));
            if (ShowWalls && g.Put.HasValue) list.Add(Tuple.Create(g.Put.Value, "Put wall", PutWallColor));
            if (ShowFlip && g.Flip.HasValue) list.Add(Tuple.Create(g.Flip.Value, "Gamma flip", FlipColor));
            if (ShowOtherLevels) { foreach (var p in g.Pos) list.Add(Tuple.Create(p, "+γ", PosLevelColor)); foreach (var p in g.Neg) list.Add(Tuple.Create(p, "−γ", NegLevelColor)); }
            int k = 0;
            DateTime t1 = Bars.OpenTimes[Math.Max(0, Bars.Count - 400)], t2 = Bars.OpenTimes.LastValue.AddDays(2);
            foreach (var lv in list)
            {
                k++;
                bool major = lv.Item2.Length > 2;
                if (GammaZones)
                {
                    double half = Symbol.TickSize * ZoneTicks / 2.0;
                    var r = Chart.DrawRectangle("rf-g-z" + k, t1, lv.Item1 - half, t2, lv.Item1 + half, Color.FromArgb(major ? 50 : 28, lv.Item3));
                    r.IsFilled = true; r.IsInteractive = false;
                }
                else
                {
                    var hl = Chart.DrawHorizontalLine("rf-g-l" + k, lv.Item1, Color.FromArgb(major ? 220 : 140, lv.Item3), LevelWidth, major ? LineStyle.Solid : LineStyle.Dots);
                    hl.IsInteractive = false;
                }
                var label = Chart.DrawText("rf-g-t" + k, lv.Item2 + " " + lv.Item1.ToString("0.##", CultureInfo.InvariantCulture), LabelSide == LabelSide.Left ? Bars.OpenTimes[Math.Max(0, Chart.FirstVisibleBarIndex)] : Bars.OpenTimes.LastValue, lv.Item1, lv.Item3);
                label.VerticalAlignment = VerticalAlignment.Top; label.FontSize = FontSize; label.IsInteractive = false;
            }
        }

        private void DrawEvents()
        {
            Clear("rf-e-");
            if (!ShowEventMarkers || snap == null) return;
            int k = 0;
            foreach (var e in snap.Events)
            {
                if (EventMinImpact == EventLevel.HighOnly && e.Impact != "high") continue;
                if (EventMinImpact == EventLevel.MediumAndHigh && e.Impact == "low") continue;
                var c = e.Impact == "high" ? NegativeColor : e.Impact == "medium" ? WarningColor : MutedColor;
                var v = Chart.DrawVerticalLine("rf-e-" + (++k), DateTimeOffset.FromUnixTimeMilliseconds(e.T).UtcDateTime, Color.FromArgb(110, c), 1, LineStyle.Dots);
                v.IsInteractive = false;
                v.Comment = e.Title;
            }
        }

        private void DrawExecutions()
        {
            Clear("rf-x-");
            if (!ShowExecutions) return;
            int k = 0;
            var from = Bars.OpenTimes[0];
            foreach (var h in History.Where(h => h.SymbolName == SymbolName && h.ClosingTime >= from).OrderByDescending(h => h.ClosingTime).Take(300))
            {
                k++;
                bool buy = h.TradeType == TradeType.Buy;
                Mark("rf-x-a" + k, h.EntryTime, h.EntryPrice, buy, h.Quantity);
                Mark("rf-x-b" + k, h.ClosingTime, h.ClosingPrice, !buy, h.Quantity);
                if (ExecConnect)
                {
                    var tl = Chart.DrawTrendLine("rf-x-l" + k, h.EntryTime, h.EntryPrice, h.ClosingTime, h.ClosingPrice, h.NetProfit >= 0 ? ExecWinColor : ExecLossColor, ExecLineWidth, ExecLineStyle == LineKind.Solid ? LineStyle.Solid : ExecLineStyle == LineKind.Dotted ? LineStyle.Dots : LineStyle.Lines);
                    tl.IsInteractive = false;
                }
                if (ExecShowResult)
                {
                    double move = (h.ClosingPrice - h.EntryPrice) * (buy ? 1 : -1);
                    string text = ExecResultUnit == ResultUnit.Ticks ? (move >= 0 ? "+" : "") + (move / Symbol.TickSize).ToString("0.#", CultureInfo.InvariantCulture) + "t"
                        : ExecResultUnit == ResultUnit.Points ? (move >= 0 ? "+" : "") + move.ToString("0.#####", CultureInfo.InvariantCulture) : Money(h.NetProfit, true);
                    var t = Chart.DrawText("rf-x-r" + k, text, h.ClosingTime, h.ClosingPrice, (ExecResultUnit == ResultUnit.Money ? h.NetProfit >= 0 : move >= 0) ? ExecWinColor : ExecLossColor);
                    t.VerticalAlignment = buy ? VerticalAlignment.Top : VerticalAlignment.Bottom; t.FontSize = FontSize; t.IsInteractive = false;
                }
            }
            foreach (var p in Positions.Where(p => p.SymbolName == SymbolName))
            {
                k++;
                Mark("rf-x-o" + k, p.EntryTime, p.EntryPrice, p.TradeType == TradeType.Buy, p.Quantity);
                if (ExecShowAvg)
                {
                    var hl = Chart.DrawHorizontalLine("rf-x-avg" + k, p.EntryPrice, ExecAvgColor, 1, LineStyle.Lines);
                    hl.IsInteractive = false; hl.Comment = (p.TradeType == TradeType.Buy ? "LONG " : "SHORT ") + p.Quantity;
                }
            }
        }

        private void Mark(string name, DateTime t, double price, bool buy, double qty)
        {
            var type = ExecMarker == MarkerStyle.Circles ? ChartIconType.Circle : ExecMarker == MarkerStyle.Arrows ? (buy ? ChartIconType.UpArrow : ChartIconType.DownArrow) : (buy ? ChartIconType.UpTriangle : ChartIconType.DownTriangle);
            var icon = Chart.DrawIcon(name, type, t, price, buy ? ExecBuyColor : ExecSellColor);
            icon.IsInteractive = false;
            if (ExecShowQty)
            {
                var q = Chart.DrawText(name + "q", qty.ToString("0.##", CultureInfo.InvariantCulture), t, price, buy ? ExecBuyColor : ExecSellColor);
                q.VerticalAlignment = buy ? VerticalAlignment.Bottom : VerticalAlignment.Top; q.HorizontalAlignment = HorizontalAlignment.Center; q.FontSize = Math.Max(7, FontSize - 2); q.IsInteractive = false;
            }
        }

        private void OnDepth()
        {
            // nothing to do here: the book is sampled once a second in SampleDepth
        }

        private void SampleDepth()
        {
            if (depth == null) return;
            int bar = Bars.Count - 1;
            var now = new Dictionary<double, double>();
            foreach (var e in depth.BidEntries.Concat(depth.AskEntries))
                if (e.VolumeInUnits >= HmThreshold) now[e.Price] = e.VolumeInUnits;
            foreach (var k in hmLive.Keys.ToList())
                if (!now.ContainsKey(k)) { var n = hmLive[k]; n.End = bar; n.Active = false; hmLive.Remove(k); }
            foreach (var kv in now)
            {
                HmNode n;
                if (hmLive.TryGetValue(kv.Key, out n))
                {
                    n.End = bar;
                    double change = n.Volume > 0 ? Math.Abs(kv.Value - n.Volume) / n.Volume * 100 : 100;
                    if (change >= HmReshade && bar > n.Start) { n.Active = false; Start(kv.Key, kv.Value, bar); } else n.Volume = kv.Value;
                }
                else Start(kv.Key, kv.Value, bar);
            }
            if (hmNodes.Count > 4000) hmNodes.RemoveAll(x => !x.Active && x.End < bar - 1000);
            if (ticks % 2 == 0) DrawHeatmap();
        }

        private void Start(double price, double vol, int bar) { var n = new HmNode { Start = bar, End = bar, Price = price, Volume = vol, Active = true }; hmLive[price] = n; hmNodes.Add(n); }

        private void DrawHeatmap()
        {
            Clear("rf-h-");
            if (hmNodes.Count == 0) return;
            var recent = hmNodes.Skip(Math.Max(0, hmNodes.Count - 3000)).Select(n => n.Volume).OrderBy(v => v).ToList();
            double top = recent[Math.Min(recent.Count - 1, (int)Math.Round((recent.Count - 1) * 0.99))];
            double lo = Math.Log10(1 + HmThreshold), hi = Math.Max(Math.Log10(1 + top), lo + 0.3);
            var stops = Stops(HmPalette);
            int first = Chart.FirstVisibleBarIndex, k = 0;
            // chart objects are heavy: only the strongest 160 visible levels
            foreach (var n in hmNodes.Where(n => n.Active || n.End >= first).OrderByDescending(n => n.Volume).Take(160))
            {
                double t = Math.Pow(Math.Max(0, Math.Min(1, (Math.Log10(1 + n.Volume) - lo) / (hi - lo))), HmContrast);
                var c = Ramp(stops, t);
                int a = (int)Math.Round(255 * (0.15 + 0.85 * Math.Pow(t, 1.35)) * HmOpacity / 100.0);
                var t1 = Bars.OpenTimes[Math.Max(0, n.Start)];
                var t2 = n.Active && HmExtendLive ? Bars.OpenTimes.LastValue.AddMinutes(30) : Bars.OpenTimes[Math.Min(Bars.Count - 1, n.End)].AddMinutes(1);
                var r = Chart.DrawRectangle("rf-h-" + (++k), t1, n.Price - Symbol.TickSize / 2, t2, n.Price + Symbol.TickSize / 2, Color.FromArgb(a, c));
                r.IsFilled = true; r.Thickness = 0; r.IsInteractive = false; r.ZIndex = -1;
                if (HmTags && n.Active && k <= HmTagCount)
                {
                    var tx = Chart.DrawText("rf-h-t" + k, n.Volume.ToString("N0", CultureInfo.InvariantCulture), Bars.OpenTimes.LastValue, n.Price, Color.White);
                    tx.FontSize = Math.Max(7, FontSize - 2); tx.VerticalAlignment = VerticalAlignment.Center; tx.IsInteractive = false;
                }
            }
        }

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

        // ====================================================================== panels (chart controls)

        private static string Money(double v, bool sign = false) { return (v < 0 ? "-$" : sign && v > 0 ? "+$" : "$") + Math.Abs(v).ToString("N2", CultureInfo.InvariantCulture); }
        private static string Num(double v, bool sign = false) { return (sign && v > 0 ? "+" : "") + v.ToString("0.00", CultureInfo.InvariantCulture); }
        private static string Mask(string id) { return id.Length > 9 ? id.Substring(0, 4) + "•••" + id.Substring(id.Length - 3) : id; }
        private static Color Hex(string h, Color fb) { try { return Color.FromHex(h.StartsWith("#") ? h : "#" + h); } catch { return fb; } }

        private TextBlock Txt(string text, Color c, double size, bool bold = false)
        {
            return new TextBlock { Text = text, ForegroundColor = c, FontSize = size, FontWeight = bold ? FontWeight.Bold : FontWeight.Normal, Margin = new Thickness(0, 1, 0, 1), TextWrapping = TextWrapping.NoWrap };
        }

        private Border Panel(Corner corner, int dx, int dy, double width)
        {
            var b = new Border
            {
                BackgroundColor = Color.FromArgb((int)(255 * PanelOpacity / 100.0), BackColor), BorderColor = BorderColor, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 8, 10, 8), Width = width,
                HorizontalAlignment = corner == Corner.TopLeft || corner == Corner.BottomLeft ? HorizontalAlignment.Left : corner == Corner.TopRight || corner == Corner.BottomRight ? HorizontalAlignment.Right : HorizontalAlignment.Center,
                VerticalAlignment = corner == Corner.TopLeft || corner == Corner.TopRight || corner == Corner.TopMiddle ? VerticalAlignment.Top : VerticalAlignment.Bottom,
            };
            bool left = b.HorizontalAlignment == HorizontalAlignment.Left, top = b.VerticalAlignment == VerticalAlignment.Top;
            b.Margin = new Thickness(left ? dx : 0, top ? dy : 0, left ? 0 : dx, top ? 0 : dy);
            return b;
        }

        private void Replace(ref Border slot, Border next)
        {
            if (slot != null) Chart.RemoveControl(slot);
            slot = next;
            if (next != null) Chart.AddControl(next);
        }

        private void Render()
        {
            if (ticks % 3 == 0) DrawExecutions();
            Replace(ref accountBox, ShowAccount ? AccountPanel() : null);
            Replace(ref newsBox, ShowNews && snap != null ? NewsPanel() : null);
            Replace(ref popupBox, ShowPopups && popups.Count > 0 ? PopupPanel() : null);
            Replace(ref detailBox, detail != null ? DetailPanel() : null);
        }

        private Border AccountPanel()
        {
            var s = snap; var acct = s != null ? s.Acct : null;
            var box = Panel(AccountPlacement, AccountX, AccountY, AccountWidth);
            var stack = new StackPanel { Orientation = Orientation.Vertical };
            // header
            var head = new Grid(1, 2);
            var name = new StackPanel { Orientation = Orientation.Horizontal };
            name.AddChild(Txt("Ronin", TextColor, FontSize + 1, true)); name.AddChild(Txt("Flow  ", AccentColor, FontSize + 1, true));
            name.AddChild(Txt(Mask(Account.Number.ToString(CultureInfo.InvariantCulture)), MutedColor, FontSize));
            head.AddChild(name, 0, 0);
            string state = s == null || s.Error.Length > 0 ? "offline" : acct != null && acct.Blocked ? "blocked" : acct != null && acct.Paused ? "rules paused" : acct != null && acct.Enforcing ? "enforcing" : "live";
            var st = Txt("● " + state, state == "offline" ? MutedColor : state == "blocked" ? NegativeColor : state == "rules paused" ? WarningColor : PositiveColor, FontSize - 1);
            st.HorizontalAlignment = HorizontalAlignment.Right;
            head.AddChild(st, 0, 1);
            stack.AddChild(head);
            // chips
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 4) };
            if (ShowTierChip && acct != null && acct.Tier.Length > 0) chips.AddChild(Chip("● Tier " + acct.Tier + " " + (acct.Level + 1) + "/" + Math.Max(1, acct.Of), Hex(acct.Color, AccentColor)));
            var g = s != null ? s.Gex : null;
            if (ShowGammaChip && g != null && g.Error.Length == 0)
            {
                double price = Bars.ClosePrices.LastValue;
                bool pos = g.Flip.HasValue ? price >= g.Flip.Value : g.Zone == "positive";
                chips.AddChild(Chip(pos ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending", pos ? PositiveColor : NegativeColor));
            }
            stack.AddChild(chips);
            if (acct != null && acct.Blocked)
            {
                var bb = new Border { BackgroundColor = Color.FromArgb(40, NegativeColor), BorderColor = Color.FromArgb(120, NegativeColor), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 4, 7, 4), Margin = new Thickness(0, 2, 0, 4) };
                var bt = Txt("New orders blocked — " + (acct.Reason.Length > 0 ? acct.Reason : "a risk rule is broken"), NegativeColor, FontSize - 1); bt.TextWrapping = TextWrapping.Wrap;
                bb.Child = bt; stack.AddChild(bb);
            }
            double realised = Realised(), open = OpenPnl();
            var from = DayStart();
            var today = History.Where(h => h.ClosingTime >= from).ToList();
            if (ShowPnlTiles)
            {
                var tiles = new Grid(1, 3) { Margin = new Thickness(0, 2, 0, 4) };
                tiles.AddChild(Tile("OPEN", Num(open, true), open), 0, 0);
                tiles.AddChild(Tile("CLOSED", Num(realised, true), realised), 0, 1);
                tiles.AddChild(Tile("TRADES", acct != null && acct.MaxTrades > 0 ? today.Count + " / " + acct.MaxTrades : today.Count.ToString(CultureInfo.InvariantCulture), 0), 0, 2);
                stack.AddChild(tiles);
            }
            double dll = acct != null ? acct.DailyLoss : 0, target = TargetValue();
            if (ShowBuffer && (dll > 0 || target > 0))
            {
                double now = realised + (BufferClosedOnly ? 0 : open), peak = 0, run = 0;
                foreach (var h in today.OrderBy(h => h.ClosingTime)) { run += h.NetProfit; peak = Math.Max(peak, run); }
                double trail = acct != null ? acct.Trail : 0, stop = dll > 0 ? (trail > 0 ? Math.Max(-dll, peak - trail) : -dll) : 0;
                stack.AddChild(Txt(dll > 0 ? "Buffer to loss limit: " + Money(Math.Max(0, now - stop)) + " of " + Money(dll) : "To profit target: " + (target - now > 0 ? Money(target - now) : "hit"), dll > 0 && now - stop <= dll * 0.25 ? NegativeColor : TextColor, FontSize - 1));
                double lo = dll > 0 ? -dll : Math.Min(Math.Min(0, now), -target / 2), hi = Math.Max(Math.Max(peak, now), target > 0 ? target : dll * 0.5);
                if (hi <= lo) hi = lo + 1;
                double frac = Math.Max(0, Math.Min(1, (now - lo) / (hi - lo)));
                var track = new Border { Height = 6, BackgroundColor = Color.FromArgb(60, MutedColor), CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 3, 0, 3) };
                track.Child = new Border { Height = 6, Width = Math.Max(3, (AccountWidth - 22) * frac), HorizontalAlignment = HorizontalAlignment.Left, BackgroundColor = now >= 0 ? PositiveColor : NegativeColor, CornerRadius = new CornerRadius(3) };
                stack.AddChild(track);
                stack.AddChild(Txt((dll > 0 ? "stop " + Num(stop, true) + "   " : "") + "high " + Num(peak, true) + (target > 0 ? "   target " + Num(target, true) : ""), MutedColor, FontSize - 2));
            }
            if (ShowStats && today.Count > 0)
            {
                int w = today.Count(h => h.NetProfit > 0), l = today.Count(h => h.NetProfit < 0);
                double gw = today.Where(h => h.NetProfit > 0).Sum(h => h.NetProfit), gl = -today.Where(h => h.NetProfit < 0).Sum(h => h.NetProfit);
                double wr = (double)w / today.Count, aw = w > 0 ? gw / w : 0, al = l > 0 ? gl / l : 0, pf = gl > 0 ? gw / gl : gw > 0 ? 99 : 0, edge = al > 0 ? wr * aw / al : 0;
                var grid = new Grid(2, 4) { Margin = new Thickness(0, 4, 0, 2) };
                grid.AddChild(Stat("Win rate", (wr * 100).ToString("0", CultureInfo.InvariantCulture) + "%", TextColor), 0, 0);
                grid.AddChild(Stat("Profit f.", pf.ToString("0.00", CultureInfo.InvariantCulture), pf >= 1 ? PositiveColor : NegativeColor), 0, 1);
                grid.AddChild(Stat("EV", Num(realised / today.Count, true), realised >= 0 ? PositiveColor : NegativeColor), 0, 2);
                grid.AddChild(Stat("Edge", edge.ToString("0.00", CultureInfo.InvariantCulture), edge >= 0.75 ? PositiveColor : edge >= 0.5 ? WarningColor : NegativeColor), 0, 3);
                grid.AddChild(Stat("Avg win", aw.ToString("0.00", CultureInfo.InvariantCulture), PositiveColor), 1, 0);
                grid.AddChild(Stat("Avg loss", al.ToString("0.00", CultureInfo.InvariantCulture), NegativeColor), 1, 1);
                grid.AddChild(Stat("Best", Num(today.Max(h => h.NetProfit), true), PositiveColor), 1, 2);
                grid.AddChild(Stat("Worst", Num(today.Min(h => h.NetProfit), true), NegativeColor), 1, 3);
                stack.AddChild(grid);
            }
            if (ShowGexLine && g != null)
                stack.AddChild(Txt(g.Error.Length > 0 ? "GEX: " + g.Error : g.Index + " GEX " + (g.Total >= 0 ? "+" : "-") + "$" + (Math.Abs(g.Total) / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + "B" + (g.Flip.HasValue ? " · flip " + g.Flip.Value.ToString("0.##", CultureInfo.InvariantCulture) : "") + (g.Delayed ? " · delayed" : ""), g.Total >= 0 ? PositiveColor : NegativeColor, FontSize - 1));
            if (ShowAllPositions && Positions.Count > 0)
            {
                stack.AddChild(Txt("OPEN POSITIONS", MutedColor, FontSize - 2));
                foreach (var p in Positions.OrderBy(p => p.SymbolName))
                {
                    var row = new Grid(1, 2);
                    row.AddChild(Txt((p.TradeType == TradeType.Buy ? "LONG " : "SHORT ") + p.Quantity.ToString("0.##", CultureInfo.InvariantCulture) + " " + p.SymbolName, p.TradeType == TradeType.Buy ? PositiveColor : NegativeColor, FontSize, true), 0, 0);
                    var pnl = Txt(Num(p.NetProfit, true), p.NetProfit >= 0 ? PositiveColor : NegativeColor, FontSize, true); pnl.HorizontalAlignment = HorizontalAlignment.Right;
                    row.AddChild(pnl, 0, 1);
                    stack.AddChild(row);
                }
            }
            box.Child = stack;
            return box;
        }

        private Border Chip(string text, Color c)
        {
            return new Border { BackgroundColor = Color.FromArgb(40, c), BorderColor = Color.FromArgb(150, c), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(9), Padding = new Thickness(7, 2, 7, 2), Margin = new Thickness(0, 0, 6, 0), Child = Txt(text, c, FontSize - 1) };
        }

        private Border Tile(string label, string value, double tone)
        {
            var c = tone > 0 ? PositiveColor : tone < 0 ? NegativeColor : TextColor;
            var s = new StackPanel { Orientation = Orientation.Vertical };
            s.AddChild(Txt(label, MutedColor, FontSize - 2)); s.AddChild(Txt(value, c, FontSize + 3, true));
            return new Border { BackgroundColor = tone == 0 ? TileColor : Color.FromArgb(40, c), BorderColor = tone == 0 ? BorderColor : Color.FromArgb(110, c), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(5), Padding = new Thickness(8, 4, 8, 4), Margin = new Thickness(0, 0, 4, 0), Child = s };
        }

        private StackPanel Stat(string label, string value, Color c)
        {
            var s = new StackPanel { Orientation = Orientation.Vertical, Margin = new Thickness(0, 0, 0, 4) };
            s.AddChild(Txt(label, MutedColor, FontSize - 2)); s.AddChild(Txt(value, c, FontSize, true));
            return s;
        }

        private Border NewsPanel()
        {
            var box = Panel(NewsPlacement, NewsX, NewsY, NewsWidth);
            var stack = new StackPanel();
            var head = new Button { Text = (newsCollapsed ? "▸ " : "▾ ") + "News" + (snap.MarketLabel.Length > 0 ? " · " + snap.MarketLabel : ""), BackgroundColor = Color.Transparent, ForegroundColor = TextColor, FontSize = FontSize + 1, FontWeight = FontWeight.Bold, Padding = new Thickness(0), BorderThickness = new Thickness(0) };
            head.Click += a => { newsCollapsed = !newsCollapsed; Render(); };
            stack.AddChild(head);
            if (!newsCollapsed)
            {
                var items = snap.News.Where(n => n.Importance >= NewsMinImportance).Take(NewsRows).ToList();
                if (items.Count == 0) stack.AddChild(Txt("No headlines yet", MutedColor, FontSize - 1));
                foreach (var n in items)
                {
                    var c = n.Importance >= 3 ? NegativeColor : n.Importance >= 2 ? WarningColor : MutedColor;
                    stack.AddChild(Txt(DateTimeOffset.FromUnixTimeMilliseconds(n.T).LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture) + " · " + n.Src + (n.Dir > 0 ? " · ↑" : n.Dir < 0 ? " · ↓" : ""), c, FontSize - 2));
                    var item = n;
                    var b = new Button { Text = n.Title.Length > 90 ? n.Title.Substring(0, 88) + "…" : n.Title, BackgroundColor = Color.Transparent, ForegroundColor = TextColor, FontSize = FontSize, Padding = new Thickness(0, 0, 0, 4), BorderThickness = new Thickness(0) };
                    b.Click += a => { detail = item; Render(); };
                    stack.AddChild(b);
                }
            }
            box.Child = stack;
            return box;
        }

        private Border PopupPanel()
        {
            var box = Panel(PopupPlacement, PopupX, PopupY, 340);
            var stack = new StackPanel();
            foreach (var kv in popups)
            {
                var n = kv.Key; var c = n.Importance >= 3 ? NegativeColor : n.Importance >= 2 ? WarningColor : AccentColor;
                stack.AddChild(Txt((n.Importance >= 3 ? "HIGH IMPACT · " : "") + n.Src, c, FontSize - 1));
                var t = Txt(n.Title, TextColor, FontSize, true); t.TextWrapping = TextWrapping.Wrap; t.Margin = new Thickness(0, 0, 0, 8);
                stack.AddChild(t);
            }
            box.Child = stack;
            return box;
        }

        private Border DetailPanel()
        {
            var n = detail;
            var box = Panel(Corner.TopMiddle, 0, 80, 520);
            box.BackgroundColor = BackColor;
            var stack = new StackPanel();
            stack.AddChild(Txt(n.Src + " · " + DateTimeOffset.FromUnixTimeMilliseconds(n.T).LocalDateTime.ToString("ddd HH:mm", CultureInfo.InvariantCulture), n.Importance >= 3 ? NegativeColor : n.Importance >= 2 ? WarningColor : AccentColor, FontSize - 1));
            var t = Txt(n.Title, TextColor, FontSize + 3, true); t.TextWrapping = TextWrapping.Wrap; stack.AddChild(t);
            if (n.Summary.Length > 0 && n.Summary != n.Title) { var s = Txt(n.Summary, TextColor, FontSize); s.TextWrapping = TextWrapping.Wrap; s.Margin = new Thickness(0, 8, 0, 8); stack.AddChild(s); }
            var close = new Button { Text = "Close", BackgroundColor = AccentColor, ForegroundColor = Color.White, FontSize = FontSize, Padding = new Thickness(12, 4, 12, 4), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 6, 0, 0) };
            close.Click += a => { detail = null; Render(); };
            stack.AddChild(close);
            box.Child = stack;
            return box;
        }
    }
}
